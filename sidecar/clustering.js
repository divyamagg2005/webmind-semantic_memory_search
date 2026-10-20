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
    minSamples = DEFAULT_PARAMS.minSamples,
    similarityThreshold = DEFAULT_PARAMS.similarityThreshold
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
      return clusterMemories(memories, { minClusterSize, similarityThreshold });
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

    // Guard against a broken pipe: if the Python script exits immediately
    // (e.g. hdbscan not installed), writing to stdin raises EPIPE. Without a
    // listener this becomes an uncaught 'error' event and crashes the server.
    // Reject instead so the caller falls back to the built-in clustering.
    python.stdin.on('error', (error) => {
      reject(new Error(`Failed to write to Python process: ${error.message}`));
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
// Known acronyms that should stay uppercase in labels.
const ACRONYMS = new Set(['ai', 'ml', 'api', 'css', 'html', 'ui', 'ux', 'sql', 'llm', 'gpu', 'cpu', 'os', 'ios']);

// Low-signal tokens that make poor category names.
const FILLER_WORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'you', 'this', 'that', 'these', 'those',
  'here', 'there', 'from', 'into', 'about', 'also', 'just', 'very', 'really',
  'actually', 'basically', 'instead', 'forget', 'skip', 'custom', 'more', 'less',
  'how', 'what', 'when', 'why', 'use', 'using', 'get', 'got', 'make', 'need',
  'want', 'like', 'good', 'best', 'new', 'dure'
]);

function titleCaseConcept(name) {
  return String(name)
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w === w.toUpperCase() && w.length <= 3
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(' ');
}

// Keep a concept only if it's a known acronym or a real word (>= 4 chars),
// and not a filler/function word.
function isUsefulConcept(name) {
  const lower = String(name).toLowerCase().trim();
  if (!lower) return false;
  if (FILLER_WORDS.has(lower)) return false;
  if (ACRONYMS.has(lower)) return true;
  return lower.replace(/[^a-z]/g, '').length >= 4;
}

/**
 * Build a human-readable, descriptive label without an LLM.
 * Joins the top concepts (title-cased, "&" before the last) and, when one
 * source domain dominates the cluster, appends it as context.
 *
 * @param {Array<string>} concepts - Top concepts from cluster
 * @param {Array<Object>} members - Cluster member memories (with .url)
 * @returns {string}
 */
function buildDescriptiveLabel(concepts, members = []) {
  const seen = new Set();
  const useful = (concepts || []).filter(isUsefulConcept);
  // Fall back to the raw list if filtering removed everything.
  const source = useful.length > 0 ? useful : (concepts || []);
  const top = source
    .map(titleCaseConcept)
    .filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()))
    .slice(0, 3);

  if (top.length === 0) return 'Uncategorized Cluster';

  let phrase;
  if (top.length === 1) phrase = top[0];
  else phrase = `${top.slice(0, -1).join(', ')} & ${top[top.length - 1]}`;

  // Append a dominant domain if one accounts for at least half the pages.
  const domainCounts = new Map();
  for (const m of members) {
    try {
      const host = new URL(m.url).hostname.replace(/^www\./, '');
      domainCounts.set(host, (domainCounts.get(host) || 0) + 1);
    } catch {
      /* ignore malformed urls */
    }
  }
  const dominant = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (dominant && members.length > 0 && dominant[1] >= Math.ceil(members.length / 2)) {
    phrase += ` · ${dominant[0]}`;
  }

  return phrase;
}

async function generateClusterLabel(concepts, options = {}) {
  const {
    model = null, // null -> model provider picks the configured local/cloud model
    maxWords = DEFAULT_PARAMS.maxLabelWords,
    members = []
  } = options;

  // Representative page titles — clean, human-written signal that sharpens the
  // label and lets us name clusters even when no concepts were extracted.
  const titles = [...new Set(
    members
      .map((m) => (m && typeof m.title === "string" ? m.title.trim() : ""))
      .filter(Boolean)
  )].slice(0, 6);

  const haveConcepts = Array.isArray(concepts) && concepts.length > 0;

  // Only truly unnameable (no concepts AND no titles) falls back.
  if (!haveConcepts && titles.length === 0) {
    return buildDescriptiveLabel(concepts, members);
  }

  try {
    const conceptLine = haveConcepts
      ? `Shared concepts: ${concepts.join(', ')}\n`
      : '';
    const titleLine = titles.length
      ? `Page titles in this group:\n${titles.map((t) => `- ${t}`).join('\n')}\n`
      : '';

    const prompt = `${titleLine}${conceptLine}
These web pages were grouped together because they are about the same topic.
Generate a concise label (maximum ${maxWords} words) naming that topic.

The label should be:
- Clear, specific and in natural language
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

    return label || buildDescriptiveLabel(concepts, members);

  } catch (error) {
    console.error('Failed to generate cluster label:', error);
    // Fallback to a descriptive concept-based label (no LLM available)
    return buildDescriptiveLabel(concepts, members);
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

    // Prepare memories with embeddings. LanceDB returns `vector` as an Apache
    // Arrow Vector, which does not support plain [i] indexing — convert to a
    // real number[] so cosineSimilarity works. Skip the all-zero placeholder
    // row (memory_id 0) created when the table is first initialised.
    const memories = allEmbeddings
      .filter(item => item.memory_id && item.memory_id !== 0)
      .map(item => ({
        memoryId: item.memory_id,
        embedding: Array.from(item.vector),
        title: item.title,
        url: item.url
      }));

    // Perform clustering (try HDBSCAN first, fallback to simple clustering)
    const clusters = await clusterMemoriesWithHDBSCAN(memories, {
      minClusterSize,
      minSamples: options.minSamples || DEFAULT_PARAMS.minSamples,
      similarityThreshold
    });

    if (clusters.length === 0) {
      return {
        clustersCreated: 0,
        memoriesClustered: 0,
        crossClusterLinks: 0,
        message: 'No clusters found with current parameters'
      };
    }

    // Remove clusters from any previous run so labels don't accumulate.
    knowledgeGraph.clearClusters();

    // Generate labels and store clusters
    const storedClusters = [];
    for (const cluster of clusters) {
      // Extract concepts
      const concepts = extractClusterConcepts(
        knowledgeGraph,
        cluster.memberIds,
        10
      );

      // Generate label (pass members so the fallback can use source domains)
      const label = await generateClusterLabel(concepts, { ...options, members: cluster.members });

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
