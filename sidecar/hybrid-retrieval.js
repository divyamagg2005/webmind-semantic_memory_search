/**
 * Hybrid Retrieval System
 * 
 * Implements multi-stage retrieval combining:
 * 1. Semantic search via vector similarity (LanceDB)
 * 2. Associative retrieval via knowledge graph traversal
 * 3. Memory strength ranking with decay, bookmarks, and concept matches
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 7.4, 15.1, 16.1-16.6, 18.5, 27.2
 */

const { applyDecayAtQueryTime } = require('./memory-decay');
const { logError } = require('./error-handling');

/**
 * Default retrieval weights
 */
const DEFAULT_WEIGHTS = {
  semantic: 0.5,      // Weight for semantic similarity score
  associative: 0.3,   // Weight for associative connections
  strength: 0.2       // Weight for memory strength
};

/**
 * Perform semantic search using vector similarity
 * 
 * Requirement 15.1: Retrieve relevant memories using semantic search
 * Requirement 27.2: Use approximate nearest neighbor search
 * 
 * @param {Object} lanceTable - LanceDB table instance
 * @param {Array<number>} queryEmbedding - Query embedding vector
 * @param {Object} options - Search options
 * @param {number} options.limit - Maximum results to return (default: 20)
 * @returns {Promise<Array<Object>>} Search results with similarity scores
 */
async function semanticSearch(lanceTable, queryEmbedding, options = {}) {
  const { limit = 20 } = options;

  if (!lanceTable) {
    throw new Error('LanceDB table not initialized');
  }

  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    throw new Error('Invalid query embedding');
  }

  try {
    // Perform vector search in LanceDB
    const results = await lanceTable
      .search(queryEmbedding)
      .limit(limit)
      .toArray();

    // Transform results to include semantic score
    return results.map(result => ({
      memory_id: result.memory_id,
      title: result.title,
      url: result.url,
      text: result.text,
      timestamp: result.timestamp,
      distance: result._distance,
      // Convert distance to similarity score (0-1, higher is better)
      // LanceDB returns L2 distance, convert to similarity
      semanticScore: 1 / (1 + result._distance)
    }));
  } catch (error) {
    console.error('Semantic search failed:', error);
    throw error;
  }
}

/**
 * Identify concepts from top semantic results
 * 
 * Requirement 16.1: Identify concepts in top retrieved memories
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {Array<number>} memoryIds - Memory IDs from semantic search
 * @param {number} topN - Number of top results to analyze (default: 5)
 * @returns {Array<string>} Unique concept IDs
 */
function identifyConceptsFromResults(knowledgeGraph, memoryIds, topN = 5) {
  const conceptIds = new Set();
  
  // Analyze top N results
  const topMemoryIds = memoryIds.slice(0, topN);
  
  for (const memoryId of topMemoryIds) {
    const memoryNodeId = `memory_${memoryId}`;
    
    // Get concepts linked to this memory
    const concepts = knowledgeGraph.getMemoryConcepts(memoryNodeId);
    
    for (const concept of concepts) {
      conceptIds.add(concept.id);
    }
  }
  
  return Array.from(conceptIds);
}

/**
 * Expand retrieval through knowledge graph traversal
 * 
 * Requirements:
 * - 3.1: Retrieve memories directly associated with concepts
 * - 3.2: Retrieve memories associated with related concepts
 * - 16.2: Traverse knowledge graph to find associated concepts
 * - 16.3: Retrieve memories associated with expanded concepts
 * - 16.4: Limit graph expansion to 2 relationship hops
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {Array<string>} seedConceptIds - Starting concept IDs
 * @param {Object} options - Expansion options
 * @param {number} options.maxHops - Maximum traversal hops (default: 2)
 * @param {number} options.minStrength - Minimum association strength (default: 0.3)
 * @returns {Object} Expanded concepts and associated memories
 */
