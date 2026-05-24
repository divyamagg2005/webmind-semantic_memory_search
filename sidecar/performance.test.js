/**
 * Performance Tests
 * 
 * Tests for query latency, throughput, and caching performance.
 * 
 * Requirements: 27.1, 28.1, 28.2
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { LRUCache } = require('./cache');
const { BatchProcessor, PerformanceMonitor } = require('./performance');

describe('Performance Optimizations', () => {
  
  // ============================================================================
  // LRU CACHE TESTS (Requirement 27.3)
  // ============================================================================
  
  describe('LRU Cache', () => {
    
    it('should store and retrieve values', () => {
      const cache = new LRUCache(3);
      
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      
      assert.strictEqual(cache.get('a'), 1);
      assert.strictEqual(cache.get('b'), 2);
      assert.strictEqual(cache.get('c'), 3);
    });
    
    it('should evict least recently used item when capacity exceeded', () => {
      const cache = new LRUCache(3);
      
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      cache.put('d', 4); // Should evict 'a'
      
      assert.strictEqual(cache.get('a'), undefined);
      assert.strictEqual(cache.get('b'), 2);
      assert.strictEqual(cache.get('c'), 3);
      assert.strictEqual(cache.get('d'), 4);
    });
    
    it('should update LRU order on access', () => {
      const cache = new LRUCache(3);
      
      cache.put('a', 1);
      cache.put('b', 2);
      cache.put('c', 3);
      
      cache.get('a'); // Access 'a', making it most recent
      
      cache.put('d', 4); // Should evict 'b' (least recent)
      
      assert.strictEqual(cache.get('a'), 1);
      assert.strictEqual(cache.get('b'), undefined);
      assert.strictEqual(cache.get('c'), 3);
      assert.strictEqual(cache.get('d'), 4);
    });
    
    it('should update existing values', () => {
      const cache = new LRUCache(3);
      
      cache.put('a', 1);
      cache.put('a', 10); // Update
      
      assert.strictEqual(cache.get('a'), 10);
      assert.strictEqual(cache.size(), 1);
    });
    
    it('should track cache hits and misses', () => {
      const cache = new LRUCache(3);
      
      cache.put('a', 1);
      cache.get('a'); // Hit
      cache.get('b'); // Miss
      cache.get('a'); // Hit
      
      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.strictEqual(parseFloat(stats.hitRate), 0.667);
    });
    
    it('should clear cache', () => {
      const cache = new LRUCache(3);
      
      cache.put('a', 1);
      cache.put('b', 2);
      
      cache.clear();
      
      assert.strictEqual(cache.size(), 0);
      assert.strictEqual(cache.get('a'), undefined);
    });
    
    it('should handle large capacity', () => {
      const cache = new LRUCache(1000);
      
      for (let i = 0; i < 1000; i++) {
        cache.put(`key_${i}`, i);
      }
      
      assert.strictEqual(cache.size(), 1000);
      
      // Add one more, should evict first
      cache.put('key_1000', 1000);
      
      assert.strictEqual(cache.size(), 1000);
      assert.strictEqual(cache.get('key_0'), undefined);
      assert.strictEqual(cache.get('key_1000'), 1000);
    });
    
  });
  
  // ============================================================================
  // BATCH PROCESSOR TESTS (Requirement 28.3)
  // ============================================================================
  
  describe('Batch Processor', () => {
    
    it('should process items in batches', async () => {
      let processedBatches = [];
      
      const processor = new BatchProcessor(async (items) => {
        processedBatches.push(items.length);
        return items.map(i => i * 2);
      }, { batchSize: 3, flushInterval: 100 });
      
      const promises = [
        processor.add(1),
        processor.add(2),
        processor.add(3)
      ];
      
      const results = await Promise.all(promises);
      
      assert.deepStrictEqual(results, [2, 4, 6]);
      assert.strictEqual(processedBatches.length, 1);
      assert.strictEqual(processedBatches[0], 3);
    });
    
    it('should flush on timer if batch not full', async () => {
      let processedBatches = [];
      
      const processor = new BatchProcessor(async (items) => {
        processedBatches.push(items.length);
        return items.map(i => i * 2);
      }, { batchSize: 10, flushInterval: 50 });
      
      const promises = [
        processor.add(1),
        processor.add(2)
      ];
      
      const results = await Promise.all(promises);
      
      assert.deepStrictEqual(results, [2, 4]);
      assert.strictEqual(processedBatches.length, 1);
      assert.strictEqual(processedBatches[0], 2);
    });
    
    it('should handle multiple batches', async () => {
      let processedBatches = [];
      
      const processor = new BatchProcessor(async (items) => {
        processedBatches.push(items.length);
        return items.map(i => i * 2);
      }, { batchSize: 2, flushInterval: 100 });
      
      const promises = [
        processor.add(1),
        processor.add(2),
        processor.add(3),
        processor.add(4)
      ];
      
      const results = await Promise.all(promises);
      
      assert.deepStrictEqual(results, [2, 4, 6, 8]);
      assert.strictEqual(processedBatches.length, 2);
    });
    
    it('should handle errors in batch processing', async () => {
      const processor = new BatchProcessor(async (items) => {
        throw new Error('Processing failed');
      }, { batchSize: 2, flushInterval: 100 });
      
      const promises = [
        processor.add(1),
        processor.add(2)
      ];
      
      await assert.rejects(
        Promise.all(promises),
        /Processing failed/
      );
    });
    
  });
  
  // ============================================================================
  // PERFORMANCE MONITOR TESTS (Requirements 27.1, 28.1, 28.2)
  // ============================================================================
  
  describe('Performance Monitor', () => {
    
    it('should record query latencies', () => {
      const monitor = new PerformanceMonitor();
      
      monitor.recordQuery(100);
      monitor.recordQuery(200);
      monitor.recordQuery(300);
      
      const stats = monitor.getQueryStats();
      
      assert.strictEqual(stats.count, 3);
      assert.strictEqual(stats.avg, 200);
      assert.strictEqual(stats.p50, 200);
      assert.strictEqual(stats.max, 300);
    });
    
    it('should calculate percentiles correctly', () => {
      const monitor = new PerformanceMonitor();
      
      // Add 100 samples
      for (let i = 1; i <= 100; i++) {
        monitor.recordQuery(i);
      }
      
      const stats = monitor.getQueryStats();
      
      assert.strictEqual(stats.count, 100);
      assert.strictEqual(stats.p50, 50);
      assert.strictEqual(stats.p95, 95);
      assert.strictEqual(stats.p99, 99);
    });
    
    it('should track ingestion throughput', () => {
      const monitor = new PerformanceMonitor();
      
      monitor.recordIngestion(100);
      monitor.recordIngestion(100);
      monitor.recordIngestion(100);
      
      const stats = monitor.getIngestionStats();
      
      assert.strictEqual(stats.count, 3);
      assert.strictEqual(stats.avg, 100);
      assert.strictEqual(stats.throughput, 10); // 1000ms / 100ms = 10 items/sec
    });
    
    it('should track embedding generation', () => {
      const monitor = new PerformanceMonitor();
      
      monitor.recordEmbedding(500);
      monitor.recordEmbedding(600);
      
      const stats = monitor.getEmbeddingStats();
      
      assert.strictEqual(stats.count, 2);
      assert.strictEqual(stats.avg, 550);
    });
    
    it('should handle empty metrics', () => {
      const monitor = new PerformanceMonitor();
      
      const stats = monitor.getQueryStats();
      
      assert.strictEqual(stats.count, 0);
      assert.strictEqual(stats.avg, 0);
      assert.strictEqual(stats.p95, 0);
    });
    
    it('should limit sample size', () => {
      const monitor = new PerformanceMonitor();
      monitor.maxSamples = 10;
      
      for (let i = 0; i < 20; i++) {
        monitor.recordQuery(i);
      }
      
      const stats = monitor.getQueryStats();
      
      assert.strictEqual(stats.count, 10);
    });
    
    it('should reset metrics', () => {
      const monitor = new PerformanceMonitor();
      
      monitor.recordQuery(100);
      monitor.recordIngestion(200);
      
      monitor.reset();
      
      const queryStats = monitor.getQueryStats();
      const ingestionStats = monitor.getIngestionStats();
      
      assert.strictEqual(queryStats.count, 0);
      assert.strictEqual(ingestionStats.count, 0);
    });
    
  });
  
  // ============================================================================
  // PERFORMANCE BENCHMARKS (Requirement 27.1)
  // ============================================================================
  
  describe('Performance Benchmarks', () => {
    
    it('should demonstrate cache performance improvement', () => {
      const cache = new LRUCache(100);
      
      // Warm up cache
      for (let i = 0; i < 100; i++) {
        cache.put(`key_${i}`, { data: `value_${i}` });
      }
      
      // Measure cache hits
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        cache.get(`key_${i % 100}`);
      }
      const duration = Date.now() - start;
      
      // Cache access should be very fast (< 10ms for 1000 accesses)
      assert.ok(duration < 10, `Cache access took ${duration}ms`);
      
      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 1000);
    });
    
    it('should demonstrate batch processing efficiency', async () => {
      let callCount = 0;
      
      const processor = new BatchProcessor(async (items) => {
        callCount++;
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 10));
        return items.map(i => i * 2);
      }, { batchSize: 10, flushInterval: 100 });
      
      const start = Date.now();
      
      // Process 50 items
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(processor.add(i));
      }
      
      await Promise.all(promises);
      
      const duration = Date.now() - start;
      
      // Should process in 5 batches (50 / 10)
      assert.strictEqual(callCount, 5);
      
      // Batch processing should be faster than individual processing
      // Individual: 50 * 10ms = 500ms
      // Batch: 5 * 10ms = 50ms
      assert.ok(duration < 200, `Batch processing took ${duration}ms`);
    });
    
  });
  
  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================
  
  describe('Cache Integration', () => {
    
    it('should improve repeated query performance', () => {
      const cache = new LRUCache(1000);
      
      // Simulate query results
      const queryResult = {
        memories: Array(10).fill(null).map((_, i) => ({
          id: i,
          title: `Memory ${i}`,
          content: `Content ${i}`
        }))
      };
      
      // First query (cache miss)
      const query1 = 'test query';
      cache.put(query1, queryResult);
      
      // Second query (cache hit)
      const cached = cache.get(query1);
      
      assert.deepStrictEqual(cached, queryResult);
      
      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 1);
      assert.strictEqual(stats.misses, 0);
    });
    
  });
  
});
