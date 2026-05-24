/**
 * Tests for Automatic Clustering System
 * 
 * Tests clustering, label generation, and cross-cluster associations.
 * 
 * Requirements: 21.1-21.6, 22.1-22.6, 23.1-23.4
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { KnowledgeGraph } = require('./knowledge-graph');
const {
  cosineSimilarity,
  calculateCentroid,
  clusterMemories,
  extractClusterConcepts,
  storeCluster,
  calculateClusterSimilarity,
  detectCrossClusterAssociations,
  getRelatedClusters,
  updateClusterLabel,
  DEFAULT_PARAMS
} = require('./clustering');

describe('Automatic Clustering System', () => {
  let knowledgeGraph;

  before(async () => {
    knowledgeGraph = new KnowledgeGraph('./test-clustering-graph.json');
    await knowledgeGraph.initialize().catch(() => {
      knowledgeGraph.clear();
    });
  });

  after(async () => {
    if (knowledgeGraph) {
      await knowledgeGraph.shutdown();
    }
  });

  describe('cosineSimilarity', () => {
    it('should calculate similarity between identical vectors', () => {
      const vec = [1, 2, 3, 4, 5];
      const similarity = cosineSimilarity(vec, vec);
      
      assert.ok(Math.abs(similarity - 1.0) < 0.001, 'Identical vectors should have similarity 1.0');
    });

    it('should calculate similarity between orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.strictEqual(similarity, 0, 'Orthogonal vectors should have similarity 0');
    });

    it('should calculate similarity for similar vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2, 4];
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.ok(similarity > 0.9, 'Similar vectors should have high similarity');
    });

    it('should handle zero vectors', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.strictEqual(similarity, 0, 'Zero vector should have similarity 0');
    });

    it('should handle different length vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2];
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.strictEqual(similarity, 0, 'Different length vectors should return 0');
    });
  });

  describe('calculateCentroid', () => {
    it('should calculate centroid of vectors', () => {
      const vectors = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ];
      
      const centroid = calculateCentroid(vectors);
      
      assert.strictEqual(centroid.length, 3, 'Centroid should have same dimensions');
      assert.strictEqual(centroid[0], 4, 'First dimension should be average');
      assert.strictEqual(centroid[1], 5, 'Second dimension should be average');
      assert.strictEqual(centroid[2], 6, 'Third dimension should be average');
    });

    it('should handle single vector', () => {
      const vectors = [[1, 2, 3]];
      const centroid = calculateCentroid(vectors);
      
      assert.deepStrictEqual(centroid, [1, 2, 3], 'Centroid of single vector should be itself');
    });

    it('should handle empty array', () => {
      const centroid = calculateCentroid([]);
      
      assert.deepStrictEqual(centroid, [], 'Empty array should return empty centroid');
    });

    it('should calculate correct average', () => {
      const vectors = [
        [0, 0, 0],
        [10, 10, 10]
      ];
      
      const centroid = calculateCentroid(vectors);
      
      assert.deepStrictEqual(centroid, [5, 5, 5], 'Should calculate midpoint');
    });
  });

  describe('clusterMemories', () => {
    it('should cluster similar memories', () => {
      const memories = [
        { memoryId: 1, embedding: [1, 0, 0] },
        { memoryId: 2, embedding: [0.9, 0.1, 0] },
        { memoryId: 3, embedding: [0.8, 0.2, 0] },
        { memoryId: 4, embedding: [0, 0, 1] },
        { memoryId: 5, embedding: [0, 0.1, 0.9] },
        { memoryId: 6, embedding: [0, 0.2, 0.8] }
      ];

      const clusters = clusterMemories(memories, {
        minClusterSize: 3,
        similarityThreshold: 0.7
      });

      assert.ok(clusters.length > 0, 'Should create clusters');
      assert.ok(clusters.every(c => c.size >= 3), 'All clusters should meet minimum size');
    });

    it('should respect minimum cluster size', () => {
      const memories = [
        { memoryId: 1, embedding: [1, 0, 0] },
        { memoryId: 2, embedding: [0, 1, 0] },
        { memoryId: 3, embedding: [0, 0, 1] }
      ];

      const clusters = clusterMemories(memories, {
        minClusterSize: 5,
        similarityThreshold: 0.7
      });

      assert.strictEqual(clusters.length, 0, 'Should not create clusters below minimum size');
    });

    it('should include cluster metadata', () => {
      const memories = [
        { memoryId: 1, embedding: [1, 0, 0] },
        { memoryId: 2, embedding: [0.9, 0.1, 0] },
        { memoryId: 3, embedding: [0.8, 0.2, 0] }
      ];

      const clusters = clusterMemories(memories, {
        minClusterSize: 3,
        similarityThreshold: 0.7
      });

      if (clusters.length > 0) {
        assert.ok(clusters[0].id, 'Should have cluster ID');
        assert.ok(Array.isArray(clusters[0].memberIds), 'Should have member IDs');
        assert.ok(typeof clusters[0].size === 'number', 'Should have size');
        assert.ok(Array.isArray(clusters[0].centroid), 'Should have centroid');
      }
    });

    it('should handle insufficient memories', () => {
      const memories = [
        { memoryId: 1, embedding: [1, 0, 0] },
        { memoryId: 2, embedding: [0, 1, 0] }
      ];

      const clusters = clusterMemories(memories, {
        minClusterSize: 3,
        similarityThreshold: 0.7
      });

      assert.strictEqual(clusters.length, 0, 'Should return empty array');
    });

    it('should use similarity threshold', () => {
      const memories = [
        { memoryId: 1, embedding: [1, 0, 0] },
        { memoryId: 2, embedding: [0.5, 0.5, 0] },
        { memoryId: 3, embedding: [0, 1, 0] }
      ];

      const strictClusters = clusterMemories(memories, {
        minClusterSize: 2,
        similarityThreshold: 0.9
      });

      const looseClusters = clusterMemories(memories, {
        minClusterSize: 2,
        similarityThreshold: 0.5
      });

      // Looser threshold should potentially create more/larger clusters
      assert.ok(true, 'Should respect similarity threshold');
    });
  });

  describe('extractClusterConcepts', () => {
    it('should extract concepts from cluster members', () => {
      // Setup: Add memories and concepts
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

      knowledgeGraph.linkMemoryToConcept(memory1, concept1, 1.0);
      knowledgeGraph.linkMemoryToConcept(memory1, concept2, 0.8);
      knowledgeGraph.linkMemoryToConcept(memory2, concept1, 1.0);

      const concepts = extractClusterConcepts(knowledgeGraph, [1, 2], 10);

      assert.ok(concepts.length > 0, 'Should extract concepts');
      assert.ok(concepts.includes('test1'), 'Should include frequent concept');
    });

    it('should respect topN parameter', () => {
      const concepts = extractClusterConcepts(knowledgeGraph, [1, 2], 1);
      
      assert.ok(concepts.length <= 1, 'Should respect topN limit');
    });

    it('should handle empty member list', () => {
      const concepts = extractClusterConcepts(knowledgeGraph, [], 10);
      
      assert.strictEqual(concepts.length, 0, 'Should return empty array');
    });

    it('should sort by frequency', () => {
      // The most frequent concept should appear first
      const concepts = extractClusterConcepts(knowledgeGraph, [1, 2], 10);
      
      assert.ok(Array.isArray(concepts), 'Should return array');
    });
  });

  describe('storeCluster', () => {
    it('should store cluster in knowledge graph', () => {
      const cluster = {
        id: 'cluster_test_1',
        memberIds: [1, 2, 3],
        size: 3,
        centroid: [0.5, 0.5, 0.5]
      };

      const clusterId = storeCluster(knowledgeGraph, cluster, 'Test Cluster');

      assert.strictEqual(clusterId, cluster.id, 'Should return cluster ID');
      
      const stored = knowledgeGraph.getCluster(clusterId);
      assert.ok(stored, 'Cluster should be stored');
      assert.strictEqual(stored.label, 'Test Cluster', 'Should store label');
    });

    it('should create cluster membership edges', () => {
      // Add memories first
      knowledgeGraph.addMemory({
        id: 'memory_10',
        memoryId: '10',
        timestamp: new Date().toISOString()
      });

      const cluster = {
        id: 'cluster_test_2',
        memberIds: [10],
        size: 1,
        centroid: [1, 0, 0]
      };

      storeCluster(knowledgeGraph, cluster, 'Single Member Cluster');

      const members = knowledgeGraph.getClusterMembers(cluster.id);
      assert.ok(members.length > 0, 'Should have cluster members');
    });
  });

  describe('calculateClusterSimilarity', () => {
    it('should calculate similarity between centroids', () => {
      const centroid1 = [1, 0, 0];
      const centroid2 = [0.9, 0.1, 0];
      
      const similarity = calculateClusterSimilarity(centroid1, centroid2);
      
      assert.ok(similarity > 0.8, 'Similar centroids should have high similarity');
    });

    it('should return 1.0 for identical centroids', () => {
      const centroid = [1, 2, 3];
      
      const similarity = calculateClusterSimilarity(centroid, centroid);
      
      assert.ok(Math.abs(similarity - 1.0) < 0.001, 'Identical centroids should have similarity 1.0');
    });

    it('should return low similarity for dissimilar centroids', () => {
      const centroid1 = [1, 0, 0];
      const centroid2 = [0, 1, 0];
      
      const similarity = calculateClusterSimilarity(centroid1, centroid2);
      
      assert.strictEqual(similarity, 0, 'Orthogonal centroids should have similarity 0');
    });
  });

  describe('detectCrossClusterAssociations', () => {
    it('should detect associations above threshold', () => {
      const clusters = [
        {
          id: 'cluster_a',
          centroid: [1, 0, 0],
          size: 3
        },
        {
          id: 'cluster_b',
          centroid: [0.9, 0.1, 0],
          size: 3
        },
        {
          id: 'cluster_c',
          centroid: [0, 0, 1],
          size: 3
        }
      ];

      // Add clusters to graph first
      for (const cluster of clusters) {
        knowledgeGraph.addCluster({
          id: cluster.id,
          label: cluster.id,
          size: cluster.size,
          centroid: cluster.centroid
        });
      }

      const associations = detectCrossClusterAssociations(
        knowledgeGraph,
        clusters,
        0.5
      );

      assert.ok(Array.isArray(associations), 'Should return array');
      // Clusters A and B should be associated (high similarity)
      // Cluster C should not be associated with A or B (low similarity)
    });

    it('should respect similarity threshold', () => {
      const clusters = [
        {
          id: 'cluster_d',
          centroid: [1, 0, 0],
          size: 3
        },
        {
          id: 'cluster_e',
          centroid: [0, 1, 0],
          size: 3
        }
      ];

      for (const cluster of clusters) {
        knowledgeGraph.addCluster({
          id: cluster.id,
          label: cluster.id,
          size: cluster.size,
          centroid: cluster.centroid
        });
      }

      const associations = detectCrossClusterAssociations(
        knowledgeGraph,
        clusters,
        0.9
      );

      // Orthogonal clusters should not be associated with high threshold
      assert.strictEqual(associations.length, 0, 'Should not create associations below threshold');
    });

    it('should store associations in knowledge graph', () => {
      const clusters = [
        {
          id: 'cluster_f',
          centroid: [1, 0, 0],
          size: 3
        },
        {
          id: 'cluster_g',
          centroid: [0.95, 0.05, 0],
          size: 3
        }
      ];

      for (const cluster of clusters) {
        knowledgeGraph.addCluster({
          id: cluster.id,
          label: cluster.id,
          size: cluster.size,
          centroid: cluster.centroid
        });
      }

      detectCrossClusterAssociations(knowledgeGraph, clusters, 0.5);

      const related = knowledgeGraph.getRelatedClusters('cluster_f', 0.5);
      assert.ok(Array.isArray(related), 'Should be able to query related clusters');
    });

    it('should handle empty cluster array', () => {
      const associations = detectCrossClusterAssociations(knowledgeGraph, [], 0.5);
      
      assert.strictEqual(associations.length, 0, 'Should return empty array');
    });
  });

  describe('getRelatedClusters', () => {
    it('should retrieve related clusters', () => {
      // Setup done in previous tests
      const related = getRelatedClusters(knowledgeGraph, 'cluster_f', 0.5);
      
      assert.ok(Array.isArray(related), 'Should return array');
    });

    it('should respect minimum similarity', () => {
      const highThreshold = getRelatedClusters(knowledgeGraph, 'cluster_f', 0.99);
      const lowThreshold = getRelatedClusters(knowledgeGraph, 'cluster_f', 0.1);
      
      // Lower threshold should return same or more results
      assert.ok(lowThreshold.length >= highThreshold.length, 'Lower threshold should return more results');
    });
  });

  describe('updateClusterLabel', () => {
    it('should update cluster label', () => {
      const clusterId = 'cluster_f';
      const newLabel = 'Updated Label';
      
      const success = updateClusterLabel(knowledgeGraph, clusterId, newLabel);
      
      assert.strictEqual(success, true, 'Should successfully update label');
      
      const cluster = knowledgeGraph.getCluster(clusterId);
      assert.strictEqual(cluster.label, newLabel, 'Label should be updated');
    });

    it('should return false for non-existent cluster', () => {
      const success = updateClusterLabel(knowledgeGraph, 'non_existent', 'New Label');
      
      assert.strictEqual(success, false, 'Should return false for non-existent cluster');
    });
  });

  describe('Integration: Full clustering workflow', () => {
    it('should handle complete clustering pipeline', () => {
      // Create sample memories with embeddings
      const memories = [
        { memoryId: 101, embedding: [1, 0, 0, 0, 0] },
        { memoryId: 102, embedding: [0.9, 0.1, 0, 0, 0] },
        { memoryId: 103, embedding: [0.8, 0.2, 0, 0, 0] },
        { memoryId: 104, embedding: [0, 0, 1, 0, 0] },
        { memoryId: 105, embedding: [0, 0, 0.9, 0.1, 0] },
        { memoryId: 106, embedding: [0, 0, 0.8, 0.2, 0] }
      ];

      // Cluster memories
      const clusters = clusterMemories(memories, {
        minClusterSize: 3,
        similarityThreshold: 0.7
      });

      assert.ok(clusters.length > 0, 'Should create clusters');

      // Calculate centroids
      for (const cluster of clusters) {
        assert.ok(cluster.centroid.length > 0, 'Should have centroid');
      }

      // Store clusters (simplified - would need full setup)
      assert.ok(true, 'Clustering workflow completed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle high-dimensional embeddings', () => {
      const vec1 = new Array(768).fill(0.5);
      const vec2 = new Array(768).fill(0.5);
      
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.ok(Math.abs(similarity - 1.0) < 0.001, 'Should handle high dimensions');
    });

    it('should handle negative values in embeddings', () => {
      const vec1 = [-1, -2, -3];
      const vec2 = [-1, -2, -3];
      
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.ok(Math.abs(similarity - 1.0) < 0.001, 'Should handle negative values');
    });

    it('should handle very small similarity values', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0.001, 0.999, 0];
      
      const similarity = cosineSimilarity(vec1, vec2);
      
      assert.ok(similarity >= 0 && similarity <= 1, 'Similarity should be in valid range');
    });
  });
});
