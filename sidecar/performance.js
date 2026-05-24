/**
 * Performance Optimization Module
 * 
 * Provides batch processing, query optimization, and performance monitoring.
 * 
 * Requirements: 27.2, 27.4, 28.3
 */

const { getConfigValue } = require('./config-manager');

/**
 * Batch Processor
 * 
 * Queues items for batch processing to improve throughput
 * 
 * Requirement 28.3: Implement batch processing
 */
class BatchProcessor {
  constructor(processFn, options = {}) {
    this.processFn = processFn;
    this.batchSize = options.batchSize || getConfigValue('batch_size') || 10;
    this.flushInterval = options.flushInterval || 1000; // 1 second
    this.queue = [];
    this.processing = false;
    this.timer = null;
  }

  /**
   * Add item to batch queue
   * @param {*} item - Item to process
   * @returns {Promise} Promise that resolves when item is processed
   */
  add(item) {
    return new Promise((resolve, reject) => {
      this.queue.push({ item, resolve, reject });

      // Process immediately if batch is full
      if (this.queue.length >= this.batchSize) {
        this.flush();
      } else if (!this.timer) {
        // Set timer to flush after interval
        this.timer = setTimeout(() => this.flush(), this.flushInterval);
      }
    });
  }

  /**
   * Flush current batch
   */
  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0 || this.processing) {
      return;
    }

    this.processing = true;
    const batch = this.queue.splice(0, this.batchSize);

    try {
      const items = batch.map(b => b.item);
      const results = await this.processFn(items);

      // Resolve all promises
      batch.forEach((b, index) => {
        b.resolve(results[index]);
      });
    } catch (err) {
      // Reject all promises
      batch.forEach(b => {
        b.reject(err);
      });
    } finally {
      this.processing = false;

      // Process remaining items if any
      if (this.queue.length > 0) {
        this.flush();
      }
    }
  }

  /**
   * Get queue size
   * @returns {number} Number of items in queue
   */
  size() {
    return this.queue.length;
  }

  /**
   * Clear queue
   */
  clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
  }
}

/**
 * Performance Monitor
 * 
 * Tracks query latency and throughput
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      queries: [],
      ingestions: [],
      embeddings: []
    };
    this.maxSamples = 1000;
  }

  /**
   * Record query latency
   * @param {number} latency - Query latency in milliseconds
   */
  recordQuery(latency) {
    this.metrics.queries.push({
      latency,
      timestamp: Date.now()
    });

    if (this.metrics.queries.length > this.maxSamples) {
      this.metrics.queries.shift();
    }
  }

  /**
   * Record ingestion latency
   * @param {number} latency - Ingestion latency in milliseconds
   */
  recordIngestion(latency) {
    this.metrics.ingestions.push({
      latency,
      timestamp: Date.now()
    });

    if (this.metrics.ingestions.length > this.maxSamples) {
      this.metrics.ingestions.shift();
    }
  }

  /**
   * Record embedding generation latency
   * @param {number} latency - Embedding latency in milliseconds
   */
  recordEmbedding(latency) {
    this.metrics.embeddings.push({
      latency,
      timestamp: Date.now()
    });

    if (this.metrics.embeddings.length > this.maxSamples) {
      this.metrics.embeddings.shift();
    }
  }

  /**
   * Calculate percentile
   * @private
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get query statistics
   * @returns {Object} Query statistics
   */
  getQueryStats() {
    const latencies = this.metrics.queries.map(q => q.latency);

    if (latencies.length === 0) {
      return {
        count: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        max: 0
      };
    }

    const sum = latencies.reduce((a, b) => a + b, 0);

    return {
      count: latencies.length,
      avg: Math.round(sum / latencies.length),
      p50: Math.round(this.calculatePercentile(latencies, 50)),
      p95: Math.round(this.calculatePercentile(latencies, 95)),
      p99: Math.round(this.calculatePercentile(latencies, 99)),
      max: Math.round(Math.max(...latencies))
    };
  }

  /**
   * Get ingestion statistics
   * @returns {Object} Ingestion statistics
   */
  getIngestionStats() {
    const latencies = this.metrics.ingestions.map(i => i.latency);

    if (latencies.length === 0) {
      return {
        count: 0,
        avg: 0,
        throughput: 0
      };
    }

    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = sum / latencies.length;

    // Calculate throughput (items per second)
    const throughput = latencies.length > 0 ? 1000 / avg : 0;

    return {
      count: latencies.length,
      avg: Math.round(avg),
      throughput: Math.round(throughput)
    };
  }

  /**
   * Get embedding statistics
   * @returns {Object} Embedding statistics
   */
  getEmbeddingStats() {
    const latencies = this.metrics.embeddings.map(e => e.latency);

    if (latencies.length === 0) {
      return {
        count: 0,
        avg: 0
      };
    }

    const sum = latencies.reduce((a, b) => a + b, 0);

    return {
      count: latencies.length,
      avg: Math.round(sum / latencies.length)
    };
  }

  /**
   * Get all statistics
   * @returns {Object} All performance statistics
   */
  getStats() {
    return {
      queries: this.getQueryStats(),
      ingestions: this.getIngestionStats(),
      embeddings: this.getEmbeddingStats()
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = {
      queries: [],
      ingestions: [],
      embeddings: []
    };
  }
}

