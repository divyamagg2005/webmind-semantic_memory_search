/**
 * Unit tests for schema migration
 * 
 * Tests cover:
 * - Detection of old schema
 * - Data migration from pages to memories
 * - Session creation from historical data
 * - Migration verification
 * - Backup creation
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { 
  migrate, 
  hasOldSchema, 
  migratePages, 
  createHistoricalSessions,
  verifyMigration 
} = require("./migrate-schema");

// Use unique database files for each test to avoid locking issues
let testCounter = 0;
function getTestDbPath() {
  return path.join(__dirname, `test-migration-${Date.now()}-${testCounter++}.db`);
}

/**
 * Create a database with old schema for testing
 */
function createOldSchemaDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    db.serialize(() => {
      // Create old pages table
      db.run(`
        CREATE TABLE IF NOT EXISTS pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          url TEXT,
          content TEXT,
          timestamp TEXT
        )
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Insert sample data
        const stmt = db.prepare(`
          INSERT INTO pages (title, url, content, timestamp) VALUES (?, ?, ?, ?)
        `);

        const now = Date.now();
        const samplePages = [
          ['Page 1', 'https://example.com/1', 'Content 1', new Date(now - 3600000).toISOString()],
          ['Page 2', 'https://example.com/2', 'Content 2', new Date(now - 3000000).toISOString()],
          ['Page 3', 'https://example.com/3', 'Content 3', new Date(now - 2400000).toISOString()],
          ['Page 4', 'https://example.com/4', 'Content 4', new Date(now - 1800000).toISOString()],
          ['Page 5', 'https://example.com/5', 'Content 5', new Date(now).toISOString()]
        ];

        samplePages.forEach(page => {
          stmt.run(page);
        });

        stmt.finalize((err) => {
          if (err) {
            reject(err);
          } else {
            resolve(db);
          }
        });
      });
    });
  });
}

function cleanupDb(dbPath, db) {
  return new Promise((resolve) => {
    if (db) {
      db.close(() => {
        setTimeout(() => {
          try {
            if (fs.existsSync(dbPath)) {
              fs.unlinkSync(dbPath);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          resolve();
        }, 50);
      });
    } else {
      setTimeout(() => {
        try {
          if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        resolve();
      }, 50);
    }
  });
}

describe("Schema Migration", () => {
  test("should detect old schema", async () => {
    const dbPath = getTestDbPath();
    const db = await createOldSchemaDb(dbPath);
    const hasOld = await hasOldSchema(db);
    
    assert.strictEqual(hasOld, true, "Should detect old pages table");
    
    await cleanupDb(dbPath, db);
  });

  test("should migrate pages to memories table", async () => {
    const dbPath = getTestDbPath();
    const db = await createOldSchemaDb(dbPath);
    
    // Initialize new schema
    const { initializeSchema } = require("./init-schema");
    await initializeSchema(dbPath);
    
    // Migrate pages
    const migratedCount = await migratePages(db);
    
    assert.strictEqual(migratedCount, 5, "Should migrate 5 pages");
    
    // Verify data in memories table
    await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM memories`, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        assert.strictEqual(rows.length, 5, "Should have 5 memories");
        
        // Check default engagement metrics
        rows.forEach(row => {
          assert.strictEqual(row.dwell_time, 60000, "Should have default dwell_time");
          assert.strictEqual(row.scroll_depth, 50.0, "Should have default scroll_depth");
          assert.strictEqual(row.revisit_count, 0, "Should have default revisit_count");
          assert.strictEqual(row.engagement_score, 0.35, "Should have calculated engagement_score");
        });
        
        resolve();
      });
    });
    
    await cleanupDb(dbPath, db);
  });

  test("should create historical sessions", async () => {
    const dbPath = getTestDbPath();
    const db = await createOldSchemaDb(dbPath);
    
    // Initialize new schema and migrate
    const { initializeSchema } = require("./init-schema");
    await initializeSchema(dbPath);
    await migratePages(db);
    
    // Create sessions
    const sessionCount = await createHistoricalSessions(db);
    
    assert.ok(sessionCount > 0, "Should create at least one session");
    
    // Verify sessions
    await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM sessions`, (err, sessions) => {
        if (err) {
          reject(err);
          return;
        }
        
        assert.ok(sessions.length > 0, "Should have sessions");
        
        sessions.forEach(session => {
          assert.ok(session.id, "Session should have ID");
          assert.ok(session.start_time, "Session should have start_time");
          assert.ok(session.page_count > 0, "Session should have page_count");
        });
        
        // Verify memories have session_id
        db.all(`SELECT * FROM memories WHERE session_id IS NOT NULL`, (err, memories) => {
          if (err) {
            reject(err);
            return;
          }
          
          assert.ok(memories.length > 0, "Memories should have session_id");
          resolve();
        });
      });
    });
    
    await cleanupDb(dbPath, db);
  });

  test("should verify migration integrity", async () => {
    const dbPath = getTestDbPath();
    const db = await createOldSchemaDb(dbPath);
    
    // Initialize new schema and migrate
    const { initializeSchema } = require("./init-schema");
    await initializeSchema(dbPath);
    await migratePages(db);
    await createHistoricalSessions(db);
    
    // Verify migration
    const results = await verifyMigration(db);
    
    assert.strictEqual(results.oldPageCount, 5, "Should have 5 old pages");
    assert.strictEqual(results.newMemoryCount, 5, "Should have 5 new memories");
    assert.ok(results.sessionCount > 0, "Should have sessions");
    assert.ok(results.configCount >= 6, "Should have config entries");
    
    await cleanupDb(dbPath, db);
  });

  test("should handle empty database migration", async () => {
    const dbPath = getTestDbPath();
    const db = new sqlite3.Database(dbPath);
    
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          url TEXT,
          content TEXT,
          timestamp TEXT
        )
      `, async (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Initialize new schema and migrate
        const { initializeSchema } = require("./init-schema");
        await initializeSchema(dbPath);
        
        const migratedCount = await migratePages(db);
        assert.strictEqual(migratedCount, 0, "Should migrate 0 pages");
        
        const sessionCount = await createHistoricalSessions(db);
        assert.strictEqual(sessionCount, 0, "Should create 0 sessions");
        
        resolve();
      });
    });
    
    await cleanupDb(dbPath, db);
  });
});

describe("Full Migration", () => {
  test("should perform full migration", async () => {
    const dbPath = getTestDbPath();
    
    // Create database with old schema
    const db = await createOldSchemaDb(dbPath);
    
    // Close the database before running migration
    await new Promise((resolve) => {
      db.close(() => setTimeout(resolve, 100));
    });
    
    // Run full migration
    const result = await migrate(dbPath);
    
    assert.strictEqual(result.success, true, "Migration should succeed");
    assert.strictEqual(result.migratedPages, 5, "Should migrate 5 pages");
    assert.ok(result.sessionsCreated > 0, "Should create sessions");
    assert.strictEqual(
      result.verification.oldPageCount,
      result.verification.newMemoryCount,
      "Page counts should match"
    );
    
    // Cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      // Clean up backup files
      const dir = path.dirname(dbPath);
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        if (file.includes('test-migration') && file.includes('.backup-')) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch (e) {
            // Ignore
          }
        }
      });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test("should handle new installation", async () => {
    const dbPath = getTestDbPath();
    
    // Run migration on non-existent database
    const result = await migrate(dbPath);
    
    assert.strictEqual(result.newInstallation, true, "Should detect new installation");
    assert.ok(fs.existsSync(dbPath), "Should create new database");
    
    // Cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch (e) {
      // Ignore cleanup errors
    }
  });
});
