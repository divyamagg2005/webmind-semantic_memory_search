/**
 * Tests for error handling utilities
 * Requirements: 23.1, 23.2, 23.3, 27.5
 */

const { describe, it } = require("node:test")
const assert = require("node:assert")
const {
  EmbeddingRetryQueue,
  isOllamaError,
  withTimeout,
  getQueryTimeout,
  logError
} = require("./error-handling")

describe("Error Handling", () => {
  it("should detect Ollama connection errors", () => {
    assert.strictEqual(isOllamaError({ message: "fetch failed" }), true)
    assert.strictEqual(isOllamaError({ code: "ECONNREFUSED" }), true)
    assert.strictEqual(isOllamaError({ message: "syntax error" }), false)
  })

  it("should timeout long operations", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("done"), 200))
    await assert.rejects(
      () => withTimeout(slow, 50, "test"),
      (err) => err.code === "QUERY_TIMEOUT"
    )
  })

  it("should resolve fast operations before timeout", async () => {
    const fast = Promise.resolve("ok")
    const result = await withTimeout(fast, 1000, "test")
    assert.strictEqual(result, "ok")
  })

  it("should enqueue and process embedding retries", async () => {
    const queue = new EmbeddingRetryQueue()
    queue.enqueue({ text: "hello", memoryId: 1 })

    assert.strictEqual(queue.size, 1)

    const result = await queue.process(async () => {
      /* success */
    })

    assert.strictEqual(result.processed, 1)
    assert.strictEqual(queue.size, 0)
  })

  it("should return default query timeout", () => {
    const timeout = getQueryTimeout()
    assert.ok(timeout >= 1000)
    assert.ok(timeout <= 30000)
  })

  it("should log structured errors", () => {
    const entry = logError("test_context", new Error("test"), { foo: "bar" })
    assert.strictEqual(entry.context, "test_context")
    assert.strictEqual(entry.message, "test")
    assert.strictEqual(entry.foo, "bar")
  })
})
