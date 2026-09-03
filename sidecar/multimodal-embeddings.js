/**
 * Multi-Modal Embedding System
 * 
 * Implements text and image embedding generation using Ollama and CLIP.
 * Supports multi-modal query processing with weighted score combination.
 * 
 * Requirements: 12.3, 12.4, 12.5, 13.3, 13.4, 13.5, 14.1, 14.2, 14.3, 14.4, 14.5, 24.1, 24.2, 25.1, 25.4
 */

const { Ollama } = require('ollama');

/**
 * Text embedding model (nomic-embed-text, 768 dimensions)
 */
const TEXT_EMBEDDING_MODEL = 'nomic-embed-text';
const TEXT_EMBEDDING_DIMS = 768;

/**
 * Image embedding dimensions (CLIP ViT-B/32, 512 dimensions)
 * Note: Actual CLIP integration would require additional libraries
 */
const IMAGE_EMBEDDING_DIMS = 512;

/**
 * Default Ollama vision model used to caption page images.
 * Overridable via the `vision_model` config key.
 */
const VISION_MODEL = 'llava';

/** Max bytes we will download for a single image before giving up */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Multi-modal score weights
 */
const TEXT_WEIGHT = 0.6;
const IMAGE_WEIGHT = 0.4;

/**
 * Ollama client wrapper for embeddings
 */
class OllamaEmbeddingClient {
  constructor() {
    this.ollama = new Ollama();
    this.isAvailable = null;
  }

