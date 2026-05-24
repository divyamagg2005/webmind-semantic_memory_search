/**
 * LRU Cache Implementation
 * 
 * Provides caching for memory entries, engagement scores, query embeddings,
 * and association paths to improve performance.
 * 
 * Requirement 27.3: Add caching layer
 */

const { getConfigValue } = require('./config-manager');

/**
 * LRU Cache Node
 */
class CacheNode {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
    this.timestamp = Date.now();
  }
}

/**
 * LRU Cache Implementation
 * 
 * Requirement 27.3: Implement LRU cache for memory entries (1000 entries)
 */
class LRUCache {
  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.cache = new Map();
    this.head = new CacheNode(null, null); // Dummy head
    this.tail = new CacheNode(null, null); // Dummy tail
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return undefined;
    }

    const node = this.cache.get(key);
    this.moveToHead(node);
    this.hits++;
    return node.value;
  }

  /**
   * Put value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  put(key, value) {
    if (this.cache.has(key)) {
      const node = this.cache.get(key);
      node.value = value;
      node.timestamp = Date.now();
      this.moveToHead(node);
    } else {
      const newNode = new CacheNode(key, value);
      this.cache.set(key, newNode);
      this.addToHead(newNode);

      if (this.cache.size > this.capacity) {
        const removed = this.removeTail();
        this.cache.delete(removed.key);
      }
    }
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Remove key from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    if (!this.cache.has(key)) return;

    const node = this.cache.get(key);
    this.removeNode(node);
    this.cache.delete(key);
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache size
   * @returns {number} Number of items in cache
   */
  size() {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(3) : 0
    };
  }

  /**
   * Move node to head (most recently used)
   * @private
   */
  moveToHead(node) {
    this.removeNode(node);
    this.addToHead(node);
  }

  /**
   * Add node to head
   * @private
   */
  addToHead(node) {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next.prev = node;
    this.head.next = node;
  }

  /**
   * Remove node from list
   * @private
   */
  removeNode(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  /**
   * Remove tail (least recently used)
   * @private
   */
  removeTail() {
    const node = this.tail.prev;
    this.removeNode(node);
    return node;
  }
}

/**
 * Cache Manager
 * 
 * Manages multiple caches for different data types
 */
class CacheManager {
  constructor() {
    const cacheSize = getConfigValue('cache_size') || 1000;
    
    // Requirement 27.3: Cache for memory entries
    this.memoryCache = new LRUCache(cacheSize);
    
    // Requirement 27.3: Cache for engagement scores
    this.engagementCache = new LRUCache(Math.floor(cacheSize / 2));
    
    // Requirement 27.3: Cache for query embeddings
    this.embeddingCache = new LRUCache(Math.floor(cacheSize / 4));
    
    // Requirement 27.3: Cache for association paths
    this.associationCache = new LRUCache(Math.floor(cacheSize / 4));
  }

  /**
   * Get memory from cache
   * @param {number} memoryId - Memory ID
   * @returns {Object|undefined} Memory object
   */
  getMemory(memoryId) {
    return this.memoryCache.get(`memory_${memoryId}`);
  }

  /**
   * Cache memory
   * @param {number} memoryId - Memory ID
   * @param {Object} memory - Memory object
   */
  putMemory(memoryId, memory) {
    this.memoryCache.put(`memory_${memoryId}`, memory);
  }

  /**
   * Get engagement score from cache
   * @param {string} key - Engagement key (e.g., "dwell_60_scroll_50_revisit_3")
   * @returns {number|undefined} Engagement score
   */
  getEngagementScore(key) {
    return this.engagementCache.get(key);
  }

  /**
   * Cache engagement score
   * @param {string} key - Engagement key
   * @param {number} score - Engagement score
   */
  putEngagementScore(key, score) {
    this.engagementCache.put(key, score);
  }

  /**
   * Get query embedding from cache
   * @param {string} query - Query text
   * @returns {Array|undefined} Embedding vector
   */
  getQueryEmbedding(query) {
    return this.embeddingCache.get(query);
  }

  /**
   * Cache query embedding
   * @param {string} query - Query text
   * @param {Array} embedding - Embedding vector
   */
  putQueryEmbedding(query, embedding) {
    this.embeddingCache.put(query, embedding);
  }

  /**
   * Get association path from cache
   * @param {string} fromConcept - Source concept
   * @param {string} toConcept - Target concept
   * @returns {Array|undefined} Association path
   */
  getAssociationPath(fromConcept, toConcept) {
    const key = `${fromConcept}_to_${toConcept}`;
    return this.associationCache.get(key);
  }

  /**
   * Cache association path
   * @param {string} fromConcept - Source concept
   * @param {string} toConcept - Target concept
   * @param {Array} path - Association path
   */
  putAssociationPath(fromConcept, toConcept, path) {
    const key = `${fromConcept}_to_${toConcept}`;
    this.associationCache.put(key, path);
  }

  /**
   * Invalidate memory cache entry
   * @param {number} memoryId - Memory ID
   */
  invalidateMemory(memoryId) {
    this.memoryCache.delete(`memory_${memoryId}`);
  }

  /**
   * Clear all caches
   */
  clearAll() {
    this.memoryCache.clear();
    this.engagementCache.clear();
    this.embeddingCache.clear();
    this.associationCache.clear();
  }

  /**
   * Get statistics for all caches
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      memory: this.memoryCache.getStats(),
      engagement: this.engagementCache.getStats(),
      embedding: this.embeddingCache.getStats(),
      association: this.associationCache.getStats()
    };
  }
}

// Global cache manager instance
const cacheManager = new CacheManager();

module.exports = {
  LRUCache,
  CacheManager,
  cacheManager
};