/**
 * Database Index Optimizer
 * 
 * Provides utilities for optimizing database indexes
 * 
 * Requirement 27.2, 27.4: Optimize database indexes
 */
class IndexOptimizer {
  /**
   * Create composite index on SQLite
   * @param {sqlite3.Database} db - Database instance
   * @param {string} tableName - Table name
   * @param {Array<string>} columns - Column names
   * @param {string} indexName - Index name
   * @returns {Promise} Promise that resolves when index is created
   */
  static createCompositeIndex(db, tableName, columns, indexName) {
    return new Promise((resolve, reject) => {
      const columnList = columns.join(', ');
      const sql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnList})`;

      db.run(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Created index ${indexName} on ${tableName}(${columnList})`);
          resolve();
        }
      });
    });
  }

  /**
   * Analyze table for query optimization
   * @param {sqlite3.Database} db - Database instance
   * @param {string} tableName - Table name
   * @returns {Promise} Promise that resolves when analysis is complete
   */
  static analyzeTable(db, tableName) {
    return new Promise((resolve, reject) => {
      db.run(`ANALYZE ${tableName}`, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Analyzed table ${tableName}`);
          resolve();
        }
      });
    });
  }

  /**
   * Optimize all indexes
   * @param {sqlite3.Database} db - Database instance
   * @returns {Promise} Promise that resolves when optimization is complete
   * 
   * Requirement 27.2: Add composite index on (memory_strength, timestamp)
   */
  static async optimizeIndexes(db) {
    try {
      // Create composite index on memory_strength and timestamp
      await IndexOptimizer.createCompositeIndex(
        db,
        'memories',
        ['memory_strength', 'timestamp'],
        'idx_memories_strength_time'
      );

      // Create index on is_pinned for quick filtering
      await IndexOptimizer.createCompositeIndex(
        db,
        'memories',
        ['is_pinned'],
        'idx_memories_pinned'
      );

      // Create index on is_bookmarked for quick filtering
      await IndexOptimizer.createCompositeIndex(
        db,
        'memories',
        ['is_bookmarked'],
        'idx_memories_bookmarked'
      );

      // Analyze tables for query optimization
      await IndexOptimizer.analyzeTable(db, 'memories');
      await IndexOptimizer.analyzeTable(db, 'sessions');

      console.log('Database indexes optimized');
    } catch (err) {
      console.error('Index optimization failed:', err);
      throw err;
    }
  }
}

// Global performance monitor instance
const performanceMonitor = new PerformanceMonitor();

module.exports = {
  BatchProcessor,
  PerformanceMonitor,
  IndexOptimizer,
  performanceMonitor
};
