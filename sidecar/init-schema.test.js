/**
 * Unit tests for SQLite schema initialization
 * 
 * Tests cover:
 * - Table creation
 * - Index creation
 * - Default configuration insertion
 * - Schema verification
 * - Foreign key constraints
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { initializeSchema, getConfig, verifySchema } = require("./init-schema");

const TEST_DB_PATH = path.join(__dirname, "test-webmind.db");

describe("Schema Initialization", () => {
  let db;

  before(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  after(() => {
    // Clean up test database
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  test("should create database file", async () => {
    db = await initializeSchema(TEST_DB_PATH);
    assert.ok(fs.existsSync(TEST_DB_PATH), "Database file should exist");
  });

  test("should create memories table with all columns", async () => {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(memories)`, (err, columns) => {
        if (err) {
          reject(err);
          return;
        }

        const columnNames = columns.map(col => col.name);
        
        // Check required columns exist
        const requiredColumns = [
          'id', 'title', 'url', 'content', 'timestamp',
          'dwell_time', 'scroll_depth', 'revisit_count', 'last_accessed',
          'session_id', 'tab_group_id', 'sequence_number', 'previous_url',
          'is_bookmarked', 'is_pinned',
          'engagement_score', 'memory_strength',
          'created_at', 'updated_at'
        ];

        requiredColumns.forEach(col => {
          assert.ok(
            columnNames.includes(col),
            `Column ${col} should exist in memories table`
          );
        });

        resolve();
      });
    });
  });

  test("should create sessions table", async () => {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(sessions)`, (err, columns) => {
        if (err) {
          reject(err);
          return;
        }

        const columnNames = columns.map(col => col.name);
        const requiredColumns = ['id', 'start_time', 'end_time', 'page_count', 'dominant_concepts', 'label'];

        requiredColumns.forEach(col => {
          assert.ok(
            columnNames.includes(col),
            `Column ${col} should exist in sessions table`
          );
        });

        resolve();
      });
    });
  });

  test("should create images table with foreign key", async () => {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(images)`, (err, columns) => {
        if (err) {
          reject(err);
          return;
        }

        const columnNames = columns.map(col => col.name);
        const requiredColumns = ['id', 'memory_id', 'url', 'width', 'height', 'alt'];

        requiredColumns.forEach(col => {
          assert.ok(
            columnNames.includes(col),
            `Column ${col} should exist in images table`
          );
        });

        // Check foreign key constraint
        db.all(`PRAGMA foreign_key_list(images)`, (err, fks) => {
          if (err) {
            reject(err);
            return;
          }

          const hasForeignKey = fks.some(fk => fk.table === 'memories' && fk.from === 'memory_id');
          assert.ok(hasForeignKey, "Foreign key constraint should exist on memory_id");
          resolve();
        });
      });
    });
  });

  test("should create videos table with foreign key", async () => {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(videos)`, (err, columns) => {
        if (err) {
          reject(err);
          return;
        }

        const columnNames = columns.map(col => col.name);
        const requiredColumns = ['id', 'memory_id', 'url', 'duration', 'thumbnail_url'];

        requiredColumns.forEach(col => {
          assert.ok(
            columnNames.includes(col),
            `Column ${col} should exist in videos table`
          );
        });

        // Check foreign key constraint
        db.all(`PRAGMA foreign_key_list(videos)`, (err, fks) => {
          if (err) {
            reject(err);
            return;
          }

          const hasForeignKey = fks.some(fk => fk.table === 'memories' && fk.from === 'memory_id');
          assert.ok(hasForeignKey, "Foreign key constraint should exist on memory_id");
          resolve();
        });
      });
    });
  });

  test("should create config table", async () => {
    return new Promise((resolve, reject) => {
      db.all(`PRAGMA table_info(config)`, (err, columns) => {
        if (err) {
          reject(err);
          return;
        }

        const columnNames = columns.map(col => col.name);
        const requiredColumns = ['key', 'value', 'updated_at'];

        requiredColumns.forEach(col => {
          assert.ok(
            columnNames.includes(col),
            `Column ${col} should exist in config table`
          );
        });

        resolve();
      });
    });
  });

  test("should create performance indexes", async () => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_memories_%'
      `, (err, indexes) => {
        if (err) {
          reject(err);
          return;
        }

        const indexNames = indexes.map(idx => idx.name);
        const requiredIndexes = [
          'idx_memories_url',
          'idx_memories_session',
          'idx_memories_timestamp'
        ];

        requiredIndexes.forEach(idx => {
          assert.ok(
            indexNames.includes(idx),
            `Index ${idx} should exist`
          );
        });

        resolve();
      });
    });
  });

  test("should insert default configuration values", async () => {
    const config = await getConfig(db);

    const expectedConfig = {
      'decay_rate': '0.02',
      'engagement_weight_dwell': '0.4',
      'engagement_weight_scroll': '0.3',
      'engagement_weight_revisit': '0.3',
      'session_timeout': '1800',
      'min_cluster_size': '3'
    };

    Object.keys(expectedConfig).forEach(key => {
      assert.strictEqual(
        config[key],
        expectedConfig[key],
        `Config ${key} should equal ${expectedConfig[key]}`
      );
    });
  });

  test("should verify schema integrity", async () => {
    const results = await verifySchema(db);

    // Check all tables exist
    const expectedTables = ['memories', 'sessions', 'images', 'videos', 'config'];
    expectedTables.forEach(table => {
      assert.ok(
        results.tables[table],
        `Table ${table} should be verified`
      );
    });

    // Check indexes exist
    assert.ok(results.indexes.length >= 3, "At least 3 indexes should exist");
  });

  test("should set default values for engagement metrics", async () => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO memories (title, url, content, timestamp)
        VALUES (?, ?, ?, ?)
      `, ['Test Page', 'https://example.com', 'Test content', new Date().toISOString()], function(err) {
        if (err) {
          reject(err);
          return;
        }

        const memoryId = this.lastID;

        db.get(`SELECT * FROM memories WHERE id = ?`, [memoryId], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          assert.strictEqual(row.dwell_time, 0, "Default dwell_time should be 0");
          assert.strictEqual(row.scroll_depth, 0, "Default scroll_depth should be 0");
          assert.strictEqual(row.revisit_count, 0, "Default revisit_count should be 0");
          assert.strictEqual(row.is_bookmarked, 0, "Default is_bookmarked should be 0");
          assert.strictEqual(row.is_pinned, 0, "Default is_pinned should be 0");
          assert.strictEqual(row.engagement_score, 0, "Default engagement_score should be 0");
          assert.strictEqual(row.memory_strength, 0, "Default memory_strength should be 0");

          resolve();
        });
      });
    });
  });

  test("should enforce foreign key cascade delete", async () => {
    return new Promise((resolve, reject) => {
      // Enable foreign keys
      db.run(`PRAGMA foreign_keys = ON`, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Insert a memory
        db.run(`
          INSERT INTO memories (title, url, content, timestamp)
          VALUES (?, ?, ?, ?)
        `, ['Test Page', 'https://example.com/test', 'Test content', new Date().toISOString()], function(err) {
          if (err) {
            reject(err);
            return;
          }

          const memoryId = this.lastID;

          // Insert an image linked to the memory
          db.run(`
            INSERT INTO images (memory_id, url, width, height, alt)
            VALUES (?, ?, ?, ?, ?)
          `, [memoryId, 'https://example.com/image.jpg', 800, 600, 'Test image'], function(err) {
            if (err) {
              reject(err);
              return;
            }

            const imageId = this.lastID;

            // Delete the memory
            db.run(`DELETE FROM memories WHERE id = ?`, [memoryId], (err) => {
              if (err) {
                reject(err);
                return;
              }

              // Check that the image was also deleted
              db.get(`SELECT * FROM images WHERE id = ?`, [imageId], (err, row) => {
                if (err) {
                  reject(err);
                  return;
                }

                assert.strictEqual(row, undefined, "Image should be deleted when memory is deleted");
                resolve();
              });
            });
          });
        });
      });
    });
  });

  test("should handle duplicate config keys with INSERT OR IGNORE", async () => {
    return new Promise((resolve, reject) => {
      // Try to insert a duplicate config key
      db.run(`
        INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)
      `, ['decay_rate', '0.05'], (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Verify the original value is preserved
        db.get(`SELECT value FROM config WHERE key = ?`, ['decay_rate'], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          assert.strictEqual(row.value, '0.02', "Original config value should be preserved");
          resolve();
        });
      });
    });
  });
});

describe("Edge Cases", () => {
  let db;

  before(async () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    db = await initializeSchema(TEST_DB_PATH);
  });

  after(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  test("should handle NULL values in optional fields", async () => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO memories (title, url, timestamp, session_id, tab_group_id)
        VALUES (?, ?, ?, ?, ?)
      `, ['Test', 'https://example.com', new Date().toISOString(), null, null], function(err) {
        if (err) {
          reject(err);
          return;
        }

        db.get(`SELECT * FROM memories WHERE id = ?`, [this.lastID], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          assert.strictEqual(row.session_id, null, "NULL session_id should be allowed");
          assert.strictEqual(row.tab_group_id, null, "NULL tab_group_id should be allowed");
          resolve();
        });
      });
    });
  });

  test("should handle empty string content", async () => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO memories (title, url, content, timestamp)
        VALUES (?, ?, ?, ?)
      `, ['Empty Content', 'https://example.com/empty', '', new Date().toISOString()], function(err) {
        if (err) {
          reject(err);
          return;
        }

        db.get(`SELECT * FROM memories WHERE id = ?`, [this.lastID], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          assert.strictEqual(row.content, '', "Empty string content should be allowed");
          resolve();
        });
      });
    });
  });

  test("should handle large engagement values", async () => {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO memories (title, url, timestamp, dwell_time, scroll_depth, revisit_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `, ['High Engagement', 'https://example.com/high', new Date().toISOString(), 999999, 100.0, 1000], function(err) {
        if (err) {
          reject(err);
          return;
        }

        db.get(`SELECT * FROM memories WHERE id = ?`, [this.lastID], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          assert.strictEqual(row.dwell_time, 999999, "Large dwell_time should be stored");
          assert.strictEqual(row.scroll_depth, 100.0, "Max scroll_depth should be stored");
          assert.strictEqual(row.revisit_count, 1000, "Large revisit_count should be stored");
          resolve();
        });
      });
    });
  });
});
