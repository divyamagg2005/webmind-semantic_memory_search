/**
 * Session Detection and Contextual Memory
 * 
 * Implements browsing session detection based on temporal boundaries and content similarity.
 * Manages session metadata and sequential context for memory retrieval.
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5
 */

/**
 * Session timeout in milliseconds (30 minutes)
 */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Embedding similarity threshold for session continuity
 */
const SIMILARITY_THRESHOLD = 0.7;

/**
 * Calculate cosine similarity between two embedding vectors
 * 
 * @param {Array<number>} vec1 - First embedding vector
 * @param {Array<number>} vec2 - Second embedding vector
 * @returns {number} Cosine similarity score (0-1)
 */
function calculateCosineSimilarity(vec1, vec2) {
  if (!Array.isArray(vec1) || !Array.isArray(vec2)) {
    return 0;
  }
  
  if (vec1.length !== vec2.length || vec1.length === 0) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Detect if a new session should be created
 * 
 * Requirements:
 * - 9.1: Create new session after 30-minute timeout
 * - 9.3: Maintain session on similarity > 0.7
 * 
 * @param {Object} params - Detection parameters
 * @param {Date|string} params.lastPageTimestamp - Timestamp of last page in current session
 * @param {Date|string} params.currentPageTimestamp - Timestamp of current page
 * @param {Array<number>} params.lastPageEmbedding - Embedding of last page
 * @param {Array<number>} params.currentPageEmbedding - Embedding of current page
 * @returns {boolean} True if new session should be created
 */
function shouldCreateNewSession(params) {
  const {
    lastPageTimestamp,
    currentPageTimestamp,
    lastPageEmbedding,
    currentPageEmbedding
  } = params;
  
  // No previous page - start new session
  if (!lastPageTimestamp) {
    return true;
  }
  
  // Parse timestamps
  const lastTime = new Date(lastPageTimestamp);
  const currentTime = new Date(currentPageTimestamp);
  
  if (isNaN(lastTime.getTime()) || isNaN(currentTime.getTime())) {
    return true;
  }
  
  // Check temporal boundary (30 minutes)
  const timeDiff = currentTime.getTime() - lastTime.getTime();
  if (timeDiff > SESSION_TIMEOUT_MS) {
    return true;
  }
  
  // Check content similarity
  if (lastPageEmbedding && currentPageEmbedding) {
    const similarity = calculateCosineSimilarity(lastPageEmbedding, currentPageEmbedding);
    
    // If similarity is below threshold, start new session
    if (similarity < SIMILARITY_THRESHOLD) {
      return true;
    }
  }
  
  // Continue current session
  return false;
}

/**
 * Create a new session record
 * 
 * Requirement 9.5: Store session metadata including start time, end time, and page count
 * 
 * @param {Object} db - SQLite database instance
 * @param {Date|string} startTime - Session start timestamp
 * @returns {number} Session ID
 */
function createSession(db, startTime) {
  const stmt = db.prepare(`
    INSERT INTO sessions (start_time, end_time, page_count, dominant_concepts, label)
    VALUES (?, NULL, 0, '[]', NULL)
  `);
  
  const result = stmt.run(new Date(startTime).toISOString());
  return result.lastInsertRowid;
}

/**
 * Update session metadata
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} sessionId - Session ID
 * @param {Object} updates - Fields to update
 * @param {Date|string} updates.endTime - Session end time
 * @param {number} updates.pageCount - Number of pages in session
 * @param {Array<string>} updates.dominantConcepts - Top concepts from session
 * @param {string} updates.label - Session label
 */
function updateSession(db, sessionId, updates) {
  const fields = [];
  const values = [];
  
  if (updates.endTime !== undefined) {
    fields.push('end_time = ?');
    values.push(new Date(updates.endTime).toISOString());
  }
  
  if (updates.pageCount !== undefined) {
    fields.push('page_count = ?');
    values.push(updates.pageCount);
  }
  
  if (updates.dominantConcepts !== undefined) {
    fields.push('dominant_concepts = ?');
    values.push(JSON.stringify(updates.dominantConcepts));
  }
  
  if (updates.label !== undefined) {
    fields.push('label = ?');
    values.push(updates.label);
  }
  
  if (fields.length === 0) {
    return;
  }
  
  values.push(sessionId);
  
  const stmt = db.prepare(`
    UPDATE sessions
    SET ${fields.join(', ')}
    WHERE id = ?
  `);
  
  stmt.run(...values);
}

/**
 * Get the current active session
 * 
 * @param {Object} db - SQLite database instance
 * @returns {Object|null} Current session or null
 */
function getCurrentSession(db) {
  const stmt = db.prepare(`
    SELECT * FROM sessions
    WHERE end_time IS NULL
    ORDER BY start_time DESC
    LIMIT 1
  `);
  
  return stmt.get();
}

/**
 * Assign memory to session and set sequential position
 * 
 * Requirement 10.2: Assign sequential position numbers to memories within sessions
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} memoryId - Memory ID
 * @param {number} sessionId - Session ID
 * @returns {number} Sequential position in session
 */
function assignMemoryToSession(db, memoryId, sessionId) {
  // Get current page count
  const session = db.prepare('SELECT page_count FROM sessions WHERE id = ?').get(sessionId);
  const sequentialPosition = (session?.page_count || 0) + 1;
  
  // Update memory with session and position
  db.prepare(`
    UPDATE memories
    SET session_id = ?, sequential_position = ?
    WHERE id = ?
  `).run(sessionId, sequentialPosition, memoryId);
  
  // Increment session page count
  db.prepare(`
    UPDATE sessions
    SET page_count = page_count + 1,
        end_time = ?
    WHERE id = ?
  `).run(new Date().toISOString(), sessionId);
  
  return sequentialPosition;
}

/**
 * Get memories in sequential order within a session
 * 
 * Requirement 10.3: Retrieve pages by session and sequence
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} sessionId - Session ID
 * @returns {Array<Object>} Memories in sequential order
 */
function getSessionMemories(db, sessionId) {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE session_id = ?
    ORDER BY sequential_position ASC
  `);
  
  return stmt.all(sessionId);
}

/**
 * Get sequential neighbors of a memory
 * 
 * Requirement 10.4: Support queries for pages visited before or after a specified memory
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} memoryId - Memory ID
 * @param {Object} options - Query options
 * @param {number} options.before - Number of memories before
 * @param {number} options.after - Number of memories after
 * @returns {Object} Object with before and after arrays
 */
function getSequentialNeighbors(db, memoryId, options = {}) {
  const { before = 1, after = 1 } = options;
  
  // Get the memory's session and position
  const memory = db.prepare(`
    SELECT session_id, sequential_position
    FROM memories
    WHERE id = ?
  `).get(memoryId);
  
  if (!memory || !memory.session_id) {
    return { before: [], after: [] };
  }
  
  // Get memories before
  const beforeStmt = db.prepare(`
    SELECT * FROM memories
    WHERE session_id = ? AND sequential_position < ?
    ORDER BY sequential_position DESC
    LIMIT ?
  `);
  const beforeMemories = beforeStmt.all(
    memory.session_id,
    memory.sequential_position,
    before
  ).reverse();
  
  // Get memories after
  const afterStmt = db.prepare(`
    SELECT * FROM memories
    WHERE session_id = ? AND sequential_position > ?
    ORDER BY sequential_position ASC
    LIMIT ?
  `);
  const afterMemories = afterStmt.all(
    memory.session_id,
    memory.sequential_position,
    after
  );
  
  return {
    before: beforeMemories,
    after: afterMemories
  };
}

/**
 * Extract dominant concepts from session memories
 * 
 * Requirement 9.6: Assign session labels based on dominant concepts
 * 
 * @param {Object} db - SQLite database instance
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {number} sessionId - Session ID
 * @returns {Array<string>} Top concepts from session
 */
function extractSessionConcepts(db, knowledgeGraph, sessionId) {
  const memories = getSessionMemories(db, sessionId);
  
  if (memories.length === 0) {
    return [];
  }
  
  // Count concept occurrences across session memories
  const conceptCounts = new Map();
  
  for (const memory of memories) {
    // Get concepts linked to this memory
    const memoryNode = knowledgeGraph.getMemoryNode(memory.id);
    if (!memoryNode) continue;
    
    // Get all concept links
    const links = knowledgeGraph.getMemoryConceptLinks(memory.id);
    
    for (const link of links) {
      const concept = knowledgeGraph.getConceptNode(link.conceptId);
      if (concept) {
        const count = conceptCounts.get(concept.name) || 0;
        conceptCounts.set(concept.name, count + 1);
      }
    }
  }
  
  // Sort by frequency and return top 10
  const sortedConcepts = Array.from(conceptCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);
  
  return sortedConcepts;
}

/**
 * Generate session label using LLM
 * 
 * Requirement 9.6: Generate session labels using LLM
 * 
 * @param {Array<string>} concepts - Dominant concepts from session
 * @param {Object} ollama - Ollama client instance
 * @returns {Promise<string>} Generated session label (max 5 words)
 */
async function generateSessionLabel(concepts, ollama) {
  if (!concepts || concepts.length === 0) {
    return 'Browsing Session';
  }
  
  try {
    const prompt = `Given these concepts from a browsing session: ${concepts.join(', ')}

Generate a concise label (maximum 5 words) that describes the main theme or topic of this browsing session.

Label:`;
    
    const response = await ollama.generate({
      model: 'llama3.2',
      prompt,
      stream: false
    });
    
    // Extract and clean the label
    let label = response.response.trim();
    
    // Remove quotes if present
    label = label.replace(/^["']|["']$/g, '');
    
    // Limit to 5 words
    const words = label.split(/\s+/);
    if (words.length > 5) {
      label = words.slice(0, 5).join(' ');
    }
    
    return label || 'Browsing Session';
  } catch (error) {
    console.error('Failed to generate session label:', error);
    return concepts.slice(0, 3).join(', ');
  }
}

/**
 * Filter memories by session
 * 
 * Requirement 10.5: Support filtering search results by session
 * 
 * @param {Array<Object>} memories - Memory results
 * @param {number} sessionId - Session ID to filter by
 * @returns {Array<Object>} Filtered memories
 */
function filterBySession(memories, sessionId) {
  if (!sessionId) {
    return memories;
  }
  
  return memories.filter(memory => memory.session_id === sessionId);
}

module.exports = {
  SESSION_TIMEOUT_MS,
  SIMILARITY_THRESHOLD,
  calculateCosineSimilarity,
  shouldCreateNewSession,
  createSession,
  updateSession,
  getCurrentSession,
  assignMemoryToSession,
  getSessionMemories,
  getSequentialNeighbors,
  extractSessionConcepts,
  generateSessionLabel,
  filterBySession
};
