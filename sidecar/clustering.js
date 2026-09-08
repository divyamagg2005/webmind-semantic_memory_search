/**
 * Automatic Clustering System
 * 
 * Implements memory clustering based on embedding similarity using HDBSCAN.
 * Calls Python HDBSCAN script for actual clustering computation.
 * Generates cluster labels using LLM and detects cross-cluster associations.
 * 
 * Requirements: 21.1-21.6, 22.1-22.6, 23.1-23.4
 */

const { generateText } = require('./model-provider');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Default clustering parameters
 */
const DEFAULT_PARAMS = {
  minClusterSize: 3,
  minSamples: 2,
  crossClusterThreshold: 0.5,
  maxLabelWords: 5
};

/**
 * Calculate cosine similarity between two vectors
 * 
 * @param {Array<number>} vec1 - First vector
 * @param {Array<number>} vec2 - Second vector
 * @returns {number} Cosine similarity (0-1)
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
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
 * Calculate centroid of a set of vectors
 * 
 * Requirement 21.4: Calculate cluster centroids
 * 
 * @param {Array<Array<number>>} vectors - Array of embedding vectors
 * @returns {Array<number>} Centroid vector
 */
function calculateCentroid(vectors) {
  if (!vectors || vectors.length === 0) {
    return [];
  }

  const dimensions = vectors[0].length;
  const centroid = new Array(dimensions).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += vector[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= vectors.length;
  }

  return centroid;
}

/**
 * Perform HDBSCAN clustering using Python script
 * 
 * This is a simplified clustering approach inspired by HDBSCAN:
 * 1. Calculate pairwise similarities
 * 2. Group memories with high mutual similarity
 * 3. Filter clusters by minimum size
 * 
 * Requirements:
 * - 21.1: Implement clustering analysis on memory embeddings
 * - 21.2: Use HDBSCAN with minimum cluster size of 3
 * 
 * @param {Array<Object>} memories - Memories with embeddings
 * @param {Object} params - Clustering parameters
 * @returns {Promise<Array<Object>>} Clusters with member IDs
 */
async function clusterMemoriesWithHDBSCAN(memories, params = {}) {
  const {
    minClusterSize = DEFAULT_PARAMS.minClusterSize,
    minSamples = DEFAULT_PARAMS.minSamples
  } = params;

  if (!memories || memories.length < minClusterSize) {
    return [];
  }

  // Extract embeddings
  const embeddings = memories.map(m => m.embedding);

  // Prepare input for Python script
  const input = JSON.stringify({
    embeddings,
    min_cluster_size: minClusterSize,
    min_samples: minSamples
  });

  try {
    // Call Python HDBSCAN script
    const result = await callPythonHDBSCAN(input);

    if (!result.success) {
      console.warn('HDBSCAN failed, falling back to simple clustering:', result.error);
      // Fallback to simple similarity-based clustering
      return clusterMemories(memories, { minClusterSize, similarityThreshold: 0.7 });
    }

    // Convert labels to clusters
    const clusterMap = new Map();
    
    result.labels.forEach((label, index) => {
      // Skip noise points (label = -1)
      if (label === -1) return;
      
      if (!clusterMap.has(label)) {
        clusterMap.set(label, []);
      }
      clusterMap.get(label).push(index);
    });

    // Build cluster objects
    const clusters = [];
    let clusterIndex = 0;

    for (const [label, memberIndices] of clusterMap.entries()) {
      // Only keep clusters meeting minimum size
      if (memberIndices.length >= minClusterSize) {
        const members = memberIndices.map(idx => memories[idx]);
        const embeddings = members.map(m => m.embedding);
        const centroid = calculateCentroid(embeddings);

        clusters.push({
          id: `cluster_${Date.now()}_${clusterIndex}`,
          memberIds: members.map(m => m.memoryId),
          size: members.length,
          centroid,
          members,
          hdbscanLabel: label
        });

        clusterIndex++;
      }
    }

    return clusters;

  } catch (error) {
    console.error('HDBSCAN clustering failed:', error);
    // Fallback to simple clustering
    return clusterMemories(memories, { minClusterSize, similarityThreshold: 0.7 });
  }
}

/**
 * Call Python HDBSCAN script
 * 
 * @param {string} input - JSON input for Python script
 * @returns {Promise<Object>} Clustering result
 */
