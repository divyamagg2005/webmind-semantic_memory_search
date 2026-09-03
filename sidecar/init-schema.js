/**
 * SQLite Schema Initialization for Human-Like Memory Engine
 * 
 * This script creates the extended schema with:
 * - memories table with engagement metrics
 * - sessions table for browsing session tracking
 * - images and videos tables for multi-modal content
 * - config table for system configuration
 * - Performance indexes
 * - Default configuration values
 */

const sqlite3 = require("sqlite3").verbose();

/**
 * Initialize the extended SQLite schema
 * @param {string|sqlite3.Database} dbOrPath - Path or existing database connection
 * @returns {Promise<sqlite3.Database>} - Initialized database instance
 */
function initializeSchema(dbOrPath = "./webmind.db") {
  return new Promise((resolve, reject) => {
    const runSchema = (db) => {
    db.serialize(() => {
      // Create memories table with engagement metrics
      db.run(`
        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          content TEXT,
          timestamp TEXT NOT NULL,
          
          -- Engagement metrics
          dwell_time INTEGER DEFAULT 0,
          scroll_depth REAL DEFAULT 0,
          revisit_count INTEGER DEFAULT 0,
          last_accessed TEXT,
          
          -- Context
          session_id TEXT,
          tab_group_id TEXT,
          sequence_number INTEGER,
          previous_url TEXT,
          
          -- Priority signals
          is_bookmarked BOOLEAN DEFAULT 0,
          is_pinned BOOLEAN DEFAULT 0,
          
          -- Calculated scores
          engagement_score REAL DEFAULT 0,
          memory_strength REAL DEFAULT 0,
          
          -- Metadata
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
      });

      // Create indexes for memories table
      db.run(`CREATE INDEX IF NOT EXISTS idx_memories_url ON memories(url)`, (err) => {
        if (err) reject(err);
      });

      db.run(`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`, (err) => {
        if (err) reject(err);
      });

      db.run(`CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp)`, (err) => {
        if (err) reject(err);
      });

      // Create browsing sessions table
      db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          start_time TEXT NOT NULL,
          end_time TEXT,
          page_count INTEGER DEFAULT 0,
          dominant_concepts TEXT,
          label TEXT
        )
      `, (err) => {
        if (err) reject(err);
      });

      // Create images table
      db.run(`
        CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL,
          url TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          alt TEXT,
          caption TEXT,
          embedding_stored INTEGER DEFAULT 0,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
      });

      // Idempotent upgrade: add caption/embedding_stored to pre-existing images tables
      db.all(`PRAGMA table_info(images)`, (err, cols) => {
        if (err) return;
        const names = new Set((cols || []).map((c) => c.name));
        if (!names.has("caption")) {
          db.run(`ALTER TABLE images ADD COLUMN caption TEXT`);
        }
        if (!names.has("embedding_stored")) {
          db.run(`ALTER TABLE images ADD COLUMN embedding_stored INTEGER DEFAULT 0`);
        }
      });

      // Create videos table
      db.run(`
        CREATE TABLE IF NOT EXISTS videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL,
          url TEXT NOT NULL,
          duration INTEGER,
          thumbnail_url TEXT,
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
      });

      // Create configuration table
      db.run(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
      });

      // Insert default configuration values
      const defaultConfig = [
        ['decay_rate', '0.02'],
        ['engagement_weight_dwell', '0.4'],
        ['engagement_weight_scroll', '0.3'],
        ['engagement_weight_revisit', '0.3'],
        ['session_timeout', '1800'],
        ['min_cluster_size', '3'],
        ['vision_model', 'llava'],
        ['image_caption_enabled', '1'],
        ['max_images_per_page', '6']
      ];

      const insertConfig = db.prepare(`
        INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)
      `);

      defaultConfig.forEach(([key, value]) => {
        insertConfig.run(key, value, (err) => {
          if (err) reject(err);
        });
      });

      insertConfig.finalize((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(db);
        }
      });
    });
    };

    if (typeof dbOrPath === "string") {
      const db = new sqlite3.Database(dbOrPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        runSchema(db);
      });
    } else if (dbOrPath && typeof dbOrPath.run === "function") {
      runSchema(dbOrPath);
    } else {
      reject(new TypeError("initializeSchema expects a db path string or sqlite3 Database instance"));
    }
  });
}

/**
 * Get all configuration values
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<Object>} - Configuration key-value pairs
 */
function getConfig(db) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT key, value FROM config`, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      
      const config = {};
      rows.forEach(row => {
        config[row.key] = row.value;
      });
      
      resolve(config);
    });
  });
}

/**
 * Verify schema integrity
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<Object>} - Schema verification results
 */
function verifySchema(db) {
  return new Promise((resolve, reject) => {
    const results = {
      tables: {},
      indexes: []
    };

    // Check tables exist
    db.all(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('memories', 'sessions', 'images', 'videos', 'config')
    `, (err, tables) => {
      if (err) {
        reject(err);
        return;
      }

      tables.forEach(table => {
        results.tables[table.name] = true;
      });

      // Check indexes exist
      db.all(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_memories_%'
      `, (err, indexes) => {
        if (err) {
          reject(err);
          return;
        }

        results.indexes = indexes.map(idx => idx.name);
        resolve(results);
      });
    });
  });
}

// Export functions
module.exports = {
  initializeSchema,
  getConfig,
  verifySchema
};

// CLI execution
if (require.main === module) {
  console.log("Initializing WebMind database schema...");
  
  initializeSchema()
    .then(db => {
      console.log("✓ Schema created successfully");
      return verifySchema(db);
    })
    .then(results => {
      console.log("✓ Schema verification:");
      console.log("  Tables:", Object.keys(results.tables).join(", "));
      console.log("  Indexes:", results.indexes.join(", "));
      process.exit(0);
    })
    .catch(err => {
      console.error("✗ Schema initialization failed:", err.message);
      process.exit(1);
    });
}
