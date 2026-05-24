-- ============================================================================
-- WebMind Human-Like Memory Engine - SQLite Schema
-- ============================================================================
-- This schema supports the Human-Like Memory Engine with:
-- - Extended memory entries with engagement metrics
-- - Browsing session tracking
-- - Multi-modal content (images, videos)
-- - System configuration
-- - Performance indexes
-- ============================================================================

-- ============================================================================
-- MEMORIES TABLE
-- ============================================================================
-- Stores webpage visits with engagement metrics and context
CREATE TABLE IF NOT EXISTS memories (
  -- Primary identification
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  content TEXT,
  timestamp TEXT NOT NULL,
  
  -- Engagement metrics (Requirements 4.1-4.7)
  dwell_time INTEGER DEFAULT 0,           -- Time spent on page in milliseconds
  scroll_depth REAL DEFAULT 0,            -- Percentage of page scrolled (0-100)
  revisit_count INTEGER DEFAULT 0,        -- Number of times page was revisited
  last_accessed TEXT,                     -- ISO timestamp of last access
  
  -- Browsing context (Requirements 9.1-9.6, 11.1-11.5)
  session_id TEXT,                        -- Links to sessions table
  tab_group_id TEXT,                      -- Chrome tab group identifier
  sequence_number INTEGER,                -- Position within browsing session
  previous_url TEXT,                      -- URL visited before this page
  
  -- Priority signals (Requirements 18.1-18.5, 19.1-19.5)
  is_bookmarked BOOLEAN DEFAULT 0,        -- User bookmarked this page
  is_pinned BOOLEAN DEFAULT 0,            -- User pinned (prevents decay)
  
  -- Calculated scores (Requirements 4.4, 7.1-7.6)
  engagement_score REAL DEFAULT 0,        -- Weighted engagement metric
  memory_strength REAL DEFAULT 0,         -- Combined priority score
  
  -- Metadata
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes (Requirement 29.5)
CREATE INDEX IF NOT EXISTS idx_memories_url ON memories(url);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================
-- Tracks browsing sessions for contextual memory (Requirements 9.1-9.6)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                    -- UUID or generated session ID
  start_time TEXT NOT NULL,               -- ISO timestamp of session start
  end_time TEXT,                          -- ISO timestamp of session end
  page_count INTEGER DEFAULT 0,           -- Number of pages in session
  dominant_concepts TEXT,                 -- JSON array of main concepts
  label TEXT                              -- Human-readable session description
);

-- ============================================================================
-- IMAGES TABLE
-- ============================================================================
-- Stores image metadata for multi-modal search (Requirements 12.1-12.7)
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL,             -- Links to memories table
  url TEXT NOT NULL,                      -- Image URL
  width INTEGER,                          -- Image width in pixels
  height INTEGER,                         -- Image height in pixels
  alt TEXT,                               -- Alt text for accessibility
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- ============================================================================
-- VIDEOS TABLE
-- ============================================================================
-- Stores video metadata for multi-modal search (Requirements 13.1-13.6)
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id INTEGER NOT NULL,             -- Links to memories table
  url TEXT NOT NULL,                      -- Video URL
  duration INTEGER,                       -- Video duration in seconds
  thumbnail_url TEXT,                     -- Video thumbnail URL
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- ============================================================================
-- CONFIG TABLE
-- ============================================================================
-- System configuration (Requirement 30.1-30.7)
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,                   -- Configuration key
  value TEXT NOT NULL,                    -- Configuration value (stored as string)
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- DEFAULT CONFIGURATION VALUES
-- ============================================================================
-- Insert default configuration (Requirement 30.1-30.7)
INSERT OR IGNORE INTO config (key, value) VALUES
  ('decay_rate', '0.02'),                      -- Base decay coefficient (Requirement 7.2)
  ('engagement_weight_dwell', '0.4'),          -- Dwell time weight (Requirement 4.6)
  ('engagement_weight_scroll', '0.3'),         -- Scroll depth weight
  ('engagement_weight_revisit', '0.3'),        -- Revisit count weight
  ('session_timeout', '1800'),                 -- Session timeout in seconds (Requirement 9.1)
  ('min_cluster_size', '3');                   -- Minimum cluster size (Requirement 21.2)

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Foreign keys must be enabled: PRAGMA foreign_keys = ON;
-- 2. Engagement scores are calculated using the formula:
--    engagement_score = (normalize(dwell_time) * 0.4) + 
--                      (scroll_depth / 100 * 0.3) + 
--                      (log(1 + revisit_count) * 0.3)
-- 3. Memory strength includes engagement, associations, and manual signals
-- 4. Decay is applied at query time using: strength × e^(-rate × days_since_access)
-- 5. Images and videos are filtered by minimum dimensions (200×200) before storage
-- ============================================================================