function expandThroughGraph(knowledgeGraph, seedConceptIds, options = {}) {
  const {
    maxHops = 2,
    minStrength = 0.3
  } = options;

  const expandedConcepts = new Map(); // conceptId -> hop distance
  const associatedMemories = new Map(); // memoryId -> { hops, concepts }

  // Add seed concepts at hop 0
  for (const conceptId of seedConceptIds) {
    expandedConcepts.set(conceptId, 0);
  }

  // Traverse graph to find related concepts
  for (const seedConceptId of seedConceptIds) {
    const relatedConcepts = knowledgeGraph.getAssociatedConcepts(
      seedConceptId,
      maxHops,
      minStrength
    );

    for (const concept of relatedConcepts) {
      // Track the minimum hop distance to this concept
      const currentHops = expandedConcepts.get(concept.id);
      if (currentHops === undefined || concept.hops < currentHops) {
        expandedConcepts.set(concept.id, concept.hops);
      }
    }
  }

  // Retrieve memories associated with all expanded concepts
  for (const [conceptId, hops] of expandedConcepts.entries()) {
    const memories = knowledgeGraph.getConceptMemories(conceptId);

    for (const memory of memories) {
      const memoryId = parseInt(memory.memoryId);
      
      if (!associatedMemories.has(memoryId)) {
        associatedMemories.set(memoryId, {
          hops,
          concepts: [conceptId],
          relevance: memory.relevance || 1.0
        });
      } else {
        // Memory found through multiple concepts - track all
        const existing = associatedMemories.get(memoryId);
        existing.concepts.push(conceptId);
        // Use minimum hop distance
        existing.hops = Math.min(existing.hops, hops);
      }
    }
  }

  return {
    expandedConcepts: Array.from(expandedConcepts.entries()).map(([id, hops]) => ({
      conceptId: id,
      hops
    })),
    associatedMemories: Array.from(associatedMemories.entries()).map(([id, data]) => ({
      memoryId: id,
      hops: data.hops,
      concepts: data.concepts,
      relevance: data.relevance
    }))
  };
}

/**
 * Calculate associative score for a memory
 * 
 * Requirements:
 * - 3.3: Boost memories with multiple concept matches
 * - 16.5: Weight expanded memories lower than direct matches
 * - 16.6: Include expanded memories in synthesis context
 * 
 * @param {Object} memory - Memory with associative data
 * @param {number} memory.hops - Hop distance from query concepts
 * @param {Array<string>} memory.concepts - Matched concept IDs
 * @param {number} memory.relevance - Concept relevance score
 * @returns {number} Associative score (0-1)
 */
function calculateAssociativeScore(memory) {
  if (!memory.concepts || memory.concepts.length === 0) {
    return 0;
  }

  // Base score from concept matches (logarithmic scaling)
  const conceptMatchScore = Math.log(1 + memory.concepts.length) / Math.log(1 + 10);

  // Hop penalty (direct matches = 1.0, 1 hop = 0.7, 2 hops = 0.4)
  const hopPenalty = memory.hops === 0 ? 1.0 : 
                     memory.hops === 1 ? 0.7 : 0.4;

  // Relevance factor
  const relevanceFactor = memory.relevance || 1.0;

  return conceptMatchScore * hopPenalty * relevanceFactor;
}

/**
 * Rank memories by combined score
 * 
 * Requirements:
 * - 3.4: Rank results by combined semantic similarity and association strength
 * - 7.4: Apply decay function based on last access
 * - 18.5: Apply bookmark boost and revisit boost
 * 
 * @param {Array<Object>} memories - Memory candidates with scores
 * @param {Object} weights - Score weights
 * @returns {Array<Object>} Ranked memories
 */
function rankMemories(memories, weights = DEFAULT_WEIGHTS) {
  const rankedMemories = memories.map(memory => {
    // Normalize scores to 0-1 range
    const semanticScore = memory.semanticScore || 0;
    const associativeScore = memory.associativeScore || 0;
    
    // Memory strength already includes bookmark and revisit boosts
    // Normalize to 0-1 range (typical range is 0-3, with bookmarks up to 6)
    const decayedStrength = memory.decayedStrength || 0;
    const strengthScore = Math.min(decayedStrength / 3, 1.0);

    // Calculate combined score
    const combinedScore = 
      (semanticScore * weights.semantic) +
      (associativeScore * weights.associative) +
      (strengthScore * weights.strength);

    return {
      ...memory,
      combinedScore,
      scores: {
        semantic: semanticScore,
        associative: associativeScore,
        strength: strengthScore,
        combined: combinedScore
      }
    };
  });

  // Sort by combined score (descending)
  rankedMemories.sort((a, b) => b.combinedScore - a.combinedScore);

  return rankedMemories;
}

/**
 * Merge semantic and associative results
 * 
 * @param {Array<Object>} semanticResults - Results from semantic search
 * @param {Array<Object>} associativeResults - Results from graph expansion
 * @returns {Map<number, Object>} Merged results by memory ID
 */
