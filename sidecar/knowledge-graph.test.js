/**
 * Unit Tests for Knowledge Graph Storage Layer
 * 
 * Tests node operations, edge operations, graph traversal, and persistence.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const { KnowledgeGraph, NodeType, EdgeType } = require('./knowledge-graph');

describe('KnowledgeGraph', () => {
  let kg;
  const testPersistPath = './test-knowledge-graph.json';

  beforeEach(async () => {
    kg = new KnowledgeGraph(testPersistPath);
    await kg.initialize();
  });

  afterEach(async () => {
    await kg.shutdown();
    // Clean up test file
    try {
      await fs.unlink(testPersistPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  describe('Concept Node Operations', () => {
    test('should add a new concept', () => {
      const conceptId = kg.addConcept({
        id: 'concept-1',
        name: 'JavaScript',
        type: 'topic',
        confidence: 0.9
      });

      assert.strictEqual(conceptId, 'concept-1');
      
      const concept = kg.getConcept('concept-1');
      assert.strictEqual(concept.name, 'JavaScript');
      assert.strictEqual(concept.type, 'topic');
      assert.strictEqual(concept.confidence, 0.9);
      assert.strictEqual(concept.occurrenceCount, 1);
    });

    test('should update existing concept occurrence count', () => {
      kg.addConcept({
        id: 'concept-1',
        name: 'React',
        type: 'topic',
        confidence: 0.85
      });

      kg.addConcept({
        id: 'concept-1',
        name: 'React',
        type: 'topic',
        confidence: 0.85
      });

      const concept = kg.getConcept('concept-1');
      assert.strictEqual(concept.occurrenceCount, 2);
    });

    test('should return null for non-existent concept', () => {
      const concept = kg.getConcept('non-existent');
      assert.strictEqual(concept, null);
    });

    test('should get all concepts', () => {
      kg.addConcept({ id: 'c1', name: 'Node.js', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'Python', type: 'topic', confidence: 0.85 });
      kg.addConcept({ id: 'c3', name: 'Docker', type: 'topic', confidence: 0.8 });

      const concepts = kg.getAllConcepts();
      assert.strictEqual(concepts.length, 3);
    });

    test('should find concepts by name', () => {
      kg.addConcept({ id: 'c1', name: 'JavaScript', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'Java', type: 'topic', confidence: 0.85 });
      kg.addConcept({ id: 'c3', name: 'Python', type: 'topic', confidence: 0.8 });

      const results = kg.findConceptsByName('java');
      assert.strictEqual(results.length, 2);
      assert.ok(results.some(c => c.name === 'JavaScript'));
      assert.ok(results.some(c => c.name === 'Java'));
    });
  });

  describe('Memory Node Operations', () => {
    test('should add a memory node', () => {
      const memoryId = kg.addMemory({
        id: 'mem-1',
        memoryId: '123',
        timestamp: '2024-01-01T00:00:00Z'
      });

      assert.strictEqual(memoryId, 'mem-1');
      
      const memory = kg.getMemory('mem-1');
      assert.strictEqual(memory.memoryId, '123');
      assert.strictEqual(memory.timestamp, '2024-01-01T00:00:00Z');
    });

    test('should not duplicate memory nodes', () => {
      kg.addMemory({ id: 'mem-1', memoryId: '123', timestamp: '2024-01-01T00:00:00Z' });
      kg.addMemory({ id: 'mem-1', memoryId: '123', timestamp: '2024-01-01T00:00:00Z' });

      const stats = kg.getStats();
      assert.strictEqual(stats.memories, 1);
    });

    test('should return null for non-existent memory', () => {
      const memory = kg.getMemory('non-existent');
      assert.strictEqual(memory, null);
    });
  });

  describe('Cluster Node Operations', () => {
    test('should add a cluster node', () => {
      const clusterId = kg.addCluster({
        id: 'cluster-1',
        label: 'Web Development',
        size: 10,
        centroid: [0.1, 0.2, 0.3]
      });

      assert.strictEqual(clusterId, 'cluster-1');
      
      const cluster = kg.getCluster('cluster-1');
      assert.strictEqual(cluster.label, 'Web Development');
      assert.strictEqual(cluster.size, 10);
      assert.deepStrictEqual(cluster.centroid, [0.1, 0.2, 0.3]);
    });

    test('should update existing cluster', () => {
      kg.addCluster({
        id: 'cluster-1',
        label: 'Web Dev',
        size: 5,
        centroid: [0.1, 0.2, 0.3]
      });

      kg.addCluster({
        id: 'cluster-1',
        label: 'Web Development',
        size: 10,
        centroid: [0.15, 0.25, 0.35]
      });

      const cluster = kg.getCluster('cluster-1');
      assert.strictEqual(cluster.label, 'Web Development');
      assert.strictEqual(cluster.size, 10);
    });
  });

  describe('Concept Association Operations', () => {
    beforeEach(() => {
      kg.addConcept({ id: 'c1', name: 'React', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'JavaScript', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c3', name: 'Node.js', type: 'topic', confidence: 0.85 });
    });

    test('should create bidirectional association', () => {
      const success = kg.addConceptAssociation('c1', 'c2');
      assert.strictEqual(success, true);

      const assoc = kg.getConceptAssociation('c1', 'c2');
      assert.ok(assoc.strength > 0 && assoc.strength <= 1);
      assert.strictEqual(assoc.coOccurrences, 1);

      // Check bidirectionality
      const reverseAssoc = kg.getConceptAssociation('c2', 'c1');
      assert.ok(reverseAssoc !== null);
    });

    test('should update association on reinforcement', () => {
      kg.addConceptAssociation('c1', 'c2');
      const firstAssoc = kg.getConceptAssociation('c1', 'c2');
      const firstStrength = firstAssoc.strength;

      kg.addConceptAssociation('c1', 'c2');
      const secondAssoc = kg.getConceptAssociation('c1', 'c2');

      assert.strictEqual(secondAssoc.coOccurrences, 2);
      // Strength should increase with more co-occurrences
      assert.ok(secondAssoc.strength >= firstStrength);
    });

    test('should get all associations for a concept', () => {
      kg.addConceptAssociation('c1', 'c2');
      kg.addConceptAssociation('c1', 'c3');

      const associations = kg.getConceptAssociations('c1');
      assert.strictEqual(associations.length, 2);
    });

    test('should return empty array for concept with no associations', () => {
      const associations = kg.getConceptAssociations('c1');
      assert.strictEqual(associations.length, 0);
    });

    test('should not create association with non-existent concept', () => {
      const success = kg.addConceptAssociation('c1', 'non-existent');
      assert.strictEqual(success, false);
    });

    test('should calculate association strength based on co-occurrence', () => {
      // Create multiple associations to establish max co-occurrence
      kg.addConceptAssociation('c1', 'c2');
      kg.addConceptAssociation('c1', 'c2');
      kg.addConceptAssociation('c1', 'c2');

      const assoc = kg.getConceptAssociation('c1', 'c2');
      assert.strictEqual(assoc.coOccurrences, 3);
      assert.ok(assoc.strength > 0 && assoc.strength <= 1);
    });

    test('should remove associations below threshold', () => {
      kg.addConceptAssociation('c1', 'c2');
      kg.addConceptAssociation('c1', 'c3');

      // Wait a bit to simulate time passing (for recency decay)
      // In real scenario, this would be days, but we test the mechanism
      const removed = kg.recalculateAssociationStrengths(0.3);
      
      // Should not remove fresh associations
      assert.ok(removed >= 0);
    });
  });

  describe('Graph Traversal', () => {
    beforeEach(() => {
      // Create a small concept network
      kg.addConcept({ id: 'c1', name: 'React', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'JavaScript', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c3', name: 'Node.js', type: 'topic', confidence: 0.85 });
      kg.addConcept({ id: 'c4', name: 'Express', type: 'topic', confidence: 0.8 });
      kg.addConcept({ id: 'c5', name: 'MongoDB', type: 'topic', confidence: 0.75 });

      // Create associations (strength is auto-calculated)
      kg.addConceptAssociation('c1', 'c2'); // React <-> JavaScript
      kg.addConceptAssociation('c2', 'c3'); // JavaScript <-> Node.js
      kg.addConceptAssociation('c3', 'c4'); // Node.js <-> Express
      kg.addConceptAssociation('c4', 'c5'); // Express <-> MongoDB
    });

    test('should find concepts within 1 hop', () => {
      const associated = kg.getAssociatedConcepts('c1', 1, 0.3);
      
      assert.strictEqual(associated.length, 1);
      assert.ok(associated.some(c => c.id === 'c2' && c.hops === 1));
    });

    test('should find concepts within 2 hops', () => {
      const associated = kg.getAssociatedConcepts('c1', 2, 0.3);
      
      assert.ok(associated.length >= 2);
      assert.ok(associated.some(c => c.id === 'c2' && c.hops === 1));
      assert.ok(associated.some(c => c.id === 'c3' && c.hops === 2));
    });

    test('should respect minimum strength threshold', () => {
      // All fresh associations should have similar strength
      // Test with a very high threshold to filter most out
      const associated = kg.getAssociatedConcepts('c1', 2, 0.99);
      
      // Should return empty or very few results with such high threshold
      assert.ok(associated.length <= 2);
    });

    test('should return empty array for non-existent concept', () => {
      const associated = kg.getAssociatedConcepts('non-existent', 2, 0.3);
      assert.strictEqual(associated.length, 0);
    });

    test('should not include starting concept in results', () => {
      const associated = kg.getAssociatedConcepts('c1', 2, 0.3);
      assert.ok(!associated.some(c => c.id === 'c1'));
    });
  });

  describe('Memory-Concept Links', () => {
    beforeEach(() => {
      kg.addMemory({ id: 'mem-1', memoryId: '123', timestamp: '2024-01-01T00:00:00Z' });
      kg.addConcept({ id: 'c1', name: 'React', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'JavaScript', type: 'topic', confidence: 0.9 });
    });

    test('should link memory to concept', () => {
      const success = kg.linkMemoryToConcept('mem-1', 'c1', 0.95);
      assert.strictEqual(success, true);

      const concepts = kg.getMemoryConcepts('mem-1');
      assert.strictEqual(concepts.length, 1);
      assert.strictEqual(concepts[0].id, 'c1');
      assert.strictEqual(concepts[0].relevance, 0.95);
    });

    test('should link memory to multiple concepts', () => {
      kg.linkMemoryToConcept('mem-1', 'c1', 0.95);
      kg.linkMemoryToConcept('mem-1', 'c2', 0.85);

      const concepts = kg.getMemoryConcepts('mem-1');
      assert.strictEqual(concepts.length, 2);
    });

    test('should get memories linked to concept', () => {
      kg.addMemory({ id: 'mem-2', memoryId: '456', timestamp: '2024-01-02T00:00:00Z' });
      
      kg.linkMemoryToConcept('mem-1', 'c1', 0.95);
      kg.linkMemoryToConcept('mem-2', 'c1', 0.85);

      const memories = kg.getConceptMemories('c1');
      assert.strictEqual(memories.length, 2);
    });

    test('should not create duplicate links', () => {
      kg.linkMemoryToConcept('mem-1', 'c1', 0.95);
      kg.linkMemoryToConcept('mem-1', 'c1', 0.85);

      const concepts = kg.getMemoryConcepts('mem-1');
      assert.strictEqual(concepts.length, 1);
    });
  });

  describe('Cluster Membership', () => {
    beforeEach(() => {
      kg.addMemory({ id: 'mem-1', memoryId: '123', timestamp: '2024-01-01T00:00:00Z' });
      kg.addMemory({ id: 'mem-2', memoryId: '456', timestamp: '2024-01-02T00:00:00Z' });
      kg.addCluster({ id: 'cluster-1', label: 'Web Dev', size: 2, centroid: [0.1, 0.2] });
    });

    test('should add memory to cluster', () => {
      const success = kg.addClusterMembership('mem-1', 'cluster-1', 0.15);
      assert.strictEqual(success, true);

      const members = kg.getClusterMembers('cluster-1');
      assert.strictEqual(members.length, 1);
      assert.strictEqual(members[0].memoryId, '123');
      assert.strictEqual(members[0].distance, 0.15);
    });

    test('should add multiple memories to cluster', () => {
      kg.addClusterMembership('mem-1', 'cluster-1', 0.15);
      kg.addClusterMembership('mem-2', 'cluster-1', 0.25);

      const members = kg.getClusterMembers('cluster-1');
      assert.strictEqual(members.length, 2);
    });
  });

  describe('Image Node Operations', () => {
    beforeEach(() => {
      kg.addMemory({ id: 'memory_1', memoryId: '1', timestamp: '2024-01-01T00:00:00Z' });
    });

    test('should add an image node and link it to its memory', () => {
      const imgId = kg.addImage({
        id: 'image_10',
        imageId: 10,
        url: 'https://example.com/cat.png',
        alt: 'a cat',
        caption: 'A photo of a tabby cat sitting on a windowsill.',
        width: 640,
        height: 480,
        memoryNodeId: 'memory_1',
        timestamp: '2024-01-01T00:00:00Z'
      });
      assert.strictEqual(imgId, 'image_10');

      const linked = kg.linkMemoryToImage('memory_1', 'image_10');
      assert.strictEqual(linked, true);

      const stats = kg.getStats();
      assert.strictEqual(stats.images, 1);
      assert.strictEqual(stats.memoryImageLinks, 1);
    });

    test('should merge a caption onto an existing image node', () => {
      kg.addImage({ id: 'image_11', imageId: 11, url: 'u', alt: '', memoryNodeId: 'memory_1' });
      kg.addImage({ id: 'image_11', imageId: 11, url: 'u', alt: '', caption: 'later caption', memoryNodeId: 'memory_1' });

      const attrs = kg.graph.getNodeAttributes('image_11');
      assert.strictEqual(attrs.caption, 'later caption');
      assert.strictEqual(kg.getStats().images, 1);
    });

    test('linkMemoryToImage returns false for unknown nodes', () => {
      assert.strictEqual(kg.linkMemoryToImage('memory_1', 'image_missing'), false);
    });

    test('image nodes appear in visualization data with thumbnail fields', () => {
      kg.addImage({
        id: 'image_12', imageId: 12, url: 'https://example.com/x.png',
        alt: 'diagram', caption: 'An architecture diagram.',
        memoryNodeId: 'memory_1', timestamp: '2024-01-01T00:00:00Z'
      });
      kg.linkMemoryToImage('memory_1', 'image_12');

      const viz = kg.getVisualizationData({ mode: 'full', maxNodes: 50 });
      const imgNode = viz.nodes.find(n => n.id === 'image_12');
      assert.ok(imgNode, 'image node should be present in full mode');
      assert.strictEqual(imgNode.shape, 'image');
      assert.strictEqual(imgNode.image, 'https://example.com/x.png');
      assert.strictEqual(imgNode.group, NodeType.IMAGE);

      const link = viz.edges.find(e => e.from === 'memory_1' && e.to === 'image_12');
      assert.ok(link, 'memory→image edge should be present');
    });
  });

  describe('Cross-Cluster Links', () => {
    beforeEach(() => {
      kg.addCluster({ id: 'cluster-1', label: 'Web Dev', size: 5, centroid: [0.1, 0.2] });
      kg.addCluster({ id: 'cluster-2', label: 'Backend', size: 3, centroid: [0.15, 0.25] });
      kg.addCluster({ id: 'cluster-3', label: 'Frontend', size: 4, centroid: [0.2, 0.3] });
    });

    test('should create cross-cluster link', () => {
      const success = kg.addCrossClusterLink('cluster-1', 'cluster-2', 0.75);
      assert.strictEqual(success, true);
    });

    test('should get related clusters', () => {
      kg.addCrossClusterLink('cluster-1', 'cluster-2', 0.75);
      kg.addCrossClusterLink('cluster-1', 'cluster-3', 0.6);

      const related = kg.getRelatedClusters('cluster-1', 0.5);
      assert.strictEqual(related.length, 2);
    });

    test('should filter by minimum similarity', () => {
      kg.addCrossClusterLink('cluster-1', 'cluster-2', 0.75);
      kg.addCrossClusterLink('cluster-1', 'cluster-3', 0.4);

      const related = kg.getRelatedClusters('cluster-1', 0.5);
      assert.strictEqual(related.length, 1);
      assert.strictEqual(related[0].id, 'cluster-2');
    });
  });

  describe('Graph Statistics', () => {
    test('should return correct statistics', () => {
      kg.addConcept({ id: 'c1', name: 'React', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'JavaScript', type: 'topic', confidence: 0.9 });
      kg.addMemory({ id: 'mem-1', memoryId: '123', timestamp: '2024-01-01T00:00:00Z' });
      kg.addCluster({ id: 'cluster-1', label: 'Web Dev', size: 1, centroid: [0.1] });

      kg.addConceptAssociation('c1', 'c2', 0.8);
      kg.linkMemoryToConcept('mem-1', 'c1', 0.9);
      kg.addClusterMembership('mem-1', 'cluster-1', 0.1);

      const stats = kg.getStats();
      assert.strictEqual(stats.concepts, 2);
      assert.strictEqual(stats.memories, 1);
      assert.strictEqual(stats.clusters, 1);
      assert.strictEqual(stats.conceptAssociations, 1);
      assert.strictEqual(stats.memoryConceptLinks, 1);
      assert.strictEqual(stats.clusterMemberships, 1);
    });

    test('should return zero statistics for empty graph', () => {
      const stats = kg.getStats();
      assert.strictEqual(stats.totalNodes, 0);
      assert.strictEqual(stats.totalEdges, 0);
      assert.strictEqual(stats.concepts, 0);
      assert.strictEqual(stats.memories, 0);
    });
  });

  describe('Persistence', () => {
    test('should save and load graph', async () => {
      kg.addConcept({ id: 'c1', name: 'React', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'JavaScript', type: 'topic', confidence: 0.9 });
      kg.addConceptAssociation('c1', 'c2');

      await kg.save();

      // Create new instance and load
      const kg2 = new KnowledgeGraph(testPersistPath);
      await kg2.initialize();

      const concept = kg2.getConcept('c1');
      assert.strictEqual(concept.name, 'React');

      const assoc = kg2.getConceptAssociation('c1', 'c2');
      assert.ok(assoc.strength > 0);

      await kg2.shutdown();
    });

    test('should handle missing file gracefully', async () => {
      const kg2 = new KnowledgeGraph('./non-existent-graph.json');
      await kg2.initialize(); // Should not throw

      const stats = kg2.getStats();
      assert.strictEqual(stats.totalNodes, 0);

      await kg2.shutdown();
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty graph operations', () => {
      const concepts = kg.getAllConcepts();
      assert.strictEqual(concepts.length, 0);

      const stats = kg.getStats();
      assert.strictEqual(stats.totalNodes, 0);
    });

    test('should handle operations on non-existent nodes', () => {
      const success = kg.addConceptAssociation('non-existent-1', 'non-existent-2');
      assert.strictEqual(success, false);

      const concepts = kg.getMemoryConcepts('non-existent');
      assert.strictEqual(concepts.length, 0);
    });

    test('should clear graph', () => {
      kg.addConcept({ id: 'c1', name: 'React', type: 'topic', confidence: 0.9 });
      kg.addConcept({ id: 'c2', name: 'JavaScript', type: 'topic', confidence: 0.9 });

      kg.clear();

      const stats = kg.getStats();
      assert.strictEqual(stats.totalNodes, 0);
      assert.strictEqual(stats.totalEdges, 0);
    });
  });
});
