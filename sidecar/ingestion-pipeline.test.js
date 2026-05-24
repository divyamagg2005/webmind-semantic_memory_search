/**
 * Integration Tests for Enhanced Ingestion Pipeline
 * 
 * Tests end-to-end page data ingestion including:
 * - Concept extraction and storage
 * - Association creation
 * - Session assignment
 * - Media processing
 * 
 * Requirements: 1.1, 2.1, 9.2, 12.1, 13.1
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3').verbose();
const { KnowledgeGraph } = require('./knowledge-graph');
const { extractConcepts, calculateCoOccurrence } = require('./concept-extraction');
const { calculateEngagementScore, calculateMemoryStrength } = require('./engagement-score');
const { shouldCreateNewSession } = require('./session-detection');

describe('Ingestion Pipeline Integration Tests', () => {
  let db;
  let knowledgeGraph;

  before(async () => {
    // Create in-memory database for testing
    db = new sqlite3.Database(':memory:');
    
    // Initialize schema manually for testing
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        // Create memories table
        db.run(`
          CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            content TEXT,
            timestamp TEXT NOT NULL,
            dwell_time INTEGER DEFAULT 0,
            scroll_depth INTEGER DEFAULT 0,
            revisit_count INTEGER DEFAULT 0,
            last_accessed TEXT,
            session_id TEXT,
            tab_group_id TEXT,
            sequential_position INTEGER,
            previous_url TEXT,
            is_bookmarked INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            engagement_score REAL DEFAULT 0,
            memory_strength REAL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);

        // Create sessions table
        db.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            start_time TEXT NOT NULL,
            end_time TEXT,
            page_count INTEGER DEFAULT 0,
            dominant_concepts TEXT DEFAULT '[]',
            label TEXT
          )
        `);

        // Create images table
        db.run(`
          CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            alt_text TEXT,
            FOREIGN KEY (memory_id) REFERENCES memories(id)
          )
        `);

        // Create videos table
        db.run(`
          CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            duration INTEGER,
            thumbnail_url TEXT,
            FOREIGN KEY (memory_id) REFERENCES memories(id)
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    // Initialize knowledge graph
    knowledgeGraph = new KnowledgeGraph('./test-knowledge-graph.json');
    await knowledgeGraph.initialize().catch(() => {
      // Ignore error if file doesn't exist
      knowledgeGraph.clear();
    });
  });

  after(async () => {
    // Cleanup
    if (db) {
      await new Promise((resolve) => {
        db.close(resolve);
      });
    }
    if (knowledgeGraph) {
      await knowledgeGraph.shutdown();
    }
  });

  it('should ingest page data with engagement metrics', async () => {
    const pageData = {
      title: 'Introduction to React Hooks',
      url: 'https://example.com/react-hooks',
      content: 'React Hooks are a new addition to React 16.8. They let you use state and other React features without writing a class.',
      timestamp: new Date().toISOString(),
      engagement: {
        dwellTime: 120000, // 2 minutes
        scrollDepth: 85,
        revisitCount: 2,
        isBookmarked: true
      },
      context: {
        sessionId: 'session_test_1',
        tabGroupId: null,
        sequenceNumber: 1,
        previousUrl: null
      },
      media: {
        images: [],
        videos: []
      }
    };

    // Calculate engagement score
    const engagementScore = calculateEngagementScore({
      dwellTime: pageData.engagement.dwellTime,
      scrollDepth: pageData.engagement.scrollDepth,
      revisitCount: pageData.engagement.revisitCount
    });

    assert.ok(engagementScore > 0 && engagementScore <= 1, 'Engagement score should be between 0 and 1');

    // Calculate memory strength
    const memoryStrength = calculateMemoryStrength({
      engagementScore,
      isBookmarked: pageData.engagement.isBookmarked,
      uniqueVisitDates: pageData.engagement.revisitCount
    });

    assert.ok(memoryStrength > 0, 'Memory strength should be positive');

    // Insert into database
    const memoryId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO memories (
          title, url, content, timestamp,
          dwell_time, scroll_depth, revisit_count, last_accessed,
          session_id, tab_group_id, sequential_position, previous_url,
          is_bookmarked, is_pinned,
          engagement_score, memory_strength,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pageData.title,
          pageData.url,
          pageData.content,
          pageData.timestamp,
          pageData.engagement.dwellTime,
          pageData.engagement.scrollDepth,
          pageData.engagement.revisitCount,
          pageData.timestamp,
          pageData.context.sessionId,
          pageData.context.tabGroupId,
          pageData.context.sequenceNumber,
          pageData.context.previousUrl,
          pageData.engagement.isBookmarked ? 1 : 0,
          0,
          engagementScore,
          memoryStrength,
          pageData.timestamp,
          pageData.timestamp
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    assert.ok(memoryId > 0, 'Memory should be inserted with valid ID');

    // Verify memory was stored
    const memory = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM memories WHERE id = ?', [memoryId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    assert.strictEqual(memory.title, pageData.title);
    assert.strictEqual(memory.url, pageData.url);
    assert.strictEqual(memory.dwell_time, pageData.engagement.dwellTime);
    assert.strictEqual(memory.scroll_depth, pageData.engagement.scrollDepth);
    assert.strictEqual(memory.is_bookmarked, 1);
  });

  it('should extract concepts and store in knowledge graph', async () => {
    const content = 'React Hooks are a powerful feature in React. They allow functional components to use state and lifecycle methods. Popular hooks include useState, useEffect, and useContext.';

    // Extract concepts
    const concepts = extractConcepts(content, {
      maxTopics: 10,
      minConfidence: 0.6
    });

    assert.ok(concepts.length > 0, 'Should extract at least one concept');

    // Add concepts to knowledge graph
    const conceptIds = [];
    for (const concept of concepts) {
      const conceptId = knowledgeGraph.addConcept({
        id: concept.id,
        name: concept.name,
        type: concept.type,
        confidence: concept.confidence
      });
      conceptIds.push(conceptId);
    }

    // Verify concepts were added
    for (const conceptId of conceptIds) {
      const concept = knowledgeGraph.getConcept(conceptId);
      assert.ok(concept !== null, 'Concept should exist in graph');
      assert.ok(concept.confidence >= 0.6, 'Concept confidence should meet threshold');
    }
  });

  it('should create concept associations based on co-occurrence', async () => {
    const content = 'JavaScript and TypeScript are popular programming languages. React and Vue are JavaScript frameworks.';

    // Extract concepts
    const concepts = extractConcepts(content, {
      maxTopics: 10,
      minConfidence: 0.6
    });

    // Add concepts to graph
    const conceptIds = [];
    for (const concept of concepts) {
      const conceptId = knowledgeGraph.addConcept({
        id: concept.id,
        name: concept.name,
        type: concept.type,
        confidence: concept.confidence
      });
      conceptIds.push(conceptId);
    }

    // Create associations
    let associationsCreated = 0;
    for (let i = 0; i < conceptIds.length; i++) {
      for (let j = i + 1; j < conceptIds.length; j++) {
        const success = knowledgeGraph.addConceptAssociation(
          conceptIds[i],
          conceptIds[j]
        );
        if (success) {
          associationsCreated++;
        }
      }
    }

    assert.ok(associationsCreated > 0, 'Should create at least one association');

    // Verify associations exist
    if (conceptIds.length >= 2) {
      const association = knowledgeGraph.getConceptAssociation(
        conceptIds[0],
        conceptIds[1]
      );
      assert.ok(association !== null, 'Association should exist');
      assert.ok(association.strength > 0, 'Association should have positive strength');
      assert.ok(association.coOccurrences >= 1, 'Co-occurrence should be at least 1');
    }
  });

  it('should assign memory to session', async () => {
    const sessionId = 'session_test_2';
    const timestamp = new Date().toISOString();

    // Create session
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO sessions (id, start_time, end_time, page_count, dominant_concepts, label)
         VALUES (?, ?, NULL, 0, '[]', NULL)`,
        [sessionId, timestamp],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Insert memory
    const memoryId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO memories (
          title, url, content, timestamp,
          dwell_time, scroll_depth, revisit_count, last_accessed,
          session_id, tab_group_id, sequential_position, previous_url,
          is_bookmarked, is_pinned,
          engagement_score, memory_strength,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'Test Page',
          'https://example.com/test',
          'Test content',
          timestamp,
          60000,
          50,
          0,
          timestamp,
          sessionId,
          null,
          1,
          null,
          0,
          0,
          0.5,
          0.5,
          timestamp,
          timestamp
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // Update session page count
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE sessions SET page_count = page_count + 1, end_time = ? WHERE id = ?`,
        [timestamp, sessionId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Verify session was updated
    const session = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM sessions WHERE id = ?', [sessionId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    assert.strictEqual(session.page_count, 1, 'Session page count should be 1');

    // Verify memory is linked to session
    const memory = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM memories WHERE id = ?', [memoryId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    assert.strictEqual(memory.session_id, sessionId, 'Memory should be linked to session');
    assert.strictEqual(memory.sequential_position, 1, 'Memory should have sequential position 1');
  });

  it('should detect new session after timeout', () => {
    const now = new Date();
    const thirtyOneMinutesAgo = new Date(now.getTime() - 31 * 60 * 1000);

    const needsNewSession = shouldCreateNewSession({
      lastPageTimestamp: thirtyOneMinutesAgo.toISOString(),
      currentPageTimestamp: now.toISOString(),
      lastPageEmbedding: Array(768).fill(0.5),
      currentPageEmbedding: Array(768).fill(0.5)
    });

    assert.strictEqual(needsNewSession, true, 'Should create new session after 30-minute timeout');
  });

  it('should continue session within timeout with similar content', () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

    // Create similar embeddings (high cosine similarity)
    const embedding = Array(768).fill(0.5);

    const needsNewSession = shouldCreateNewSession({
      lastPageTimestamp: tenMinutesAgo.toISOString(),
      currentPageTimestamp: now.toISOString(),
      lastPageEmbedding: embedding,
      currentPageEmbedding: embedding
    });

    assert.strictEqual(needsNewSession, false, 'Should continue session with similar content within timeout');
  });

  it('should process media content metadata', async () => {
    const memoryId = 1;
    const imageData = {
      url: 'https://example.com/image.jpg',
      width: 800,
      height: 600,
      alt: 'Test image'
    };

    // Insert image
    const imageId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO images (memory_id, url, width, height, alt_text)
         VALUES (?, ?, ?, ?, ?)`,
        [memoryId, imageData.url, imageData.width, imageData.height, imageData.alt],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    assert.ok(imageId > 0, 'Image should be inserted with valid ID');

    // Verify image was stored
    const image = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM images WHERE id = ?', [imageId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    assert.strictEqual(image.url, imageData.url);
    assert.strictEqual(image.width, imageData.width);
    assert.strictEqual(image.height, imageData.height);
    assert.strictEqual(image.alt_text, imageData.alt);
  });

  it('should link memory to concepts in knowledge graph', async () => {
    const memoryId = 100;
    const memoryNodeId = `memory_${memoryId}`;
    const timestamp = new Date().toISOString();

    // Add memory node
    knowledgeGraph.addMemory({
      id: memoryNodeId,
      memoryId: memoryId.toString(),
      timestamp
    });

    // Add concept
    const conceptId = knowledgeGraph.addConcept({
      id: 'concept_test',
      name: 'test',
      type: 'topic',
      confidence: 0.8
    });

    // Link memory to concept
    const success = knowledgeGraph.linkMemoryToConcept(memoryNodeId, conceptId, 1.0);
    assert.strictEqual(success, true, 'Should successfully link memory to concept');

    // Verify link exists
    const concepts = knowledgeGraph.getMemoryConcepts(memoryNodeId);
    assert.ok(concepts.length > 0, 'Memory should have linked concepts');
    assert.strictEqual(concepts[0].id, conceptId, 'Linked concept should match');
  });
});