  /**
   * Check if Ollama is available
   * 
   * Requirement 25.4: Handle connection failures gracefully
   * 
   * @returns {Promise<boolean>} True if Ollama is available
   */
  async checkAvailability() {
    try {
      await this.ollama.list();
      this.isAvailable = true;
      return true;
    } catch (error) {
      console.error('Ollama unavailable:', error.message);
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * Generate text embedding using Ollama
   * 
   * Requirement 25.1: Use Ollama for all LLM inference tasks
   * Requirement 24.1: Use nomic-embed-text model for text embeddings
   * 
   * @param {string} text - Text to embed
   * @returns {Promise<Array<number>>} Embedding vector (768 dims)
   */
  async generateTextEmbedding(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Invalid text input');
    }

    try {
      const response = await this.ollama.embed({
        model: TEXT_EMBEDDING_MODEL,
        input: text
      });

      const embedding = response.embeddings[0];
      
      if (!Array.isArray(embedding) || embedding.length !== TEXT_EMBEDDING_DIMS) {
        throw new Error(`Invalid embedding dimensions: expected ${TEXT_EMBEDDING_DIMS}, got ${embedding?.length}`);
      }

      return embedding;
    } catch (error) {
      console.error('Failed to generate text embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * 
   * @param {Array<string>} texts - Array of texts to embed
   * @returns {Promise<Array<Array<number>>>} Array of embedding vectors
   */
  async generateTextEmbeddingsBatch(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      return [];
    }

    try {
      const response = await this.ollama.embed({
        model: TEXT_EMBEDDING_MODEL,
        input: texts
      });

      return response.embeddings;
    } catch (error) {
      console.error('Failed to generate batch embeddings:', error);
      throw error;
    }
  }
}

/**
 * Ollama vision client — turns an image into a short text description
 * ("caption") that can then be embedded with the normal text embedder.
 *
 * This is what makes images "memorised" the same way page text is: the
 * caption is embedded into the same 768-dim vector space and stored against
 * the parent memory, so an image match surfaces its page during retrieval.
 */
class OllamaVisionClient {
  /**
   * @param {Object} options
   * @param {string} options.model - Ollama vision model (default: VISION_MODEL)
   */
  constructor({ model = VISION_MODEL } = {}) {
    this.ollama = new Ollama();
    this.model = model || VISION_MODEL;
  }

  /**
   * Download an image and return raw base64 (no data: prefix).
   * Handles data: URLs directly. Returns null on any failure.
   *
   * @param {string} url - Image URL or data: URI
   * @returns {Promise<string|null>} base64 image data
   */
  async fetchImageBase64(url) {
    if (!url || typeof url !== 'string') return null;

    try {
      if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        if (comma === -1) return null;
        const meta = url.slice(5, comma);
        if (!meta.includes('image/')) return null;
        return meta.includes('base64')
          ? url.slice(comma + 1)
          : Buffer.from(decodeURIComponent(url.slice(comma + 1))).toString('base64');
      }

      const res = await fetch(url);
      if (!res.ok) return null;

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return null;

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;

      return buf.toString('base64');
    } catch (error) {
      console.error(`Failed to fetch image ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Generate a concise description of an image for search indexing.
   *
   * @param {string} url - Image URL or data: URI
   * @param {string} [altText] - Existing alt text, passed to the model as a hint
   * @returns {Promise<string|null>} caption text, or null if unavailable
   */
  async captionImage(url, altText = '') {
    const b64 = await this.fetchImageBase64(url);
    if (!b64) return null;

    const hint = altText ? ` The page's alt text for it is: "${altText}".` : '';
    const prompt =
      'Describe this image concisely for search indexing. ' +
      'One or two sentences. Focus on the visible subject, any readable text, ' +
      'and the image type (photo, diagram, screenshot, chart, logo, illustration).' +
      hint;

    try {
      const response = await this.ollama.generate({
        model: this.model,
        prompt,
        images: [b64],
        stream: false
      });

      const caption = (response && response.response ? response.response : '').trim();
      return caption || null;
    } catch (error) {
      console.error(`Vision captioning failed for ${url}:`, error.message);
      return null;
    }
  }
}

/**
 * CLIP image embedding generator (placeholder)
 * 
 * Note: Full CLIP integration would require:
 * - @xenova/transformers or similar library
 * - Image preprocessing pipeline
 * - Model loading and caching
 * 
 * This is a simplified interface for the design.
 */
class CLIPEmbeddingClient {
  constructor() {
    this.model = null;
    this.isLoaded = false;
  }

  /**
   * Load CLIP model
   * 
   * Requirement 24.2: Use CLIP ViT-B/32 model for image embeddings
   * 
   * @returns {Promise<void>}
   */
  async loadModel() {
    // Placeholder for CLIP model loading
    // In production, would use: @xenova/transformers or clip-as-service
    console.log('CLIP model loading not implemented - placeholder only');
    this.isLoaded = true;
  }

  /**
   * Generate image embedding using CLIP
   * 
   * Requirement 12.3: Generate CLIP embeddings for extracted images
   * 
   * @param {string} imageUrl - URL or path to image
   * @returns {Promise<Array<number>>} Embedding vector (512 dims)
   */
  async generateImageEmbedding(imageUrl) {
    if (!imageUrl) {
      throw new Error('Invalid image URL');
    }

    // Placeholder implementation
    // In production, would:
    // 1. Fetch/load image
    // 2. Preprocess (resize, normalize)
    // 3. Run through CLIP vision encoder
    // 4. Return embedding vector
    
    console.warn('CLIP image embedding not implemented - returning mock embedding');
    return new Array(IMAGE_EMBEDDING_DIMS).fill(0);
  }

  /**
   * Generate text embedding using CLIP text encoder
   * 
   * Requirement 14.1: Generate both text and CLIP embeddings for queries
   * 
   * @param {string} text - Text to embed
   * @returns {Promise<Array<number>>} Embedding vector (512 dims)
   */
  async generateTextEmbedding(text) {
    if (!text) {
      throw new Error('Invalid text input');
    }

    // Placeholder implementation
    console.warn('CLIP text embedding not implemented - returning mock embedding');
    return new Array(IMAGE_EMBEDDING_DIMS).fill(0);
  }

  /**
   * Generate video thumbnail embedding
   * 
   * Requirement 13.3: Generate CLIP embeddings for video thumbnails
   * 
   * @param {string} thumbnailUrl - URL to video thumbnail
   * @returns {Promise<Array<number>>} Embedding vector (512 dims)
   */
  async generateVideoThumbnailEmbedding(thumbnailUrl) {
    // Video thumbnails are just images, use same method
    return this.generateImageEmbedding(thumbnailUrl);
  }
}

/**
 * Calculate weighted combination of multi-modal scores
 * 
 * Requirement 14.3: Combine multi-modal similarity scores using weighted average
 * 
 * @param {Object} scores - Similarity scores
 * @param {number} scores.textScore - Text similarity score (0-1)
 * @param {number} scores.imageScore - Image similarity score (0-1)
 * @param {Object} weights - Score weights
 * @param {number} weights.textWeight - Text weight (default 0.6)
 * @param {number} weights.imageWeight - Image weight (default 0.4)
 * @returns {number} Combined score (0-1)
 */
function combineMultiModalScores(scores, weights = {}) {
  const {
    textScore = 0,
    imageScore = 0
  } = scores;

  const {
    textWeight = TEXT_WEIGHT,
    imageWeight = IMAGE_WEIGHT
  } = weights;

  // Validate inputs
  if (typeof textScore !== 'number' || textScore < 0 || textScore > 1) {
    throw new Error('Invalid text score: must be between 0 and 1');
  }

  if (typeof imageScore !== 'number' || imageScore < 0 || imageScore > 1) {
    throw new Error('Invalid image score: must be between 0 and 1');
  }

  // Normalize weights
  const totalWeight = textWeight + imageWeight;
  if (totalWeight === 0) {
    return 0;
  }

  const normalizedTextWeight = textWeight / totalWeight;
  const normalizedImageWeight = imageWeight / totalWeight;

  // Calculate weighted average
  const combinedScore = (textScore * normalizedTextWeight) + (imageScore * normalizedImageWeight);

  // Ensure result is in [0, 1] range
  return Math.max(0, Math.min(1, combinedScore));
}

/**
 * Rank results by combined multi-modal score
 * 
 * Requirement 14.4: Rank results by combined multi-modal score
 * 
 * @param {Array<Object>} results - Search results with scores
 * @param {Object} weights - Score weights
 * @returns {Array<Object>} Sorted results
 */
function rankByMultiModalScore(results, weights = {}) {
  if (!Array.isArray(results)) {
    return [];
  }

  // Calculate combined scores
  const resultsWithCombinedScore = results.map(result => {
    const combinedScore = combineMultiModalScores({
      textScore: result.textScore || 0,
      imageScore: result.imageScore || 0
    }, weights);

    return {
      ...result,
      combinedScore
    };
  });

  // Sort by combined score (descending)
  return resultsWithCombinedScore.sort((a, b) => b.combinedScore - a.combinedScore);
}

/**
 * Process multi-modal query
 * 
 * Requirement 14.1: Generate both text and CLIP embeddings for queries
 * Requirement 14.5: Support queries like "dark themed diagram" or "code screenshot"
 * 
 * @param {string} query - Search query
 * @param {OllamaEmbeddingClient} ollamaClient - Ollama client
 * @param {CLIPEmbeddingClient} clipClient - CLIP client
 * @returns {Promise<Object>} Query embeddings
 */
async function processMultiModalQuery(query, ollamaClient, clipClient) {
  if (!query || typeof query !== 'string') {
    throw new Error('Invalid query');
  }

  const embeddings = {
    text: null,
    clip: null
  };

  // Generate text embedding via Ollama
  try {
    embeddings.text = await ollamaClient.generateTextEmbedding(query);
  } catch (error) {
    console.error('Failed to generate text embedding for query:', error);
  }

  // Generate CLIP text embedding for visual queries
  try {
    if (clipClient.isLoaded) {
      embeddings.clip = await clipClient.generateTextEmbedding(query);
    }
  } catch (error) {
    console.error('Failed to generate CLIP embedding for query:', error);
  }

  return embeddings;
}

/**
 * Handle fallback when modalities are missing
 * 
 * Requirement 14.2: Search text embeddings (weight 0.6) and image embeddings (weight 0.4)
 * 
 * @param {Object} scores - Similarity scores (may have missing values)
 * @returns {Object} Adjusted scores and weights
 */
function handleMissingModalities(scores) {
  const { textScore, imageScore } = scores;
  
  const hasText = typeof textScore === 'number' && !isNaN(textScore);
  const hasImage = typeof imageScore === 'number' && !isNaN(imageScore);

  if (!hasText && !hasImage) {
    return {
      scores: { textScore: 0, imageScore: 0 },
      weights: { textWeight: 0.5, imageWeight: 0.5 }
    };
  }

  if (!hasText) {
    // Only image score available
    return {
      scores: { textScore: 0, imageScore: imageScore || 0 },
      weights: { textWeight: 0, imageWeight: 1.0 }
    };
  }

  if (!hasImage) {
    // Only text score available
    return {
      scores: { textScore: textScore || 0, imageScore: 0 },
      weights: { textWeight: 1.0, imageWeight: 0 }
    };
  }

  // Both available
  return {
    scores: { textScore, imageScore },
    weights: { textWeight: TEXT_WEIGHT, imageWeight: IMAGE_WEIGHT }
  };
}

/**
 * Store image embedding in database
 * 
 * Requirement 12.4: Store image embeddings in Vector_Store
 * Requirement 12.5: Link image embeddings to parent Memory_Entry records
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} memoryId - Parent memory ID
 * @param {string} imageUrl - Image URL
 * @param {Array<number>} embedding - Image embedding vector
 * @param {Object} metadata - Image metadata (width, height, alt)
 * @returns {number} Image record ID
 */
function storeImageEmbedding(db, memoryId, imageUrl, embedding, metadata = {}) {
  const { width, height, alt } = metadata;

  const stmt = db.prepare(`
    INSERT INTO images (memory_id, url, width, height, alt_text, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    memoryId,
    imageUrl,
    width || null,
    height || null,
    alt || null,
    JSON.stringify(embedding)
  );

  return result.lastInsertRowid;
}

/**
 * Store video embedding in database
 * 
 * Requirement 13.4: Store video embeddings with metadata
 * Requirement 13.5: Link to parent memory entries
 * 
 * @param {Object} db - SQLite database instance
 * @param {number} memoryId - Parent memory ID
 * @param {string} videoUrl - Video URL
 * @param {Array<number>} embedding - Video thumbnail embedding vector
 * @param {Object} metadata - Video metadata (duration, thumbnail)
 * @returns {number} Video record ID
 */
function storeVideoEmbedding(db, memoryId, videoUrl, embedding, metadata = {}) {
  const { duration, thumbnailUrl } = metadata;

  const stmt = db.prepare(`
    INSERT INTO videos (memory_id, url, duration, thumbnail_url, embedding)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    memoryId,
    videoUrl,
    duration || null,
    thumbnailUrl || null,
    JSON.stringify(embedding)
  );

  return result.lastInsertRowid;
}

module.exports = {
  TEXT_EMBEDDING_MODEL,
  TEXT_EMBEDDING_DIMS,
  IMAGE_EMBEDDING_DIMS,
  VISION_MODEL,
  TEXT_WEIGHT,
  IMAGE_WEIGHT,
  OllamaEmbeddingClient,
  OllamaVisionClient,
  CLIPEmbeddingClient,
  combineMultiModalScores,
  rankByMultiModalScore,
  processMultiModalQuery,
  handleMissingModalities,
  storeImageEmbedding,
  storeVideoEmbedding
};