function callPythonHDBSCAN(input) {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'hdbscan_cluster.py');
    
    // Try python3 first, then python
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    
    const python = spawn(pythonCommand, [pythonScript]);
    
    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${error.message}`));
      }
    });

    python.on('error', (error) => {
      reject(new Error(`Failed to spawn Python process: ${error.message}`));
    });

    // Send input to Python script
    python.stdin.write(input);
    python.stdin.end();
  });
}

/**
 * Perform density-based clustering on embeddings (fallback)
 * 
 * This is a simplified clustering approach for when HDBSCAN is not available.
 * 
 * @param {Array<Object>} memories - Memories with embeddings
 * @param {Object} params - Clustering parameters
 * @returns {Array<Object>} Clusters with member IDs
 */
function clusterMemories(memories, params = {}) {
  const {
    minClusterSize = DEFAULT_PARAMS.minClusterSize,
    similarityThreshold = 0.7
  } = params;

  if (!memories || memories.length < minClusterSize) {
    return [];
  }

  // Build similarity matrix
  const n = memories.length;
  const similarities = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(
        memories[i].embedding,
        memories[j].embedding
      );
      similarities[i][j] = sim;
      similarities[j][i] = sim;
    }
    similarities[i][i] = 1.0;
  }

  // Find clusters using connected components approach
  const visited = new Array(n).fill(false);
  const clusters = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;

    // Start new cluster
    const cluster = [];
    const queue = [i];
    visited[i] = true;

    while (queue.length > 0) {
      const current = queue.shift();
      cluster.push(current);

      // Add similar neighbors
      for (let j = 0; j < n; j++) {
        if (!visited[j] && similarities[current][j] >= similarityThreshold) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }

    // Only keep clusters meeting minimum size
    if (cluster.length >= minClusterSize) {
      clusters.push(cluster);
    }
  }

  // Convert to cluster objects
  return clusters.map((memberIndices, clusterIndex) => {
    const members = memberIndices.map(idx => memories[idx]);
    const embeddings = members.map(m => m.embedding);
    const centroid = calculateCentroid(embeddings);

    return {
      id: `cluster_${Date.now()}_${clusterIndex}`,
      memberIds: members.map(m => m.memoryId),
      size: members.length,
      centroid,
      members
    };
  });
}

/**
 * Extract top concepts from cluster members
 * 
 * Requirement 22.1: Extract top 10 concepts from cluster members
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {Array<number>} memberIds - Memory IDs in cluster
 * @param {number} topN - Number of top concepts to extract
 * @returns {Array<string>} Top concept names
 */
function extractClusterConcepts(knowledgeGraph, memberIds, topN = 10) {
  const conceptCounts = new Map();

  for (const memoryId of memberIds) {
    const memoryNodeId = `memory_${memoryId}`;
    
    // Get concepts linked to this memory
    const concepts = knowledgeGraph.getMemoryConcepts(memoryNodeId);
    
    for (const concept of concepts) {
      const count = conceptCounts.get(concept.name) || 0;
      conceptCounts.set(concept.name, count + 1);
    }
  }

  // Sort by frequency and return top N
  return Array.from(conceptCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name]) => name);
}

/**
 * Generate cluster label using LLM
 * 
 * Requirements:
 * - 22.2: Send concepts to Ollama for label generation
 * - 22.3: Limit labels to 5 words
 * 
 * @param {Array<string>} concepts - Top concepts from cluster
 * @param {Object} options - Generation options
 * @returns {Promise<string>} Generated label (max 5 words)
 */
async function generateClusterLabel(concepts, options = {}) {
  const {
    model = null, // null -> model provider picks the configured local/cloud model
    maxWords = DEFAULT_PARAMS.maxLabelWords
  } = options;

  if (!concepts || concepts.length === 0) {
    return 'Uncategorized Cluster';
  }

  try {
    const prompt = `Given these concepts from a group of related web pages: ${concepts.join(', ')}

Generate a concise label (maximum ${maxWords} words) that describes the main theme or topic of this group.

The label should be:
- Clear and descriptive
- Maximum ${maxWords} words
- Suitable as a category name
- No quotes or special formatting