function mergeResults(semanticResults, associativeResults) {
  const merged = new Map();

  // Add semantic results
  for (const result of semanticResults) {
    merged.set(result.memory_id, {
      memoryId: result.memory_id,
      title: result.title,
      url: result.url,
      text: result.text,
      timestamp: result.timestamp,
      semanticScore: result.semanticScore,
      associativeScore: 0,
      hops: null,
      concepts: []
    });
  }

  // Merge associative results
  for (const result of associativeResults) {
    if (merged.has(result.memoryId)) {
      // Update existing entry
      const existing = merged.get(result.memoryId);
      existing.associativeScore = calculateAssociativeScore(result);
      existing.hops = result.hops;
      existing.concepts = result.concepts;
    } else {
      // Add new entry (found only through associations)
      merged.set(result.memoryId, {
        memoryId: result.memoryId,
        semanticScore: 0,
        associativeScore: calculateAssociativeScore(result),
        hops: result.hops,
        concepts: result.concepts
      });
    }
  }

  return merged;
}

/**
 * Enrich memories with database metadata
 * 
 * @param {Object} db - SQLite database instance
 * @param {Array<Object>} memories - Memories to enrich
 * @returns {Promise<Array<Object>>} Enriched memories
 */
async function enrichMemoriesWithMetadata(db, memories) {
  const enriched = [];

  for (const memory of memories) {
    // Fetch full memory data from database
    const memoryData = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM memories WHERE id = ?',
        [memory.memoryId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (memoryData) {
      // Apply decay to get current strength
      const decayed = applyDecayAtQueryTime(memoryData);

      enriched.push({
        ...memory,
        title: memoryData.title,
        url: memoryData.url,
        content: memoryData.content,
        timestamp: memoryData.timestamp,
        engagementScore: memoryData.engagement_score,
        memoryStrength: memoryData.memory_strength,
        decayedStrength: decayed.decayedStrength,
        isBookmarked: memoryData.is_bookmarked === 1,
        isPinned: memoryData.is_pinned === 1,
        revisitCount: memoryData.revisit_count,
        sessionId: memoryData.session_id
      });
    }
  }

  return enriched;
}

/**
 * Perform hybrid retrieval combining semantic and associative search
 * 
 * This is the main entry point for the hybrid retrieval system.
 * 
 * @param {Object} params - Retrieval parameters
 * @param {Object} params.lanceTable - LanceDB table instance
 * @param {Object} params.knowledgeGraph - Knowledge graph instance
 * @param {Object} params.db - SQLite database instance
 * @param {Array<number>} params.queryEmbedding - Query embedding vector
 * @param {Object} params.options - Retrieval options
 * @returns {Promise<Array<Object>>} Ranked memory results
 */
async function hybridRetrieval(params) {
  const {
    lanceTable,
    knowledgeGraph,
    db,
    queryEmbedding,
    options = {}
  } = params;

  const {
    semanticLimit = 20,
    maxHops = 2,
    minAssociationStrength = 0.3,
    topNForExpansion = 5,
    weights = DEFAULT_WEIGHTS
  } = options;

  // Step 1: Semantic search
  const semanticResults = await semanticSearch(lanceTable, queryEmbedding, {
    limit: semanticLimit
  });

  if (semanticResults.length === 0) {
    return [];
  }

  // Step 2: Identify concepts from top results
  const memoryIds = semanticResults.map(r => r.memory_id);
  const seedConcepts = identifyConceptsFromResults(
    knowledgeGraph,
    memoryIds,
    topNForExpansion
  );

  // Step 3: Expand through knowledge graph (fallback to semantic-only on failure)
  let associativeResults = [];
  let graphExpansionFailed = false;
  if (seedConcepts.length > 0) {
    try {
      const expansion = expandThroughGraph(knowledgeGraph, seedConcepts, {
        maxHops,
        minStrength: minAssociationStrength
      });
      associativeResults = expansion.associatedMemories;
    } catch (graphErr) {
      graphExpansionFailed = true;
      logError('graph_traversal_failure', graphErr, { seedConceptCount: seedConcepts.length });
    }
  }

  // Step 4: Merge results
  const mergedResults = mergeResults(semanticResults, associativeResults);
  const memories = Array.from(mergedResults.values());

  // Step 5: Enrich with database metadata and apply decay
  const enrichedMemories = await enrichMemoriesWithMetadata(db, memories);

  // Step 6: Rank by combined score
  const rankedMemories = rankMemories(enrichedMemories, weights);

  if (graphExpansionFailed) {
    rankedMemories._metadata = { graphExpansionFailed: true };
  }

  return rankedMemories;
}

module.exports = {
  semanticSearch,
  identifyConceptsFromResults,
  expandThroughGraph,
  calculateAssociativeScore,
  rankMemories,
  mergeResults,
  enrichMemoriesWithMetadata,
  hybridRetrieval,
  DEFAULT_WEIGHTS
};
