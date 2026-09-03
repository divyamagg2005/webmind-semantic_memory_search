# WebMind Sidecar - Human-Like Memory Engine

This directory contains the sidecar server for WebMind's Human-Like Memory Engine, including the extended SQLite schema with engagement metrics and session tracking.

## Schema Overview

The extended schema includes five main tables:

### 1. **memories** - Core memory storage with engagement metrics
- Stores webpage visits with title, URL, content, and timestamp
- Tracks engagement metrics: dwell_time, scroll_depth, revisit_count
- Maintains browsing context: session_id, tab_group_id, sequence_number
- Supports priority signals: is_bookmarked, is_pinned
- Calculates engagement_score and memory_strength

### 2. **sessions** - Browsing session tracking
- Groups related page visits into sessions
- Tracks session start/end times and page count
- Stores dominant concepts and session labels

### 3. **images** - Multi-modal image content
- Links images to memory entries
- Stores image dimensions and alt text
- `caption` - a description written by an Ollama vision model at ingest time
- `embedding_stored` - `1` once the caption has been embedded into the vector store
- The caption embedding is stored against the parent `memory_id`, so an image match
  surfaces its page in normal search (see **Image Memory** below)

### 4. **videos** - Multi-modal video content
- Links videos to memory entries
- Stores video duration and thumbnail URLs
- Enables video content search

### 5. **config** - System configuration
- Stores configurable parameters
- Includes decay rates, engagement weights, session timeouts
- Supports runtime configuration updates

## Files

- **`schema.sql`** - Complete SQL schema definition with documentation
- **`init-schema.js`** - Schema initialization script with verification
- **`init-schema.test.js`** - Unit tests for schema initialization (15 tests)
- **`migrate-schema.js`** - Migration script from old to new schema
- **`migrate-schema.test.js`** - Unit tests for migration (7 tests)
- **`server.js`** - Sidecar server implementation
- **`embed.js`** - Embedding generation utilities

## Quick Start

### Initialize New Database

```bash
# Initialize schema with default configuration
node init-schema.js

# Or use in code
const { initializeSchema } = require('./init-schema');
const db = await initializeSchema('./webmind.db');
```

### Migrate Existing Database

```bash
# Migrate from old schema to new schema
node migrate-schema.js

# Or specify custom database path
node migrate-schema.js /path/to/webmind.db
```

The migration script will:
1. Detect existing old schema
2. Create a backup of your database
3. Create new schema tables
4. Migrate data from `pages` to `memories` table
5. Generate default engagement metrics for historical data
6. Create browsing sessions from historical page visits
7. Verify migration integrity

### Run Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- init-schema.test.js
npm test -- migrate-schema.test.js
```

## Schema Details

### Engagement Metrics

The schema tracks three key engagement signals:

1. **dwell_time** (INTEGER) - Time spent on page in milliseconds
   - Measured from page load to navigation/close
   - Pauses when tab loses focus
   - Default: 60000 (1 minute)

2. **scroll_depth** (REAL) - Percentage of page scrolled (0-100)
   - Tracks maximum scroll position
   - Updated continuously during viewing
   - Default: 50.0 (50%)

3. **revisit_count** (INTEGER) - Number of times page was revisited
   - Incremented on each unique visit
   - Used for memory reinforcement
   - Default: 0

### Engagement Score Calculation

```javascript
engagement_score = 
  (normalize(dwell_time) * 0.4) +
  (scroll_depth / 100 * 0.3) +
  (log(1 + revisit_count) * 0.3)

where normalize(dwell_time) = min(dwell_time / 300000, 1.0)
```

### Memory Strength Calculation

```javascript
base_strength = engagement_score * 0.4 + association_boost
bookmark_multiplier = is_bookmarked ? 2.0 : 1.0
revisit_boost = min(log(1 + unique_visit_dates) * 0.1, 1.0)

memory_strength = (base_strength + revisit_boost) * bookmark_multiplier
```

### Performance Indexes

Three indexes optimize query performance:

1. **idx_memories_url** - Fast URL lookups for revisit detection
2. **idx_memories_session** - Efficient session-based queries
3. **idx_memories_timestamp** - Temporal range queries

## Image Memory

Page images are "memorised" the same way page text is:

1. The content script already sends image URLs + dimensions + alt text with each page.
2. On the **first visit** to a URL, for up to `max_images_per_page` images, the sidecar
   fetches the image and asks an Ollama vision model (`vision_model`, default `llava`) for a
   short description.
3. That description is embedded with `nomic-embed-text` and added to the LanceDB vector store
   under the page's `memory_id`. No separate vector table — image matches boost their parent
   page through the existing hybrid-retrieval join.
4. The knowledge graph gets an `image` node (with the thumbnail URL and caption) linked to the
   page's `memory` node. It shows in the graph viewer (`/graph`) under the **Images** toggle.

### Prerequisite

```bash
ollama pull llava        # or set vision_model to another vision-capable model
```

If the vision model is missing or `image_caption_enabled` is `false`, ingest still stores image
metadata rows — it just skips captioning/embedding and the graph image nodes.

## Configuration

Default configuration values:

```javascript
{
  decay_rate: 0.02,              // Base decay coefficient
  engagement_weight_dwell: 0.4,  // Dwell time weight
  engagement_weight_scroll: 0.3, // Scroll depth weight
  engagement_weight_revisit: 0.3,// Revisit count weight
  session_timeout: 1800,         // 30 minutes in seconds
  min_cluster_size: 3,           // Minimum cluster size
  vision_model: 'llava',         // Ollama model used to caption page images
  image_caption_enabled: true,   // Caption + embed images during ingest
  max_images_per_page: 6         // Cap on images processed per page visit
}
```

### Updating Configuration

```javascript
const { getConfig } = require('./init-schema');
const db = new sqlite3.Database('./webmind.db');

