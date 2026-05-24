/**
 * Schema Migration Script
 * 
 * Migrates existing WebMind data from the old schema to the new Human-Like Memory Engine schema.
 * 
 * Migration steps:
 * 1. Detect existing webmind.db with old schema
 * 2. Backup existing database
 * 3. Create new schema tables
 * 4. Migrate data from pages table to memories table
 * 5. Generate default engagement metrics
 * 6. Create sessions from historical data
 * 7. Verify migration integrity
 */

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");
const { initializeSchema, verifySchema } = require("./init-schema");

/**
 * Check if old schema exists
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<boolean>} - True if old pages table exists
 */
function hasOldSchema(db) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='pages'
    `, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(!!row);
    });
  });
}

/**
 * Backup existing database
 * @param {string} dbPath - Path to database file
 * @returns {Promise<string>} - Path to backup file
 */
function backupDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = dbPath.replace('.db', `.backup-${timestamp}.db`);
    
    fs.copyFile(dbPath, backupPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log(`✓ Backup created: ${backupPath}`);
      resolve(backupPath);
    });
  });
}

/**
 * Migrate pages table to memories table
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<number>} - Number of records migrated
 */
function migratePages(db) {
  return new Promise((resolve, reject) => {
    // First, get count of pages to migrate
    db.get(`SELECT COUNT(*) as count FROM pages`, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      const totalPages = row.count;
      console.log(`Migrating ${totalPages} pages...`);

      // Migrate data with default engagement metrics
      db.run(`
        INSERT INTO memories (
          title, url, content, timestamp,
          dwell_time, scroll_depth, revisit_count,
          engagement_score, memory_strength,
          created_at
        )
        SELECT 
          title,
          url,
          content,
          timestamp,
          60000 as dwell_time,              -- Default 1 minute
          50.0 as scroll_depth,             -- Default 50% scroll
          0 as revisit_count,               -- Default no revisits
          0.35 as engagement_score,         -- Calculated from defaults
          0.14 as memory_strength,          -- engagement_score * 0.4
          timestamp as created_at
        FROM pages
      `, (err) => {
        if (err) {
          reject(err);
          return;
        }

        console.log(`✓ Migrated ${totalPages} pages to memories table`);
        resolve(totalPages);
      });
    });
  });
}

/**
 * Create sessions from historical data
 * Groups pages by date to create initial sessions
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<number>} - Number of sessions created
 */
function createHistoricalSessions(db) {
  return new Promise((resolve, reject) => {
    // Get all memories ordered by timestamp
    db.all(`
      SELECT id, url, timestamp 
      FROM memories 
      ORDER BY timestamp ASC
    `, (err, memories) => {
      if (err) {
        reject(err);
        return;
      }

      if (memories.length === 0) {
        resolve(0);
        return;
      }

      const sessions = [];
      let currentSession = null;
      const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds

      memories.forEach((memory, index) => {
        const timestamp = new Date(memory.timestamp).getTime();

        if (!currentSession || (timestamp - currentSession.lastTimestamp > SESSION_TIMEOUT)) {
          // Start new session
          if (currentSession) {
            sessions.push(currentSession);
          }

          currentSession = {
            id: `session-${Date.now()}-${index}`,
            startTime: memory.timestamp,
            endTime: memory.timestamp,
            lastTimestamp: timestamp,
            memoryIds: [memory.id],
            pageCount: 1
          };
        } else {
          // Add to current session
          currentSession.endTime = memory.timestamp;
          currentSession.lastTimestamp = timestamp;
          currentSession.memoryIds.push(memory.id);
          currentSession.pageCount++;
        }
      });

      // Add last session
      if (currentSession) {
        sessions.push(currentSession);
      }

      // Insert sessions and update memories
      const insertSession = db.prepare(`
        INSERT INTO sessions (id, start_time, end_time, page_count)
        VALUES (?, ?, ?, ?)
      `);

      const updateMemory = db.prepare(`
        UPDATE memories 
        SET session_id = ?, sequence_number = ?
        WHERE id = ?
      `);

      let completed = 0;

      sessions.forEach(session => {
        insertSession.run(
          session.id,
          session.startTime,
          session.endTime,
          session.pageCount,
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            // Update memories with session_id and sequence_number
            session.memoryIds.forEach((memoryId, seqNum) => {
              updateMemory.run(session.id, seqNum, memoryId);
            });

            completed++;
            if (completed === sessions.length) {
              insertSession.finalize();
              updateMemory.finalize();
              console.log(`✓ Created ${sessions.length} historical sessions`);
              resolve(sessions.length);
            }
          }
        );
      });
    });
  });
}

/**
 * Verify migration integrity
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<Object>} - Migration verification results
 */
function verifyMigration(db) {
  return new Promise((resolve, reject) => {
    const results = {
      oldPageCount: 0,
      newMemoryCount: 0,
      sessionCount: 0,
      configCount: 0
    };

    db.get(`SELECT COUNT(*) as count FROM pages`, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      results.oldPageCount = row.count;

      db.get(`SELECT COUNT(*) as count FROM memories`, (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        results.newMemoryCount = row.count;

        db.get(`SELECT COUNT(*) as count FROM sessions`, (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          results.sessionCount = row.count;

          db.get(`SELECT COUNT(*) as count FROM config`, (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            results.configCount = row.count;

            resolve(results);
          });
        });
      });
    });
  });
}

/**
 * Main migration function
 * @param {string} dbPath - Path to database file
 * @returns {Promise<Object>} - Migration results
 */
async function migrate(dbPath = "./webmind.db") {
  console.log("=".repeat(60));
  console.log("WebMind Schema Migration");
  console.log("=".repeat(60));

  if (!fs.existsSync(dbPath)) {
    console.log("No existing database found. Creating new schema...");
    const db = await initializeSchema(dbPath);
    db.close();
    console.log("✓ New schema created successfully");
    return { newInstallation: true };
  }

  const db = new sqlite3.Database(dbPath);

  try {
    // Check if old schema exists
    const hasOld = await hasOldSchema(db);

    if (!hasOld) {
      console.log("Database already uses new schema. No migration needed.");
      db.close();
      return { alreadyMigrated: true };
    }

    console.log("Old schema detected. Starting migration...\n");

    // Step 1: Backup
    console.log("Step 1: Creating backup...");
    await backupDatabase(dbPath);

    // Step 2: Create new schema
    console.log("\nStep 2: Creating new schema tables...");
    await initializeSchema(dbPath);

    // Step 3: Migrate pages
    console.log("\nStep 3: Migrating page data...");
    const migratedPages = await migratePages(db);

    // Step 4: Create sessions
    console.log("\nStep 4: Creating historical sessions...");
    const sessionsCreated = await createHistoricalSessions(db);

    // Step 5: Verify
    console.log("\nStep 5: Verifying migration...");
    const verification = await verifyMigration(db);

    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log("=".repeat(60));
    console.log(`Pages migrated:      ${verification.oldPageCount} → ${verification.newMemoryCount}`);
    console.log(`Sessions created:    ${verification.sessionCount}`);
    console.log(`Config entries:      ${verification.configCount}`);
    console.log("=".repeat(60));

    if (verification.oldPageCount === verification.newMemoryCount) {
      console.log("✓ Migration completed successfully!");
    } else {
      console.log("⚠ Warning: Page count mismatch. Please verify data.");
    }

    db.close();

    return {
      success: true,
      migratedPages,
      sessionsCreated,
      verification
    };

  } catch (err) {
    db.close();
    throw err;
  }
}

// Export functions
module.exports = {
  migrate,
  hasOldSchema,
  backupDatabase,
  migratePages,
  createHistoricalSessions,
  verifyMigration
};

// CLI execution
if (require.main === module) {
  const dbPath = process.argv[2] || "./webmind.db";
  
  migrate(dbPath)
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error("\n✗ Migration failed:", err.message);
      console.error(err.stack);
      process.exit(1);
    });
}
