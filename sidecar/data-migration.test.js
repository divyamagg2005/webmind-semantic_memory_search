/**
 * Data Migration Tests
 *
 * Requirements: 29.2, 29.4, 29.6
 */

const { describe, it, before, after, afterEach } = require("node:test")
const assert = require("node:assert")
const sqlite3 = require("sqlite3").verbose()
const fs = require("fs")
const path = require("path")
const {
  detectOldDatabase,
  hasOldSchema,
  hasNewSchema,
  migratePages,
  extractHistoricalConcepts,
  performMigration,
  verifyMigration
} = require("./data-migration")
const { KnowledgeGraph } = require("./knowledge-graph")

const TEST_DIR = path.join(__dirname, ".test-tmp")
let testCounter = 0

/** Unique paths per test so runs never share state */
function testPaths() {
  const id = `${Date.now()}-${testCounter++}`
  return {
    db: path.join(TEST_DIR, `migration-${id}.db`),
    oldDb: path.join(TEST_DIR, `migration-old-${id}.db`),
    graph: path.join(TEST_DIR, `migration-graph-${id}.json`)
  }
}

async function rmIfExists(filePath, retries = 5) {
  if (!filePath || !fs.existsSync(filePath)) return
  try {
    fs.unlinkSync(filePath)
  } catch (err) {
    if (err.code === "EBUSY" && retries > 0) {
      await new Promise((r) => setTimeout(r, 100))
      return rmIfExists(filePath, retries - 1)
    }
    if (err.code !== "ENOENT") throw err
  }
}

async function cleanupPaths(paths) {
  if (!paths) return
  await rmIfExists(paths.db)
  await rmIfExists(paths.oldDb)
  await rmIfExists(paths.graph)
}

async function closeDb(db) {
  if (!db) return
  await new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()))
  })
}

async function shutdownGraph(graph) {
  if (!graph) return
  try {
    await graph.shutdown()
  } catch {
    /* ignore */
  }
}

async function createOldSchemaDatabase(dbPath, recordCount = 10) {
  await rmIfExists(dbPath)

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) reject(err)
    })

    db.serialize(() => {
      db.run(
        `CREATE TABLE pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          content TEXT,
          timestamp TEXT NOT NULL
        )`,
        (err) => {
          if (err) reject(err)
        }
      )

      if (recordCount === 0) {
        db.close((err) => (err ? reject(err) : resolve()))
        return
      }

      const stmt = db.prepare(
        `INSERT INTO pages (title, url, content, timestamp) VALUES (?, ?, ?, ?)`
      )

      for (let i = 1; i <= recordCount; i++) {
        const timestamp = new Date(Date.now() - i * 86400000).toISOString()
        stmt.run(
          `Test Page ${i}`,
          `https://example.com/page${i}`,
          `Test content for page ${i} about migration and testing.`,
          timestamp
        )
      }

      stmt.finalize((err) => {
        if (err) reject(err)
        else db.close((closeErr) => (closeErr ? reject(closeErr) : resolve()))
      })
    })
  })
}