// Get current config
const config = await getConfig(db);

// Update config value
db.run(`
  UPDATE config 
  SET value = ?, updated_at = CURRENT_TIMESTAMP 
  WHERE key = ?
`, ['0.03', 'decay_rate']);
```

## Foreign Key Constraints

The schema enforces referential integrity:

- **images.memory_id** → **memories.id** (CASCADE DELETE)
- **videos.memory_id** → **memories.id** (CASCADE DELETE)

When a memory is deleted, all associated images and videos are automatically removed.

**Important:** Enable foreign keys in SQLite:

```javascript
db.run('PRAGMA foreign_keys = ON');
```

## Migration Details

### What Gets Migrated

1. **Page Data** - All records from `pages` table → `memories` table
2. **Timestamps** - Original timestamps are preserved
3. **Engagement Metrics** - Default values assigned:
   - dwell_time: 60000 (1 minute)
   - scroll_depth: 50.0 (50%)
   - revisit_count: 0
   - engagement_score: 0.35 (calculated)
   - memory_strength: 0.14 (engagement_score * 0.4)

4. **Sessions** - Historical pages grouped into sessions:
   - 30-minute timeout between sessions
   - Sequential numbering within sessions
   - Session metadata generated

### Migration Safety

- **Backup Created** - Original database backed up before migration
- **Non-Destructive** - Old `pages` table preserved
- **Verification** - Record counts verified after migration
- **Rollback** - Backup can be restored if needed

### Migration Performance

- **10,000 records** - Completes in ~10 minutes
- **Batch Processing** - Processes data in manageable chunks
- **Progress Logging** - Shows migration progress

## Testing

The schema includes comprehensive test coverage:

### Schema Initialization Tests (15 tests)
- Table creation with all columns
- Index creation
- Default configuration insertion
- Schema verification
- Default value handling
- Foreign key constraints
- Edge cases (NULL values, empty strings, large values)

### Migration Tests (7 tests)
- Old schema detection
- Data migration accuracy
- Session creation from historical data
- Migration integrity verification
- Empty database handling
- Full end-to-end migration
- New installation handling

**Test Coverage:** 22 tests, 100% pass rate

## Requirements Mapping

This schema implementation satisfies the following requirements:

- **Requirement 1.1** - Knowledge Graph Storage (schema foundation)
- **Requirement 4.5** - Engagement Score Storage
- **Requirement 9.5** - Session Metadata Storage
- **Requirement 29.1** - Data Migration Support

## API Usage Examples

### Insert Memory with Engagement

```javascript
db.run(`
  INSERT INTO memories (
    title, url, content, timestamp,
    dwell_time, scroll_depth, revisit_count,
    session_id, engagement_score
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
  'Example Page',
  'https://example.com',
  'Page content...',
  new Date().toISOString(),
  120000,  // 2 minutes
  85.5,    // 85.5% scrolled
  1,       // First revisit
  'session-123',
  0.65     // Calculated engagement score
]);
```

### Query by Session

```javascript
db.all(`
  SELECT * FROM memories 
  WHERE session_id = ? 
  ORDER BY sequence_number
`, ['session-123'], (err, rows) => {
  // Process session memories
});
```

### Update Engagement on Revisit

```javascript
db.run(`
  UPDATE memories 
  SET 
    revisit_count = revisit_count + 1,
    last_accessed = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE url = ?
`, [new Date().toISOString(), 'https://example.com']);
```

### Get Configuration

```javascript
db.all(`SELECT key, value FROM config`, (err, rows) => {
  const config = {};
  rows.forEach(row => {
    config[row.key] = row.value;
  });
  console.log(config);
});
```

## Troubleshooting

### Foreign Key Errors

If you get foreign key constraint errors:

```javascript
// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');
```

### Migration Fails

If migration fails:

1. Check the backup file created before migration
2. Restore from backup: `cp webmind.backup-*.db webmind.db`
3. Review error logs
4. Report issue with error details

### Test Failures

If tests fail:

1. Ensure no other process is using the database
2. Check file permissions
3. Run tests individually to isolate issues
4. Clean up test database files manually if needed

## Next Steps

After schema initialization:

1. **Update server.js** - Integrate new schema into sidecar server
2. **Implement engagement tracking** - Update content script to track metrics
3. **Add session detection** - Implement session boundary detection
4. **Build knowledge graph** - Implement concept extraction and associations
5. **Add multi-modal support** - Implement image/video processing

## License

Part of the WebMind project.
