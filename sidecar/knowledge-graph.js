/**
 * Knowledge Graph Storage Layer
 * 
 * Implements the knowledge graph for storing concepts, entities, and their relationships.
 * Supports bidirectional associations, graph traversal, and association strength tracking.
 * 
 * Requirements: 1.1, 1.2, 1.3
 */

const Graph = require('graphology');
const { bidirectional } = require('graphology-shortest-path');
const fs = require('fs').promises;
const path = require('path');

/**
 * Node Types
 */
const NodeType = {
  CONCEPT: 'concept',
  MEMORY:  'memory',
  CLUSTER: 'cluster',
  DOMAIN:  'domain'   // website hostname hub
};

/**
 * Edge Types
 */
const EdgeType = {
  CONCEPT_ASSOCIATION:  'concept_association',
  MEMORY_CONCEPT_LINK:  'memory_concept_link',
  CLUSTER_MEMBERSHIP:   'cluster_membership',
  CROSS_CLUSTER_LINK:   'cross_cluster_link',
  DOMAIN_MEMBERSHIP:    'domain_membership',    // memory → domain
  SESSION_SEQUENCE:     'session_sequence'      // memory → next memory (same session)
};

/**
 * Knowledge Graph Manager
 * 
 * Manages the in-memory graph database with persistence to disk.
 */
class KnowledgeGraph {
  /**
   * @param {string} persistPath - Path to persist graph data
   */
  constructor(persistPath = './lancedb/knowledge-graph.json') {
    this.graph = new Graph({ multi: false, allowSelfLoops: false });
    this.persistPath = persistPath;
    this.isDirty = false;
    this.autoSaveInterval = null;
  }