describe("Data Migration", () => {
  let activePaths = null
  let activeDb = null
  let activeGraph = null

  before(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  after(async () => {
    await cleanupPaths(activePaths)
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    await closeDb(activeDb)
    activeDb = null
    await shutdownGraph(activeGraph)
    activeGraph = null
    await cleanupPaths(activePaths)
    activePaths = null
  })

  describe("Schema Migration", () => {
    it("should detect existing old database", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.oldDb, 5)
      assert.strictEqual(await detectOldDatabase(activePaths.oldDb), true)
    })

    it("should detect old schema (pages table)", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.oldDb, 5)
      activeDb = new sqlite3.Database(activePaths.oldDb)
      assert.strictEqual(await hasOldSchema(activeDb), true)
    })

    it("should create new schema (memories table)", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 5)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)
      assert.strictEqual(await hasNewSchema(activeDb), true)
    })

    it("should migrate pages to memories with default engagement metrics", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 10)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)

      const result = await migratePages(activeDb)
      assert.strictEqual(result.totalPages, 10)
      assert.strictEqual(result.migratedCount, 10)

      const memory = await new Promise((resolve, reject) => {
        activeDb.get(`SELECT * FROM memories LIMIT 1`, (err, row) => {
          if (err) reject(err)
          else resolve(row)
        })
      })

      assert.strictEqual(memory.dwell_time, 60000)
      assert.strictEqual(memory.scroll_depth, 50)
      assert.ok(memory.engagement_score > 0)
    })

    it("should preserve original timestamps", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 5)
      activeDb = new sqlite3.Database(activePaths.db)

      const originalPages = await new Promise((resolve, reject) => {
        activeDb.all(`SELECT timestamp FROM pages ORDER BY timestamp ASC`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        })
      })

      const { initializeSchema } = require("./init-schema")
      const schemaDb = await initializeSchema(activePaths.db)
      await migratePages(activeDb)
      await closeDb(schemaDb)

      const migrated = await new Promise((resolve, reject) => {
        activeDb.all(`SELECT timestamp FROM memories ORDER BY timestamp ASC`, (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        })
      })

      assert.strictEqual(migrated.length, originalPages.length)
      for (let i = 0; i < originalPages.length; i++) {
        assert.strictEqual(migrated[i].timestamp, originalPages[i].timestamp)
      }
    })

    it("should handle empty database", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 0)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)

      const result = await migratePages(activeDb)
      assert.strictEqual(result.totalPages, 0)
      assert.strictEqual(result.migratedCount, 0)
    })
  })

  describe("Historical Concept Extraction", () => {
    it("should process historical memories in batches", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 50)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)
      await migratePages(activeDb)

      activeGraph = new KnowledgeGraph(activePaths.graph)
      await activeGraph.initialize()

      const result = await extractHistoricalConcepts(activeDb, activeGraph, 10)
      assert.strictEqual(result.totalMemories, 50)
      assert.strictEqual(result.processedCount, 50)
      assert.ok(result.totalConcepts > 0)
    })

    it("should extract concepts from stored content", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 10)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)
      await migratePages(activeDb)

      activeGraph = new KnowledgeGraph(activePaths.graph)
      await activeGraph.initialize()

      const result = await extractHistoricalConcepts(activeDb, activeGraph, 5)
      assert.ok(result.totalConcepts > 0)
    })

    it("should build knowledge graph from historical data", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 20)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)
      await migratePages(activeDb)

      activeGraph = new KnowledgeGraph(activePaths.graph)
      await activeGraph.initialize()
      await extractHistoricalConcepts(activeDb, activeGraph, 10)

      const stats = activeGraph.getStats()
      assert.ok(stats.concepts > 0)
      assert.strictEqual(stats.memories, 20)
    })

    it("should handle batch processing correctly", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 25)
      const { initializeSchema } = require("./init-schema")
      activeDb = await initializeSchema(activePaths.db)
      await migratePages(activeDb)

      activeGraph = new KnowledgeGraph(activePaths.graph)
      await activeGraph.initialize()

      const result = await extractHistoricalConcepts(activeDb, activeGraph, 10)
      assert.strictEqual(result.processedCount, 25)
    })
  })

  describe("Migration Performance", () => {
    it("should complete migration of 100 records quickly", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 100)

      const startTime = Date.now()
      const result = await performMigration({
        dbPath: activePaths.db,
        batchSize: 50,
        skipEmbeddings: true,
        skipConcepts: false,
        knowledgeGraphPath: activePaths.graph
      })
      const duration = Date.now() - startTime

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.steps.pages.migratedCount, 100)
      assert.ok(duration < 30000)
    })

    it("should track migration progress", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 50)

      const result = await performMigration({
        dbPath: activePaths.db,
        batchSize: 25,
        skipEmbeddings: true,
        skipConcepts: false,
        knowledgeGraphPath: activePaths.graph
      })

      assert.strictEqual(result.success, true)
      assert.ok(result.duration >= 0)
      assert.ok(result.steps.pages)
      assert.ok(result.steps.concepts)
    })

    it("should verify record counts after migration", async () => {
      activePaths = testPaths()
      await createOldSchemaDatabase(activePaths.db, 30)

      await performMigration({
        dbPath: activePaths.db,
        batchSize: 10,
        skipEmbeddings: true,
        skipConcepts: true,
        knowledgeGraphPath: activePaths.graph
      })

      const verification = await verifyMigration(activePaths.db)
      assert.strictEqual(verification.valid, true)
      assert.strictEqual(verification.recordCounts.memories, 30)
    })
  })
})
