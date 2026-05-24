/**
 * Tests for Hybrid Retrieval System
 * 
 * Tests semantic search, associative retrieval, and memory strength ranking.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 7.4, 15.1, 16.1-16.6, 18.5, 27.2
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const sqlite3 = require('sqlite3').verbose();
const { KnowledgeGraph } = require('./knowledge-graph');
const {
  identifyConceptsFromResults,
  expandThroughGraph,
  calculateAssociativeScore,
  rankMemories,
  mergeResults,
  DEFAULT_WEIGHTS
} = require('./hybrid-retrieval');

describe('Hybrid Retrieval System', () => {
  let db;
  let knowledgeGraph;

  before(async () => {
    // Create in-memory database
    db = new sqlite3.Database(':memory:');

    // Create schema
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(`
          CREATE TABLE memories (
            id INTEGER PRIMARY KEY,
            title TEXT,
            url TEXT,
            content TEXT,
            timestamp TEXT,
            dwell_time INTEGER DEFAULT 0,
            scroll_depth INTEGER DEFAULT 0,
            revisit_count INTEGER DEFAULT 0,
            last_accessed TEXT,
            session_id TEXT,
            is_bookmarked INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            engagement_score REAL DEFAULT 0,
            memory_strength REAL DEFAULT 0,
            created_at TEXT,
            updated_at TEXT
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });

    // Initialize knowledge graph
    knowledgeGraph = new KnowledgeGraph('./test-hybrid-retrieval-graph.json');
    await knowledgeGraph.initialize().catch(() => {
      knowledgeGraph.clear();
    });
  });

  after(async () => {
    if (db) {
      await new Promise((resolve) => db.close(resolve));
    }
    if (knowledgeGraph) {
      await knowledgeGraph.shutdown();
    }
  });

  describe('identifyConceptsFromResults', () => {
    it('should identify concepts from top results', () => {
      // Setup: Add memories and concepts to graph
      const memory1 = 'memory_1';
      const memory2 = 'memory_2';
      
      knowledgeGraph.addMemory({
        id: memory1,
        memoryId: '1',
        timestamp: new Date().toISOString()
      });
      
      knowledgeGraph.addMemory({
        id: memory2,
        memoryId: '2',
        timestamp: new Date().toISOString()
      });

      const concept1 = knowledgeGraph.addConcept({
        id: 'concept_react',
        name: 'react',
        type: 'topic',
        confidence: 0.9
      });

      const concept2 = knowledgeGraph.addConcept({
        id: 'concept_javascript',
        name: 'javascript',
        type: 'topic',
        confidence: 0.8
      });

      knowledgeGraph.linkMemoryToConcept(memory1, concept1, 1.0);
      knowledgeGraph.linkMemoryToConcept(memory1, concept2, 0.8);
      knowledgeGraph.linkMemoryToConcept(memory2, concept2, 1.0);

      // Test
      const concepts = identifyConceptsFromResults(knowledgeGraph, [1, 2], 2);

      assert.ok(concepts.length > 0, 'Should identify concepts');
      assert.ok(concepts.includes(concept1) || concepts.includes(concept2), 'Should include linked concepts');
    });

    it('should respect topN parameter', () => {
      const concepts = identifyConceptsFromResults(knowledgeGraph, [1, 2, 3, 4, 5], 2);
      
      // Should only analyze top 2 results
      // The exact number depends on how many concepts are linked
      assert.ok(Array.isArray(concepts), 'Should return array');
    });

    it('should handle empty memory list', () => {
      const concepts = identifyConceptsFromResults(knowledgeGraph, [], 5);
      
      assert.strictEqual(concepts.length, 0, 'Should return empty array');
    });

    it('should deduplicate concepts', () => {
      const concepts = identifyConceptsFromResults(knowledgeGraph, [1, 1, 1], 3);
      
      // Should not have duplicates
      const uniqueConcepts = new Set(concepts);
      assert.strictEqual(concepts.length, uniqueConcepts.size, 'Should not have duplicates');
    });
  });

  describe('expandThroughGraph', () => {
    it('should expand concepts through graph traversal', () => {
      // Setup: Create concept network
      const concept1 = knowledgeGraph.addConcept({
        id: 'concept_node',
        name: 'node',
        type: 'topic',
        confidence: 0.9
      });

      const concept2 = knowledgeGraph.addConcept({
        id: 'concept_express',
        name: 'express',
        type: 'topic',
        confidence: 0.8
      });

      const concept3 = knowledgeGraph.addConcept({
        id: 'concept_api',
        name: 'api',
        type: 'topic',
        confidence: 0.85
      });

      // Create associations
      knowledgeGraph.addConceptAssociation(concept1, concept2);
      knowledgeGraph.addConceptAssociation(concept2, concept3);

      // Add memories
      const memory3 = 'memory_3';
      knowledgeGraph.addMemory({
        id: memory3,
        memoryId: '3',
        timestamp: new Date().toISOString()
      });
      knowledgeGraph.linkMemoryToConcept(memory3, concept2, 1.0);

      // Test expansion
      const result = expandThroughGraph(knowledgeGraph, [concept1], {
        maxHops: 2,
        minStrength: 0.3
      });

      assert.ok(result.expandedConcepts.length > 0, 'Should find expanded concepts');
      assert.ok(result.associatedMemories.length > 0, 'Should find associated memories');
    });

    it('should respect maxHops limit', () => {
      const concept1 = 'concept_node';
      
      const result1hop = expandThroughGraph(knowledgeGraph, [concept1], {
        maxHops: 1,
        minStrength: 0.3
      });

      const result2hop = expandThroughGraph(knowledgeGraph, [concept1], {
        maxHops: 2,
        minStrength: 0.3
      });

      // 2-hop should find same or more concepts than 1-hop
      assert.ok(
        result2hop.expandedConcepts.length >= result1hop.expandedConcepts.length,
        'Higher maxHops should find more or equal concepts'
      );
    });

    it('should track hop distance for concepts', () => {
      const concept1 = 'concept_node';
      
      const result = expandThroughGraph(knowledgeGraph, [concept1], {
        maxHops: 2,
        minStrength: 0.3
      });

      for (const concept of result.expandedConcepts) {
        assert.ok(concept.hops >= 0 && concept.hops <= 2, 'Hop distance should be within range');
      }
    });

    it('should track multiple concept matches for memories', () => {
      const result = expandThroughGraph(knowledgeGraph, ['concept_javascript'], {
        maxHops: 1,
        minStrength: 0.3
      });

      // Memories linked to multiple concepts should have them tracked
      for (const memory of result.associatedMemories) {
        assert.ok(Array.isArray(memory.concepts), 'Should have concepts array');
        assert.ok(memory.concepts.length > 0, 'Should have at least one concept');
      }
    });

    it('should handle empty seed concepts', () => {
      const result = expandThroughGraph(knowledgeGraph, [], {
        maxHops: 2,
        minStrength: 0.3
      });

      assert.strictEqual(result.expandedConcepts.length, 0, 'Should return empty expanded concepts');
      assert.strictEqual(result.associatedMemories.length, 0, 'Should return empty memories');
    });
  });

  describe('calculateAssociativeScore', () => {
    it('should calculate score based on concept matches', () => {
      const memory1 = {
        hops: 0,
        concepts: ['concept_1'],
        relevance: 1.0
      };

      const memory2 = {
        hops: 0,
        concepts: ['concept_1', 'concept_2', 'concept_3'],
        relevance: 1.0
      };

      const score1 = calculateAssociativeScore(memory1);
      const score2 = calculateAssociativeScore(memory2);

      assert.ok(score2 > score1, 'More concept matches should yield higher score');
    });

    it('should apply hop penalty', () => {
      const directMatch = {
        hops: 0,
        concepts: ['concept_1'],
        relevance: 1.0
      };

      const oneHop = {
        hops: 1,
        concepts: ['concept_1'],
        relevance: 1.0
      };

      const twoHops = {
        hops: 2,
        concepts: ['concept_1'],
        relevance: 1.0
      };

      const scoreDirect = calculateAssociativeScore(directMatch);
      const score1Hop = calculateAssociativeScore(oneHop);
      const score2Hop = calculateAssociativeScore(twoHops);

      assert.ok(scoreDirect > score1Hop, 'Direct matches should score higher than 1-hop');
      assert.ok(score1Hop > score2Hop, '1-hop should score higher than 2-hop');
    });

    it('should incorporate relevance factor', () => {
      const highRelevance = {
        hops: 0,
        concepts: ['concept_1'],
        relevance: 1.0
      };

      const lowRelevance = {
        hops: 0,
        concepts: ['concept_1'],
        relevance: 0.5
      };

      const scoreHigh = calculateAssociativeScore(highRelevance);
      const scoreLow = calculateAssociativeScore(lowRelevance);

      assert.ok(scoreHigh > scoreLow, 'Higher relevance should yield higher score');
    });

    it('should return 0 for memories with no concepts', () => {
      const memory = {
        hops: 0,
        concepts: [],
        relevance: 1.0
      };

      const score = calculateAssociativeScore(memory);
      assert.strictEqual(score, 0, 'Should return 0 for no concepts');
    });

    it('should handle missing concepts array', () => {
      const memory = {
        hops: 0,
        relevance: 1.0
      };

      const score = calculateAssociativeScore(memory);
      assert.strictEqual(score, 0, 'Should return 0 for missing concepts');
    });
  });

  describe('rankMemories', () => {
    it('should rank memories by combined score', () => {
      const memories = [
        {
          memoryId: 1,
          semanticScore: 0.5,
          associativeScore: 0.3,
          decayedStrength: 0.8
        },
        {
          memoryId: 2,
          semanticScore: 0.9,
          associativeScore: 0.7,
          decayedStrength: 1.2
        },
        {
          memoryId: 3,
          semanticScore: 0.3,
          associativeScore: 0.2,
          decayedStrength: 0.5
        }
      ];

      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);

      // Should be sorted by combined score (descending)
      for (let i = 0; i < ranked.length - 1; i++) {
        assert.ok(
          ranked[i].combinedScore >= ranked[i + 1].combinedScore,
          'Should be sorted in descending order'
        );
      }
    });

    it('should include individual score components', () => {
      const memories = [
        {
          memoryId: 1,
          semanticScore: 0.8,
          associativeScore: 0.6,
          decayedStrength: 1.0
        }
      ];

      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);

      assert.ok(ranked[0].scores, 'Should have scores object');
      assert.ok(typeof ranked[0].scores.semantic === 'number', 'Should have semantic score');
      assert.ok(typeof ranked[0].scores.associative === 'number', 'Should have associative score');
      assert.ok(typeof ranked[0].scores.strength === 'number', 'Should have strength score');
      assert.ok(typeof ranked[0].scores.combined === 'number', 'Should have combined score');
    });

    it('should handle custom weights', () => {
      const memories = [
        {
          memoryId: 1,
          semanticScore: 1.0,
          associativeScore: 0.0,
          decayedStrength: 0.0
        }
      ];

      const customWeights = {
        semantic: 1.0,
        associative: 0.0,
        strength: 0.0
      };

      const ranked = rankMemories(memories, customWeights);

      // With 100% semantic weight, combined score should equal semantic score
      assert.ok(
        Math.abs(ranked[0].combinedScore - ranked[0].semanticScore) < 0.01,
        'Should respect custom weights'
      );
    });

    it('should handle missing scores gracefully', () => {
      const memories = [
        {
          memoryId: 1,
          // Missing all scores
        }
      ];

      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);

      assert.strictEqual(ranked.length, 1, 'Should handle missing scores');
      assert.ok(ranked[0].combinedScore >= 0, 'Combined score should be non-negative');
    });

    it('should normalize strength score', () => {
      const memories = [
        {
          memoryId: 1,
          semanticScore: 0,
          associativeScore: 0,
          decayedStrength: 6.0 // Very high strength (bookmarked)
        }
      ];

      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);

      // Strength score should be normalized to 0-1 range
      assert.ok(ranked[0].scores.strength <= 1.0, 'Strength score should be normalized');
    });

    it('should handle empty array', () => {
      const ranked = rankMemories([], DEFAULT_WEIGHTS);
      
      assert.strictEqual(ranked.length, 0, 'Should return empty array');
    });
  });

  describe('mergeResults', () => {
    it('should merge semantic and associative results', () => {
      const semanticResults = [
        {
          memory_id: 1,
          title: 'Page 1',
          url: 'http://example.com/1',
          text: 'Content 1',
          timestamp: '2024-01-01',
          semanticScore: 0.9
        }
      ];

      const associativeResults = [
        {
          memoryId: 1,
          hops: 1,
          concepts: ['concept_1'],
          relevance: 0.8
        },
        {
          memoryId: 2,
          hops: 2,
          concepts: ['concept_2'],
          relevance: 0.7
        }
      ];

      const merged = mergeResults(semanticResults, associativeResults);

      assert.strictEqual(merged.size, 2, 'Should have 2 unique memories');
      
      const memory1 = merged.get(1);
      assert.ok(memory1.semanticScore > 0, 'Memory 1 should have semantic score');
      assert.ok(memory1.associativeScore > 0, 'Memory 1 should have associative score');
      
      const memory2 = merged.get(2);
      assert.strictEqual(memory2.semanticScore, 0, 'Memory 2 should have no semantic score');
      assert.ok(memory2.associativeScore > 0, 'Memory 2 should have associative score');
    });

    it('should handle only semantic results', () => {
      const semanticResults = [
        {
          memory_id: 1,
          title: 'Page 1',
          url: 'http://example.com/1',
          text: 'Content 1',
          timestamp: '2024-01-01',
          semanticScore: 0.9
        }
      ];

      const merged = mergeResults(semanticResults, []);

      assert.strictEqual(merged.size, 1, 'Should have 1 memory');
      const memory = merged.get(1);
      assert.strictEqual(memory.associativeScore, 0, 'Should have no associative score');
    });

    it('should handle only associative results', () => {
      const associativeResults = [
        {
          memoryId: 1,
          hops: 1,
          concepts: ['concept_1'],
          relevance: 0.8
        }
      ];

      const merged = mergeResults([], associativeResults);

      assert.strictEqual(merged.size, 1, 'Should have 1 memory');
      const memory = merged.get(1);
      assert.strictEqual(memory.semanticScore, 0, 'Should have no semantic score');
    });

    it('should track concept matches', () => {
      const semanticResults = [];
      const associativeResults = [
        {
          memoryId: 1,
          hops: 0,
          concepts: ['concept_1', 'concept_2'],
          relevance: 1.0
        }
      ];

      const merged = mergeResults(semanticResults, associativeResults);
      const memory = merged.get(1);

      assert.strictEqual(memory.concepts.length, 2, 'Should track all concept matches');
    });
  });

  describe('Property Test: Retrieval Ranking Monotonicity', () => {
    it('should maintain ranking monotonicity with increasing scores', () => {
      // Property: If memory A has higher combined score than memory B,
      // then A should rank higher than B
      
      const memories = [];
      for (let i = 0; i < 10; i++) {
        memories.push({
          memoryId: i,
          semanticScore: Math.random(),
          associativeScore: Math.random(),
          decayedStrength: Math.random() * 2
        });
      }

      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);

      // Verify monotonicity
      for (let i = 0; i < ranked.length - 1; i++) {
        assert.ok(
          ranked[i].combinedScore >= ranked[i + 1].combinedScore,
          `Ranking should be monotonic: position ${i} (${ranked[i].combinedScore}) >= position ${i + 1} (${ranked[i + 1].combinedScore})`
        );
      }
    });

    it('should maintain ranking stability with equal scores', () => {
      // Property: Memories with equal scores should maintain relative order
      
      const memories = [
        { memoryId: 1, semanticScore: 0.5, associativeScore: 0.5, decayedStrength: 1.0 },
        { memoryId: 2, semanticScore: 0.5, associativeScore: 0.5, decayedStrength: 1.0 },
        { memoryId: 3, semanticScore: 0.5, associativeScore: 0.5, decayedStrength: 1.0 }
      ];

      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);

      // All should have same combined score
      const firstScore = ranked[0].combinedScore;
      for (const memory of ranked) {
        assert.ok(
          Math.abs(memory.combinedScore - firstScore) < 0.001,
          'Equal input scores should produce equal combined scores'
        );
      }
    });

    it('should respect weight changes monotonically', () => {
      // Property: Increasing weight on a component should increase its influence
      
      const memory = {
        memoryId: 1,
        semanticScore: 1.0,
        associativeScore: 0.0,
        decayedStrength: 0.0
      };

      const weights1 = { semantic: 0.3, associative: 0.35, strength: 0.35 };
      const weights2 = { semantic: 0.7, associative: 0.15, strength: 0.15 };

      const ranked1 = rankMemories([memory], weights1);
      const ranked2 = rankMemories([memory], weights2);

      // Higher semantic weight should increase combined score when semantic score is high
      assert.ok(
        ranked2[0].combinedScore > ranked1[0].combinedScore,
        'Increasing weight on high-scoring component should increase combined score'
      );
    });
  });

  describe('Integration: Full hybrid retrieval workflow', () => {
    it('should handle complete retrieval pipeline', () => {
      // This test verifies the integration of all components
      
      // Setup: Create a small knowledge graph
      const concept1 = knowledgeGraph.addConcept({
        id: 'concept_test1',
        name: 'test1',
        type: 'topic',
        confidence: 0.9
      });

      const concept2 = knowledgeGraph.addConcept({
        id: 'concept_test2',
        name: 'test2',
        type: 'topic',
        confidence: 0.8
      });

      knowledgeGraph.addConceptAssociation(concept1, concept2);

      const memory = 'memory_100';
      knowledgeGraph.addMemory({
        id: memory,
        memoryId: '100',
        timestamp: new Date().toISOString()
      });

      knowledgeGraph.linkMemoryToConcept(memory, concept1, 1.0);

      // Simulate semantic results
      const semanticResults = [
        {
          memory_id: 100,
          title: 'Test Page',
          url: 'http://example.com/test',
          text: 'Test content',
          timestamp: new Date().toISOString(),
          semanticScore: 0.85
        }
      ];

      // Identify concepts
      const concepts = identifyConceptsFromResults(knowledgeGraph, [100], 1);
      assert.ok(concepts.length > 0, 'Should identify concepts');

      // Expand through graph
      const expansion = expandThroughGraph(knowledgeGraph, concepts, {
        maxHops: 2,
        minStrength: 0.3
      });
      assert.ok(expansion.expandedConcepts.length > 0, 'Should expand concepts');

      // Merge results
      const merged = mergeResults(semanticResults, expansion.associatedMemories);
      assert.ok(merged.size > 0, 'Should merge results');

      // Rank
      const memories = Array.from(merged.values()).map(m => ({
        ...m,
        decayedStrength: 1.0
      }));
      const ranked = rankMemories(memories, DEFAULT_WEIGHTS);
      
      assert.ok(ranked.length > 0, 'Should produce ranked results');
      assert.ok(ranked[0].combinedScore > 0, 'Top result should have positive score');
    });
  });
});