  /**
   * Initialize the knowledge graph
   * Load from disk if exists, otherwise create new
   */
  async initialize() {
    try {
      await this.load();
      console.log(`Knowledge graph loaded: ${this.graph.order} nodes, ${this.graph.size} edges`);
    } catch (error) {
      console.log('No existing knowledge graph found, creating new one');
      this.graph = new Graph({ multi: false, allowSelfLoops: false });
    }

    // Auto-save every 5 minutes if dirty
    this.autoSaveInterval = setInterval(() => {
      if (this.isDirty) {
        this.save().catch(err => console.error('Auto-save failed:', err));
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Shutdown the knowledge graph
   * Save to disk and cleanup
   */
  async shutdown() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    if (this.isDirty) {
      await this.save();
    }
  }

  // ============================================================================
  // CONCEPT NODE OPERATIONS
  // ============================================================================

  /**
   * Add or update a concept node
   * 
   * @param {Object} concept - Concept data
   * @param {string} concept.id - Unique concept identifier
   * @param {string} concept.name - Concept name
   * @param {string} concept.type - 'entity' or 'topic'
   * @param {number} concept.confidence - Confidence score (0-1)
   * @returns {string} Concept ID
   */
  addConcept({ id, name, type, confidence }) {
    const now = new Date().toISOString();
    
    if (this.graph.hasNode(id)) {
      // Update existing concept
      const attrs = this.graph.getNodeAttributes(id);
      this.graph.mergeNodeAttributes(id, {
        lastSeen: now,
        occurrenceCount: attrs.occurrenceCount + 1
      });
    } else {
      // Create new concept
      this.graph.addNode(id, {
        nodeType: NodeType.CONCEPT,
        name,
        type,
        confidence,
        firstSeen: now,
        lastSeen: now,
        occurrenceCount: 1
      });
    }

    this.isDirty = true;
    return id;
  }

  /**
   * Get concept by ID
   * 
   * @param {string} conceptId - Concept ID
   * @returns {Object|null} Concept data or null if not found
   */
  getConcept(conceptId) {
    if (!this.graph.hasNode(conceptId)) {
      return null;
    }

    const attrs = this.graph.getNodeAttributes(conceptId);
    if (attrs.nodeType !== NodeType.CONCEPT) {
      return null;
    }

    return {
      id: conceptId,
      ...attrs
    };
  }

  /**
   * Get all concepts
   * 
   * @returns {Array<Object>} Array of concept data
   */
  getAllConcepts() {
    const concepts = [];
    this.graph.forEachNode((node, attrs) => {
      if (attrs.nodeType === NodeType.CONCEPT) {
        concepts.push({ id: node, ...attrs });
      }
    });
    return concepts;
  }

  /**
   * Find concepts by name (case-insensitive partial match)
   * 
   * @param {string} query - Search query
   * @returns {Array<Object>} Matching concepts
   */
  findConceptsByName(query) {
    const lowerQuery = query.toLowerCase();
    const concepts = [];
    
    this.graph.forEachNode((node, attrs) => {
      if (attrs.nodeType === NodeType.CONCEPT && 
          attrs.name.toLowerCase().includes(lowerQuery)) {
        concepts.push({ id: node, ...attrs });
      }
    });
    
    return concepts;
  }

  // ============================================================================
  // MEMORY NODE OPERATIONS
  // ============================================================================

  /**
   * Add a memory node
   * 
   * @param {Object} memory - Memory data
   * @param {string} memory.id - Unique memory identifier
   * @param {string} memory.memoryId - Reference to SQLite memory record
   * @param {string} memory.timestamp - ISO timestamp
   * @returns {string} Memory node ID
   */
  addMemory({ id, memoryId, timestamp, sessionId = null, domain = null }) {
    if (this.graph.hasNode(id)) {
      // Update session/domain if we have richer data now
      if (sessionId) this.graph.mergeNodeAttributes(id, { sessionId });
      if (domain)    this.graph.mergeNodeAttributes(id, { domain });
      return id;
    }
    this.graph.addNode(id, {
      nodeType: NodeType.MEMORY,
      memoryId,
      timestamp,
      sessionId,
      domain
    });
    this.isDirty = true;
    return id;
  }

  // ── Domain node operations ──────────────────────────────────────────────────

  addDomain(domain) {
    const nodeId = `domain_${domain}`;
    if (this.graph.hasNode(nodeId)) {
      this.graph.mergeNodeAttributes(nodeId, {
        memoryCount: (this.graph.getNodeAttribute(nodeId, 'memoryCount') || 0) + 1
      });
    } else {
      this.graph.addNode(nodeId, { nodeType: NodeType.DOMAIN, domain, memoryCount: 1 });
    }
    this.isDirty = true;
    return nodeId;
  }

  linkMemoryToDomain(memNodeId, domainNodeId) {
    if (!this.graph.hasNode(memNodeId) || !this.graph.hasNode(domainNodeId)) return false;
    if (this.graph.hasEdge(memNodeId, domainNodeId)) return false;
    this.graph.addEdge(memNodeId, domainNodeId, { edgeType: EdgeType.DOMAIN_MEMBERSHIP });
    this.isDirty = true;
    return true;
  }

  // ── Session-sequence operations ─────────────────────────────────────────────

  linkMemoriesInSession(prevMemNodeId, nextMemNodeId, sessionId) {
    if (!this.graph.hasNode(prevMemNodeId) || !this.graph.hasNode(nextMemNodeId)) return false;
    if (this.graph.hasEdge(prevMemNodeId, nextMemNodeId)) return false;
    this.graph.addEdge(prevMemNodeId, nextMemNodeId, {
      edgeType: EdgeType.SESSION_SEQUENCE,
      sessionId
    });
    this.isDirty = true;
    return true;
  }

  // Find the most-recent memory node in a given session (exclude currentNodeId)
  getPreviousMemoryInSession(sessionId, excludeNodeId) {
    let latestNodeId = null, latestTs = null;
    this.graph.forEachNode((nodeId, attrs) => {
      if (attrs.nodeType !== NodeType.MEMORY) return;
      if (attrs.sessionId !== sessionId) return;
      if (nodeId === excludeNodeId) return;
      if (!latestTs || attrs.timestamp > latestTs) {
        latestTs    = attrs.timestamp;
        latestNodeId = nodeId;
      }
    });
    return latestNodeId;
  }

  /**
   * Get memory node by ID
   * 
   * @param {string} memoryNodeId - Memory node ID
   * @returns {Object|null} Memory data or null if not found
   */
  getMemory(memoryNodeId) {
    if (!this.graph.hasNode(memoryNodeId)) {
      return null;
    }

    const attrs = this.graph.getNodeAttributes(memoryNodeId);
    if (attrs.nodeType !== NodeType.MEMORY) {
      return null;
    }

    return {
      id: memoryNodeId,
      ...attrs
    };
  }

  // ============================================================================
  // CLUSTER NODE OPERATIONS
  // ============================================================================

  /**
   * Add a cluster node
   * 
   * @param {Object} cluster - Cluster data
   * @param {string} cluster.id - Unique cluster identifier
   * @param {string} cluster.label - Cluster label
   * @param {number} cluster.size - Number of members
   * @param {Array<number>} cluster.centroid - Embedding centroid
   * @returns {string} Cluster ID
   */
  addCluster({ id, label, size, centroid }) {
    const now = new Date().toISOString();

    if (this.graph.hasNode(id)) {
      // Update existing cluster
      const createdAt = this.graph.getNodeAttribute(id, 'createdAt');
      this.graph.mergeNodeAttributes(id, {
        label,
        size,
        centroid
      });
    } else {
      // Create new cluster
      this.graph.addNode(id, {
        nodeType: NodeType.CLUSTER,
        label,
        size,
        centroid,
        createdAt: now
      });
    }

    this.isDirty = true;
    return id;
  }

  /**
   * Get cluster by ID
   * 
   * @param {string} clusterId - Cluster ID
   * @returns {Object|null} Cluster data or null if not found
   */
  getCluster(clusterId) {
    if (!this.graph.hasNode(clusterId)) {
      return null;
    }

    const attrs = this.graph.getNodeAttributes(clusterId);
    if (attrs.nodeType !== NodeType.CLUSTER) {
      return null;
    }

    return {
      id: clusterId,
      ...attrs
    };
  }

  /**
   * List all cluster nodes
   * @returns {Array<Object>} All clusters sorted by size descending
   */
  getAllClusters() {
    const clusters = [];
    this.graph.forEachNode((nodeId, attrs) => {
      if (attrs.nodeType === NodeType.CLUSTER) {
        clusters.push({
          id: nodeId,
          label: attrs.label || "Unlabeled cluster",
          size: attrs.size || 0,
          createdAt: attrs.createdAt
        });
      }
    });
    clusters.sort((a, b) => b.size - a.size);
    return clusters;
  }

  // ============================================================================
  // CONCEPT ASSOCIATION OPERATIONS
  // ============================================================================

  /**
   * Calculate association strength based on co-occurrence and recency
   * 
   * Formula: (log(1 + co_occurrences) / log(1 + max_co_occurrences)) * recency_factor
   * Recency factor: exp(-0.01 * days_since_reinforcement)
   * 
   * @param {number} coOccurrences - Number of co-occurrences
   * @param {string} lastReinforced - ISO timestamp of last reinforcement
   * @returns {number} Association strength (0-1)
   */
  calculateAssociationStrength(coOccurrences, lastReinforced) {
    // Find max co-occurrences across all concept associations
    let maxCoOccurrences = 1;
    this.graph.forEachEdge((edge, attrs) => {
      if (attrs.edgeType === EdgeType.CONCEPT_ASSOCIATION) {
        maxCoOccurrences = Math.max(maxCoOccurrences, attrs.coOccurrences);
      }
    });

    // Calculate co-occurrence score
    const coOccurrenceScore = Math.log(1 + coOccurrences) / Math.log(1 + maxCoOccurrences);

    // Calculate recency factor
    const now = new Date();
    const lastReinforcedDate = new Date(lastReinforced);
    const daysSinceReinforcement = (now - lastReinforcedDate) / (24 * 60 * 60 * 1000);
    const recencyFactor = Math.exp(-0.01 * daysSinceReinforcement);

    // Calculate final strength
    const strength = coOccurrenceScore * recencyFactor;

    return Math.min(Math.max(strength, 0), 1); // Clamp to [0, 1]
  }

  /**
   * Create or update a bidirectional association between concepts
   * 
   * Association strength is automatically calculated based on co-occurrence count
   * and recency of reinforcement.
   * 
   * @param {string} conceptId1 - First concept ID
   * @param {string} conceptId2 - Second concept ID
   * @returns {boolean} Success status
   */
  addConceptAssociation(conceptId1, conceptId2) {
    if (!this.graph.hasNode(conceptId1) || !this.graph.hasNode(conceptId2)) {
      return false;
    }

    const now = new Date().toISOString();

    // Check if edge exists
    if (this.graph.hasEdge(conceptId1, conceptId2)) {
      // Update existing association
      const attrs = this.graph.getEdgeAttributes(conceptId1, conceptId2);
      const newCoOccurrences = attrs.coOccurrences + 1;
      const newStrength = this.calculateAssociationStrength(newCoOccurrences, now);
      
      this.graph.mergeEdgeAttributes(conceptId1, conceptId2, {
        strength: newStrength,
        coOccurrences: newCoOccurrences,
        lastReinforced: now
      });
    } else {
      // Create new bidirectional association
      const initialStrength = this.calculateAssociationStrength(1, now);
      
      this.graph.addEdge(conceptId1, conceptId2, {
        edgeType: EdgeType.CONCEPT_ASSOCIATION,
        strength: initialStrength,
        coOccurrences: 1,
        lastReinforced: now
      });
    }

    this.isDirty = true;
    return true;
  }

  /**
   * Get association between two concepts
   * 
   * @param {string} conceptId1 - First concept ID
   * @param {string} conceptId2 - Second concept ID
   * @returns {Object|null} Association data or null if not found
   */
  getConceptAssociation(conceptId1, conceptId2) {
    // For undirected edges, check if edge exists (should work in both directions)
    // But we need to handle the case where the edge was created in the opposite direction
    const hasEdge = this.graph.hasEdge(conceptId1, conceptId2) || this.graph.hasEdge(conceptId2, conceptId1);
    
    if (!hasEdge) {
      return null;
    }

    // Try to get edge attributes - for undirected edges, try both directions
    let attrs;
    try {
      attrs = this.graph.getEdgeAttributes(conceptId1, conceptId2);
    } catch (e) {
      try {
        attrs = this.graph.getEdgeAttributes(conceptId2, conceptId1);
      } catch (e2) {
        return null;
      }
    }

    if (attrs.edgeType !== EdgeType.CONCEPT_ASSOCIATION) {
      return null;
    }

    return {
      from: conceptId1,
      to: conceptId2,
      ...attrs
    };
  }

  /**
   * Get all associations for a concept
   * 
   * @param {string} conceptId - Concept ID
   * @returns {Array<Object>} Array of associations
   */
  getConceptAssociations(conceptId) {
    if (!this.graph.hasNode(conceptId)) {
      return [];
    }

    const associations = [];
    this.graph.forEachEdge(conceptId, (edge, attrs, source, target) => {
      if (attrs.edgeType === EdgeType.CONCEPT_ASSOCIATION) {
        associations.push({
          from: source,
          to: target,
          ...attrs
        });
      }
    });

    return associations;
  }

  /**
   * Recalculate all association strengths
   * 
   * This should be called periodically to apply recency decay to all associations.
   * Associations below the threshold (0.3) will be removed.
   * 
   * @param {number} threshold - Minimum strength threshold (default: 0.3)
   * @returns {number} Number of associations removed
   */
  recalculateAssociationStrengths(threshold = 0.3) {
    const edgesToRemove = [];

    this.graph.forEachEdge((edge, attrs, source, target) => {
      if (attrs.edgeType === EdgeType.CONCEPT_ASSOCIATION) {
        // Recalculate strength with current recency
        const newStrength = this.calculateAssociationStrength(
          attrs.coOccurrences,
          attrs.lastReinforced
        );

        if (newStrength < threshold) {
          // Mark for removal
          edgesToRemove.push({ source, target });
        } else {
          // Update strength
          this.graph.setEdgeAttribute(source, target, 'strength', newStrength);
        }
      }
    });

    // Remove weak associations
    edgesToRemove.forEach(({ source, target }) => {
      this.graph.dropEdge(source, target);
    });

    if (edgesToRemove.length > 0) {
      this.isDirty = true;
    }

    return edgesToRemove.length;
  }

  /**
   * Get associated concepts within N hops
   * 
   * @param {string} conceptId - Starting concept ID
   * @param {number} maxHops - Maximum number of hops (default: 2)
   * @param {number} minStrength - Minimum association strength (default: 0.3)
   * @returns {Array<Object>} Array of associated concepts with hop distance
   */
  getAssociatedConcepts(conceptId, maxHops = 2, minStrength = 0.3) {
    if (!this.graph.hasNode(conceptId)) {
      return [];
    }

    const visited = new Set();
    const results = [];
    const queue = [{ id: conceptId, hops: 0 }];

    while (queue.length > 0) {
      const { id, hops } = queue.shift();

      if (visited.has(id)) {
        continue;
      }
      visited.add(id);

      if (hops > 0 && hops <= maxHops) {
        const concept = this.getConcept(id);
        if (concept) {
          results.push({ ...concept, hops });
        }
      }

      if (hops < maxHops) {
        // Add neighbors to queue
        this.graph.forEachNeighbor(id, (neighbor) => {
          // Get edge attributes - try both directions for undirected edges
          let edgeAttrs;
          try {
            edgeAttrs = this.graph.getEdgeAttributes(id, neighbor);
          } catch (e) {
            try {
              edgeAttrs = this.graph.getEdgeAttributes(neighbor, id);
            } catch (e2) {
              return; // Skip if edge not found
            }
          }
          
          if (edgeAttrs.edgeType === EdgeType.CONCEPT_ASSOCIATION &&
              edgeAttrs.strength >= minStrength &&
              !visited.has(neighbor)) {
            queue.push({ id: neighbor, hops: hops + 1 });
          }
        });
      }
    }

    return results;
  }

  // ============================================================================
  // MEMORY-CONCEPT LINK OPERATIONS
  // ============================================================================

  /**
   * Link a memory to a concept
   * 
   * @param {string} memoryNodeId - Memory node ID
   * @param {string} conceptId - Concept ID
   * @param {number} relevance - Relevance score (0-1)
   * @returns {boolean} Success status
   */
  linkMemoryToConcept(memoryNodeId, conceptId, relevance = 1.0) {
    if (!this.graph.hasNode(memoryNodeId) || !this.graph.hasNode(conceptId)) {
      return false;
    }

    // Create directed edge from memory to concept
    if (!this.graph.hasDirectedEdge(memoryNodeId, conceptId)) {
      this.graph.addDirectedEdge(memoryNodeId, conceptId, {
        edgeType: EdgeType.MEMORY_CONCEPT_LINK,
        relevance
      });
      this.isDirty = true;
    }

    return true;
  }

  /**
   * Get concepts linked to a memory
   * 
   * @param {string} memoryNodeId - Memory node ID
   * @returns {Array<Object>} Array of concepts with relevance scores
   */
  getMemoryConcepts(memoryNodeId) {
    if (!this.graph.hasNode(memoryNodeId)) {
      return [];
    }

    const concepts = [];
    this.graph.forEachOutEdge(memoryNodeId, (edge, attrs, source, target) => {
      if (attrs.edgeType === EdgeType.MEMORY_CONCEPT_LINK) {
        const concept = this.getConcept(target);
        if (concept) {
          concepts.push({
            ...concept,
            relevance: attrs.relevance
          });
        }
      }
    });

    return concepts;
  }

  /**
   * Get memories linked to a concept
   * 
   * @param {string} conceptId - Concept ID
   * @returns {Array<Object>} Array of memory nodes with relevance scores
   */
  getConceptMemories(conceptId) {
    if (!this.graph.hasNode(conceptId)) {
      return [];
    }

    const memories = [];
    this.graph.forEachInEdge(conceptId, (edge, attrs, source, target) => {
      if (attrs.edgeType === EdgeType.MEMORY_CONCEPT_LINK) {
        const memory = this.getMemory(source);
        if (memory) {
          memories.push({
            ...memory,
            relevance: attrs.relevance
          });
        }
      }
    });

    return memories;
  }

  // ============================================================================
  // CLUSTER MEMBERSHIP OPERATIONS
  // ============================================================================

  /**
   * Add memory to cluster
   * 
   * @param {string} memoryNodeId - Memory node ID
   * @param {string} clusterId - Cluster ID
   * @param {number} distance - Distance from centroid
   * @returns {boolean} Success status
   */
  addClusterMembership(memoryNodeId, clusterId, distance = 0) {
    if (!this.graph.hasNode(memoryNodeId) || !this.graph.hasNode(clusterId)) {
      return false;
    }

    if (!this.graph.hasDirectedEdge(memoryNodeId, clusterId)) {
      this.graph.addDirectedEdge(memoryNodeId, clusterId, {
        edgeType: EdgeType.CLUSTER_MEMBERSHIP,
        distance
      });
      this.isDirty = true;
    }

    return true;
  }

  /**
   * Get cluster members
   * 
   * @param {string} clusterId - Cluster ID
   * @returns {Array<Object>} Array of memory nodes with distances
   */
  getClusterMembers(clusterId) {
    if (!this.graph.hasNode(clusterId)) {
      return [];
    }

    const members = [];
    this.graph.forEachInEdge(clusterId, (edge, attrs, source, target) => {
      if (attrs.edgeType === EdgeType.CLUSTER_MEMBERSHIP) {
        const memory = this.getMemory(source);
        if (memory) {
          members.push({
            ...memory,
            distance: attrs.distance
          });
        }
      }
    });

    return members;
  }

  // ============================================================================
  // CROSS-CLUSTER LINK OPERATIONS
  // ============================================================================

  /**
   * Create link between clusters
   * 
   * @param {string} clusterId1 - First cluster ID
   * @param {string} clusterId2 - Second cluster ID
   * @param {number} similarity - Similarity score (0-1)
   * @returns {boolean} Success status
   */
  addCrossClusterLink(clusterId1, clusterId2, similarity) {
    if (!this.graph.hasNode(clusterId1) || !this.graph.hasNode(clusterId2)) {
      return false;
    }

    if (!this.graph.hasEdge(clusterId1, clusterId2)) {
      this.graph.addEdge(clusterId1, clusterId2, {
        edgeType: EdgeType.CROSS_CLUSTER_LINK,
        similarity
      });
      this.isDirty = true;
    }

    return true;
  }

  /**
   * Get related clusters
   * 
   * @param {string} clusterId - Cluster ID
   * @param {number} minSimilarity - Minimum similarity threshold
   * @returns {Array<Object>} Array of related clusters
   */
  getRelatedClusters(clusterId, minSimilarity = 0.5) {
    if (!this.graph.hasNode(clusterId)) {
      return [];
    }

    const related = [];
    this.graph.forEachEdge(clusterId, (edge, attrs, source, target) => {
      if (attrs.edgeType === EdgeType.CROSS_CLUSTER_LINK &&
          attrs.similarity >= minSimilarity) {
        const otherClusterId = source === clusterId ? target : source;
        const cluster = this.getCluster(otherClusterId);
        if (cluster) {
          related.push({
            ...cluster,
            similarity: attrs.similarity
          });
        }
      }
    });

    return related;
  }

  // ============================================================================
  // GRAPH STATISTICS
  // ============================================================================

  /**
   * Get graph statistics
   * 
   * @returns {Object} Statistics about the graph
   */
  getStats() {
    const stats = {
      totalNodes: this.graph.order,
      totalEdges: this.graph.size,
      concepts: 0,
      memories: 0,
      clusters: 0,
      conceptAssociations: 0,
      memoryConceptLinks: 0,
      clusterMemberships: 0,
      crossClusterLinks: 0
    };

    // Count nodes by type
    this.graph.forEachNode((node, attrs) => {
      if (attrs.nodeType === NodeType.CONCEPT) stats.concepts++;
      else if (attrs.nodeType === NodeType.MEMORY) stats.memories++;
      else if (attrs.nodeType === NodeType.CLUSTER) stats.clusters++;
    });

    // Count edges by type
    this.graph.forEachEdge((edge, attrs) => {
      if (attrs.edgeType === EdgeType.CONCEPT_ASSOCIATION) stats.conceptAssociations++;
      else if (attrs.edgeType === EdgeType.MEMORY_CONCEPT_LINK) stats.memoryConceptLinks++;
      else if (attrs.edgeType === EdgeType.CLUSTER_MEMBERSHIP) stats.clusterMemberships++;
      else if (attrs.edgeType === EdgeType.CROSS_CLUSTER_LINK) stats.crossClusterLinks++;
    });

    return stats;
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  /**
   * Save graph to disk
   */
  async save() {
    try {
      const data = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        graph: this.graph.export()
      };

      const dir = path.dirname(this.persistPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2));
      
      this.isDirty = false;
      console.log(`Knowledge graph saved to ${this.persistPath}`);
    } catch (error) {
      console.error('Failed to save knowledge graph:', error);
      throw error;
    }
  }

  /**
   * Load graph from disk
   */
  async load() {
    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const data = JSON.parse(content);
      
      this.graph = Graph.from(data.graph);
      this.isDirty = false;
      
      console.log(`Knowledge graph loaded from ${this.persistPath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Knowledge graph file not found');
      }
      console.error('Failed to load knowledge graph:', error);
      throw error;
    }
  }

  /**
   * Clear all data from graph
   */
  clear() {
    this.graph.clear();
    this.isDirty = true;
  }

  /**
   * Export graph as nodes/edges for visualization (vis.js, etc.)
   * Modes:
   *   full     – concepts + memories + clusters (old default)
   *   journey  – memories + session-sequence path + satellite concepts
   *   domains  – domain hubs + memories + high-freq concepts
   *   topics   – concepts only (filtered by minConceptFreq), memories as small anchors
   *
   * @param {Object} options
   * @param {number} options.maxNodes - Max nodes to include
   * @param {boolean} options.includeMemories - Include memory nodes
   * @returns {{ nodes: Array, edges: Array, truncated: boolean }}
   */
  getVisualizationData(options = {}) {
    const {
      maxNodes       = 400,
      includeMemories = true,
      memoryFilter   = null,  // Set of numeric SQLite memory IDs (null = all)
      mode           = "full", // "full" | "journey" | "domains" | "topics"
      minConceptFreq = 1       // only show concepts seen in >= N pages
    } = options;

    // ── Pass 1: collect raw node metadata ────────────────────────────────────
    const allNodes = new Map(); // nodeId → meta
    this.graph.forEachNode((nodeId, attrs) => {
      let label = nodeId;
      if      (attrs.nodeType === NodeType.CONCEPT) label = attrs.name || nodeId;
      else if (attrs.nodeType === NodeType.CLUSTER) label = attrs.label || "Cluster";
      else if (attrs.nodeType === NodeType.MEMORY)  label = `Memory #${attrs.memoryId || "?"}`;
      else if (attrs.nodeType === NodeType.DOMAIN)  label = attrs.domain || nodeId;

      allNodes.set(nodeId, {
        id:             nodeId,
        type:           attrs.nodeType,
        label,
        memoryId:       attrs.memoryId,
        domain:         attrs.domain,
        sessionId:      attrs.sessionId,
        timestamp:      attrs.timestamp,
        occurrenceCount: attrs.occurrenceCount || 1,
        degree:         this.graph.degree(nodeId)
      });
    });

    // ── Pass 2: resolve memory ID filter → graph-node IDs ────────────────────
    let filteredMemNodeIds = null;
    if (memoryFilter !== null) {
      filteredMemNodeIds = new Set();
      allNodes.forEach((n, nodeId) => {
        if (n.type !== NodeType.MEMORY) return;
        const id = n.memoryId;
        if (memoryFilter.has(id) || memoryFilter.has(Number(id)) || memoryFilter.has(String(id)))
          filteredMemNodeIds.add(nodeId);
      });
    }

    // ── Pass 3: resolve which concept nodes pass the frequency filter ─────────
    const conceptPassesFreq = (n) =>
      n.type === NodeType.CONCEPT && n.occurrenceCount >= minConceptFreq;

    // ── Pass 4: bucket nodes by type per mode ────────────────────────────────
    const concepts = [], memories = [], clusters = [], domains = [];

    allNodes.forEach((n) => {
      if (n.type === NodeType.DOMAIN) {
        if (mode === "domains") domains.push(n);
        return;
      }
      if (n.type === NodeType.CLUSTER) {
        if (mode === "full") clusters.push(n);
        return;
      }
      if (n.type === NodeType.CONCEPT) {
        if (mode === "journey") return; // no concepts as top-level in journey
        if (!conceptPassesFreq(n)) return;
        concepts.push(n);
        return;
      }
      if (n.type === NodeType.MEMORY) {
        if (!includeMemories) return;
        if (mode === "topics") return; // no memories in topics view
        if (filteredMemNodeIds !== null && !filteredMemNodeIds.has(n.id)) return;
        memories.push(n);
      }
    });

    // In journey mode, satellite concepts (1 hop from memories)
    let journeyConcepts = [];
    if (mode === "journey") {
      const memSet = new Set(memories.map(n => n.id));
      const seen   = new Set();
      memSet.forEach((memId) => {
        try {
          this.graph.forEachNeighbor(memId, (nId, nAttrs) => {
            if (nAttrs.nodeType === NodeType.CONCEPT && !seen.has(nId) && conceptPassesFreq(allNodes.get(nId) || {})) {
              seen.add(nId);
              journeyConcepts.push(allNodes.get(nId));
            }
          });
        } catch {}
      });
      // Only keep top concepts by occurrence
      journeyConcepts.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
      journeyConcepts = journeyConcepts.slice(0, Math.floor(maxNodes * 0.35));
    }

    // Sort each bucket by degree desc (keep the most-connected first)
    [concepts, memories, domains, journeyConcepts].forEach(arr =>
      arr.sort((a, b) => b.degree - a.degree)
    );
    clusters.sort((a, b) => b.degree - a.degree);

    // Distribute the node budget
    let selected;
    if (mode === "journey") {
      const memBudget = Math.min(memories.length, Math.ceil(maxNodes * 0.55));
      const cncBudget = maxNodes - memBudget;
      selected = [
        ...memories.slice(0, memBudget),
        ...journeyConcepts.slice(0, cncBudget)
      ];
    } else if (mode === "domains") {
      const domBudget = Math.min(domains.length, Math.ceil(maxNodes * 0.1));
      const memBudget = Math.min(memories.length, Math.ceil(maxNodes * 0.45));
      const cncBudget = maxNodes - domBudget - memBudget;
      selected = [
        ...domains.slice(0, domBudget),
        ...memories.slice(0, memBudget),
        ...concepts.slice(0, cncBudget)
      ];
    } else if (mode === "topics") {
      const cncBudget = Math.ceil(maxNodes * 0.85);
      const memBudget = maxNodes - cncBudget;
      selected = [
        ...concepts.slice(0, cncBudget),
        ...memories.slice(0, memBudget)
      ];
    } else { // full
      const memBudget = Math.min(memories.length, Math.ceil(maxNodes * 0.2));
      const clsBudget = Math.min(clusters.length, Math.ceil(maxNodes * 0.05));
      const cncBudget = maxNodes - memBudget - clsBudget;
      selected = [
        ...concepts.slice(0, cncBudget),
        ...memories.slice(0, memBudget),
        ...clusters.slice(0, clsBudget)
      ];
    }

    const truncated  = false; // frontend shows real counts in stats
    const selectedIds = new Set(selected.map(n => n.id));

    // ── Pass 5: build vis-network node objects ────────────────────────────────
    const typeColor = {
      [NodeType.CONCEPT]: { bg: "#4299e1", border: "#2b6cb0" },
      [NodeType.MEMORY]:  { bg: "#48bb78", border: "#276749" },
      [NodeType.CLUSTER]: { bg: "#ed8936", border: "#c05621" },
      [NodeType.DOMAIN]:  { bg: "#9f7aea", border: "#6b46c1" }
    };

    const maxDeg = Math.max(...selected.map(n => n.degree), 1);

    const nodes = selected.map((n) => {
      const norm  = n.degree / maxDeg;
      const tc    = typeColor[n.type] || { bg: "#a0aec0", border: "#718096" };
      const size  =
        n.type === NodeType.DOMAIN   ? 24 + Math.round(norm * 10) :
        n.type === NodeType.MEMORY   ? 14 + Math.round(norm * 14) :
        n.type === NodeType.CLUSTER  ? 18 :
        6  + Math.round(n.occurrenceCount > 1 ? Math.min(n.occurrenceCount, 20) * 1.2 : norm * 14);

      const short = n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label;
      return {
        id:             n.id,
        label:          short,
        group:          n.type,
        title:          `${n.type}: ${n.label}${n.occurrenceCount > 1 ? `\nOccurrences: ${n.occurrenceCount}` : ""}\nDegree: ${n.degree}`,
        memoryId:       n.memoryId,
        domain:         n.domain,
        sessionId:      n.sessionId,
        timestamp:      n.timestamp,
        occurrenceCount: n.occurrenceCount,
        degree:         n.degree,
        color:          { background: tc.bg, border: tc.border },
        size,
        font:           { color: "#e2e8f0", size: 10, strokeWidth: 2, strokeColor: "#0a0e14" }
      };
    });

    // ── Pass 6: build edges, mode-aware, capped ───────────────────────────────
    const edges = [];
    this.graph.forEachEdge((edgeKey, attrs, source, target) => {
      if (!selectedIds.has(source) || !selectedIds.has(target)) return;

      const et       = attrs.edgeType;
      const strength = attrs.strength || attrs.similarity || 0.5;

      // Mode-specific edge inclusion
      if (mode === "journey") {
        if (et === EdgeType.CONCEPT_ASSOCIATION) return;
        if (et === EdgeType.DOMAIN_MEMBERSHIP)   return;
        if (et === EdgeType.CLUSTER_MEMBERSHIP)  return;
      }
      if (mode === "domains") {
        if (et === EdgeType.CONCEPT_ASSOCIATION) return;
        if (et === EdgeType.SESSION_SEQUENCE)    return;
        if (et === EdgeType.CLUSTER_MEMBERSHIP)  return;
      }
      if (mode === "topics") {
        if (et === EdgeType.SESSION_SEQUENCE)    return;
        if (et === EdgeType.DOMAIN_MEMBERSHIP)   return;
        if (et === EdgeType.CLUSTER_MEMBERSHIP)  return;
      }
      if (mode === "full") {
        if (et === EdgeType.SESSION_SEQUENCE)    return; // too noisy in full view
        if (et === EdgeType.DOMAIN_MEMBERSHIP)   return;
      }

      let color, width, priority, arrows;
      if (et === EdgeType.CONCEPT_ASSOCIATION) {
        color = { color: "#4299e1", opacity: 0.3 }; width = 0.5 + strength * 1.5; priority = 0;
      } else if (et === EdgeType.MEMORY_CONCEPT_LINK) {
        color = { color: "#48bb78", opacity: 0.7 }; width = 1.5; priority = 2;
        arrows = { to: { enabled: true, scaleFactor: 0.4 } };
      } else if (et === EdgeType.SESSION_SEQUENCE) {
        color = { color: "#f6ad55", opacity: 0.9 }; width = 2.5; priority = 3;
        arrows = { to: { enabled: true, scaleFactor: 0.6 } };
      } else if (et === EdgeType.DOMAIN_MEMBERSHIP) {
        color = { color: "#9f7aea", opacity: 0.6 }; width = 1.2; priority = 2;
      } else if (et === EdgeType.CLUSTER_MEMBERSHIP) {
        color = { color: "#ed8936", opacity: 0.65 }; width = 1; priority = 1;
      } else {
        color = { color: "#ed8936", opacity: 0.4 }; width = 1.5; priority = 1;
      }

      edges.push({ id: edgeKey, from: source, to: target, color, width, arrows, _s: strength, _p: priority });
    });

    const MAX_EDGES = mode === "journey" ? 600 : mode === "domains" ? 500 : 800;
    if (edges.length > MAX_EDGES) {
      edges.sort((a, b) => b._p - a._p || b._s - a._s);
      edges.splice(MAX_EDGES);
    }
    edges.forEach(e => { delete e._s; delete e._p; });

    return { nodes, edges, truncated, totalNodes: allNodes.size };
  }
}

module.exports = {
  KnowledgeGraph,
  NodeType,
  EdgeType
};
