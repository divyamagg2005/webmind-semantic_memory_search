/**
 * Error Handling and Fallback Utilities
 *
 * Requirements: 25.4, 25.5, 27.1, 27.5
 */

const { getConfig } = require("./config-manager")

/**
 * In-memory queue for embedding retries when Ollama is unavailable
 */
class EmbeddingRetryQueue {
  constructor() {
    this.queue = []
    this.processing = false
  }

  enqueue(item) {
    const exists = this.queue.some(
      (q) => q.text === item.text && q.memoryId === item.memoryId
    )
    if (!exists) {
      this.queue.push({ ...item, attempts: 0, enqueuedAt: Date.now() })
    }
  }

  getPending() {
    return [...this.queue]
  }

  get size() {
    return this.queue.length
  }

  async process(generateFn, maxAttempts = 3) {
    if (this.processing || this.queue.length === 0) {
      return { processed: 0, failed: 0 }
    }

    this.processing = true
    let processed = 0
    let failed = 0
    const remaining = []

    for (const item of this.queue) {
      try {
        await generateFn(item)
        processed++
      } catch (err) {
        item.attempts += 1
        if (item.attempts < maxAttempts) {
          remaining.push(item)
        } else {
          failed++
          logError("embedding_retry_exhausted", err, { memoryId: item.memoryId })
        }
      }
    }

    this.queue = remaining
    this.processing = false
    return { processed, failed, remaining: remaining.length }
  }
}

const embeddingRetryQueue = new EmbeddingRetryQueue()

/**
 * Structured error logging for debugging
 */
function logError(context, error, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    context,
    message: error?.message || String(error),
    stack: error?.stack,
    ...metadata
  }
  console.error("[WebMind Error]", JSON.stringify(entry))
  return entry
}

/**
 * Detect Ollama connection failures
 */
function isOllamaError(error) {
  if (!error) return false
  const msg = (error.message || "").toLowerCase()
  return (
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("connect") ||
    msg.includes("ollama") ||
    error.code === "ECONNREFUSED"
  )
}

/**
 * Run async operation with timeout; returns partial flag on timeout
 */
function withTimeout(promise, timeoutMs, label = "operation") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`)
      err.code = "QUERY_TIMEOUT"
      reject(err)
    }, timeoutMs)

    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

/**
 * Get configured query timeout (default 5s)
 */
function getQueryTimeout() {
  try {
    const config = getConfig()
    return config.query_timeout || 5000
  } catch {
    return 5000
  }
}

/**
 * SQLite write with rollback on failure
 */
function runWithRollback(db, operations) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION")

      const runNext = (index) => {
        if (index >= operations.length) {
          db.run("COMMIT", (err) => {
            if (err) {
              db.run("ROLLBACK")
              reject(err)
            } else {
              resolve()
            }
          })
          return
        }

        const op = operations[index]
        db.run(op.sql, op.params || [], function (err) {
          if (err) {
            logError("sqlite_write_failure", err, { sql: op.sql })
            db.run("ROLLBACK", () => reject(err))
            return
          }
          if (op.onSuccess) {
            op.onSuccess(this)
          }
          runNext(index + 1)
        })
      }

      runNext(0)
    })
  })
}

/**
 * Delete a memory row (rollback helper)
 */
function deleteMemory(db, memoryId) {
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM memories WHERE id = ?", [memoryId], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * Attempt LanceDB recovery by re-opening table
 */
async function recoverLanceTable(lancedb, tableName = "webmind_vectors") {
  try {
    const lanceDb = await lancedb.connect("./lancedb")
    const table = await lanceDb.openTable(tableName)
    logError("lancedb_recovered", new Error("LanceDB table reopened successfully"))
    return table
  } catch (err) {
    logError("lancedb_recovery_failed", err)
    throw err
  }
}

/**
 * Wrap LanceDB search with corruption fallback
 */
async function safeSemanticSearch(searchFn, lancedb) {
  try {
    return await searchFn()
  } catch (err) {
    logError("lancedb_search_failure", err)
    if (
      err.message?.includes("corrupt") ||
      err.message?.includes("invalid") ||
      err.message?.includes("not found")
    ) {
      await recoverLanceTable(lancedb)
      return await searchFn()
    }
    throw err
  }
}

module.exports = {
  EmbeddingRetryQueue,
  embeddingRetryQueue,
  logError,
  isOllamaError,
  withTimeout,
  getQueryTimeout,
  runWithRollback,
  deleteMemory,
  recoverLanceTable,
  safeSemanticSearch
}