Label:`;

    // Label generation runs through the model provider — local Ollama LLaMA
    // or the AWS LLaMA endpoint, depending on the cloud_llama_enabled switch.
    const raw = await generateText({
      prompt,
      system: 'Reply with only the label text — no preamble, quotes, or explanation.',
      model,
      temperature: 0.7,
      maxTokens: 20
    });

    // Extract and clean the label
    let label = raw.trim();
    
    // Remove quotes if present
    label = label.replace(/^["']|["']$/g, '');
    
    // Limit to max words
    const words = label.split(/\s+/);
    if (words.length > maxWords) {
      label = words.slice(0, maxWords).join(' ');
    }

    return label || concepts.slice(0, 3).join(', ');

  } catch (error) {
    console.error('Failed to generate cluster label:', error);
    // Fallback to concept-based label
    return concepts.slice(0, 3).join(', ');
  }
}

/**
 * Store cluster in knowledge graph
 * 
 * Requirement 22.4: Store labels in knowledge graph
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {Object} cluster - Cluster object
 * @param {string} label - Cluster label
 * @returns {string} Cluster ID
 */
function storeCluster(knowledgeGraph, cluster, label) {
  // Add cluster node
  const clusterId = knowledgeGraph.addCluster({
    id: cluster.id,
    label,
    size: cluster.size,
    centroid: cluster.centroid
  });

  // Add cluster membership edges
  for (const memoryId of cluster.memberIds) {
    const memoryNodeId = `memory_${memoryId}`;
    
    // Calculate distance from centroid (for reference)
    const distance = 0; // Could calculate actual distance if needed
    
    knowledgeGraph.addClusterMembership(memoryNodeId, clusterId, distance);
  }

  return clusterId;
}

/**
 * Calculate similarity between cluster centroids
 * 
 * Requirement 23.1: Calculate similarity between cluster centroids
 * 
 * @param {Array<number>} centroid1 - First cluster centroid
 * @param {Array<number>} centroid2 - Second cluster centroid
 * @returns {number} Similarity score (0-1)
 */
function calculateClusterSimilarity(centroid1, centroid2) {
  return cosineSimilarity(centroid1, centroid2);
}

/**
 * Detect and create cross-cluster associations
 * 
 * Requirements:
 * - 23.2: Create cross-cluster associations when similarity > 0.5
 * - 23.3: Store associations in knowledge graph
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {Array<Object>} clusters - Array of clusters with centroids
 * @param {number} threshold - Minimum similarity threshold
 * @returns {Array<Object>} Created associations
 */
function detectCrossClusterAssociations(knowledgeGraph, clusters, threshold = 0.5) {
  const associations = [];

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const similarity = calculateClusterSimilarity(
        clusters[i].centroid,
        clusters[j].centroid
      );

      if (similarity >= threshold) {
        // Create cross-cluster link
        const success = knowledgeGraph.addCrossClusterLink(
          clusters[i].id,
          clusters[j].id,
          similarity
        );

        if (success) {
          associations.push({
            cluster1: clusters[i].id,
            cluster2: clusters[j].id,
            similarity
          });
        }
      }
    }
  }

  return associations;
}

/**
 * Get related clusters for a given cluster
 * 
 * Requirement 23.4: Support cluster relationship queries
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {string} clusterId - Cluster ID
 * @param {number} minSimilarity - Minimum similarity threshold
 * @returns {Array<Object>} Related clusters
 */
function getRelatedClusters(knowledgeGraph, clusterId, minSimilarity = 0.5) {
  return knowledgeGraph.getRelatedClusters(clusterId, minSimilarity);
}

/**
 * Perform complete clustering analysis
 * 
 * This is the main entry point for clustering.
 * 
 * @param {Object} params - Clustering parameters
 * @param {Object} params.lanceTable - LanceDB table with embeddings
 * @param {Object} params.knowledgeGraph - Knowledge graph instance
 * @param {Object} params.db - SQLite database instance
 * @param {Object} params.options - Clustering options
 * @returns {Promise<Object>} Clustering results
 */
async function performClustering(params) {
  const {
    lanceTable,
    knowledgeGraph,
    db,
    options = {}
  } = params;

  const {
    minClusterSize = DEFAULT_PARAMS.minClusterSize,
    similarityThreshold = DEFAULT_PARAMS.similarityThreshold,
    crossClusterThreshold = DEFAULT_PARAMS.crossClusterThreshold,
    limit = 1000
  } = options;

  try {
    // Fetch all memory embeddings from LanceDB
    const allEmbeddings = await lanceTable
      .search(Array(768).fill(0))
      .limit(limit)
      .toArray();

    if (allEmbeddings.length < minClusterSize) {
      return {
        clustersCreated: 0,
        memoriesClustered: 0,
        crossClusterLinks: 0,
        message: 'Not enough memories for clustering'
      };
    }

    // Prepare memories with embeddings
    const memories = allEmbeddings.map(item => ({
      memoryId: item.memory_id,
      embedding: item.vector,
      title: item.title,
      url: item.url
    }));

    // Perform clustering (try HDBSCAN first, fallback to simple clustering)
    const clusters = await clusterMemoriesWithHDBSCAN(memories, {
      minClusterSize,
      minSamples: options.minSamples || DEFAULT_PARAMS.minSamples
    });

    if (clusters.length === 0) {
      return {
        clustersCreated: 0,
        memoriesClustered: 0,
        crossClusterLinks: 0,
        message: 'No clusters found with current parameters'
      };
    }

    // Generate labels and store clusters
    const storedClusters = [];
    for (const cluster of clusters) {
      // Extract concepts
      const concepts = extractClusterConcepts(
        knowledgeGraph,
        cluster.memberIds,
        10
      );

      // Generate label
      const label = await generateClusterLabel(concepts, options);

      // Store in knowledge graph
      const clusterId = storeCluster(knowledgeGraph, cluster, label);

      storedClusters.push({
        id: clusterId,
        label,
        size: cluster.size,
        centroid: cluster.centroid
      });
    }

    // Detect cross-cluster associations
    const crossClusterLinks = detectCrossClusterAssociations(
      knowledgeGraph,
      storedClusters,
      crossClusterThreshold
    );

    const totalMemoriesClustered = clusters.reduce((sum, c) => sum + c.size, 0);

    return {
      clustersCreated: clusters.length,
      memoriesClustered: totalMemoriesClustered,
      crossClusterLinks: crossClusterLinks.length,
      clusters: storedClusters.map(c => ({
        id: c.id,
        label: c.label,
        size: c.size
      }))
    };

  } catch (error) {
    console.error('Clustering failed:', error);
    throw error;
  }
}

/**
 * Check if clustering should be triggered
 * 
 * Requirement 21.6: Trigger reclustering after 50 new memories
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} threshold - Number of new memories to trigger clustering
 * @returns {Promise<boolean>} True if clustering should run
 */
async function shouldTriggerClustering(db, threshold = 50) {
  return new Promise((resolve, reject) => {
    // Get count of memories not in any cluster
    db.get(
      `SELECT COUNT(*) as count FROM memories 
       WHERE id NOT IN (
         SELECT memory_id FROM cluster_memberships
       )`,
      (err, row) => {
        if (err) {
          // If table doesn't exist, assume we should cluster
          resolve(true);
        } else {
          resolve(row.count >= threshold);
        }
      }
    );
  });
}

/**
 * Update cluster label
 * 
 * Requirement 22.6: Support user renaming of labels
 * 
 * @param {Object} knowledgeGraph - Knowledge graph instance
 * @param {string} clusterId - Cluster ID
 * @param {string} newLabel - New label
 * @returns {boolean} Success status
 */
function updateClusterLabel(knowledgeGraph, clusterId, newLabel) {
  const cluster = knowledgeGraph.getCluster(clusterId);
  
  if (!cluster) {
    return false;
  }

  // Update cluster with new label
  knowledgeGraph.addCluster({
    id: clusterId,
    label: newLabel,
    size: cluster.size,
    centroid: cluster.centroid
  });

  return true;
}

module.exports = {
  cosineSimilarity,
  calculateCentroid,
  clusterMemories,
  clusterMemoriesWithHDBSCAN,
  callPythonHDBSCAN,
  extractClusterConcepts,
  generateClusterLabel,
  storeCluster,
  calculateClusterSimilarity,
  detectCrossClusterAssociations,
  getRelatedClusters,
  performClustering,
  shouldTriggerClustering,
  updateClusterLabel,
  DEFAULT_PARAMS
};
