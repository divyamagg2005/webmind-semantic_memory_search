/**
 * Unit Tests for Session Detection Core Logic
 * 
 * Tests cover:
 * - Session timeout boundary detection
 * - Embedding similarity calculation
 * - Session decision logic
 * - Property tests for session boundaries
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  SESSION_TIMEOUT_MS,
  SIMILARITY_THRESHOLD,
  calculateCosineSimilarity,
  shouldCreateNewSession
} = require('./session-detection');

describe('Session Detection Core Logic', () => {
  
  describe('calculateCosineSimilarity', () => {
    it('should calculate cosine similarity between identical vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0];
      
      const similarity = calculateCosineSimilarity(vec1, vec2);
      assert.strictEqual(similarity, 1.0);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      
      const similarity = calculateCosineSimilarity(vec1, vec2);
      assert.strictEqual(similarity, 0);
    });

    it('should calculate similarity for similar vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [1, 2, 3];
      
      const similarity = calculateCosineSimilarity(vec1, vec2);
      assert.strictEqual(similarity, 1.0);
    });

    it('should handle different magnitude vectors', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [2, 4, 6];
      
      const similarity = calculateCosineSimilarity(vec1, vec2);
      assert.ok(similarity > 0.99); // Should be very close to 1
    });

    it('should handle edge cases', () => {
      // Empty arrays
      assert.strictEqual(calculateCosineSimilarity([], []), 0);
      
      // Different lengths
      assert.strictEqual(calculateCosineSimilarity([1, 2], [1, 2, 3]), 0);
      
      // Null/undefined
      assert.strictEqual(calculateCosineSimilarity(null, [1, 2]), 0);
      assert.strictEqual(calculateCosineSimilarity([1, 2], undefined), 0);
      
      // Zero vectors
      assert.strictEqual(calculateCosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
    });

    it('should be symmetric', () => {
      const vec1 = [1, 2, 3];
      const vec2 = [4, 5, 6];
      
      const sim1 = calculateCosineSimilarity(vec1, vec2);
      const sim2 = calculateCosineSimilarity(vec2, vec1);
      
      assert.strictEqual(sim1, sim2);
    });
  });

  describe('shouldCreateNewSession', () => {
    /**
     * Property 11: Session Timeout Boundary
     * Validates: Requirement 9.1
     */
    it('should create new session after 30-minute timeout', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T12:31:00Z'); // 31 minutes later
      
      const result = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: [1, 0, 0],
        currentPageEmbedding: [1, 0, 0]
      });
      
      assert.strictEqual(result, true);
    });

    it('should maintain session within 30-minute window', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T12:29:00Z'); // 29 minutes later
      
      const result = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: [1, 0, 0],
        currentPageEmbedding: [1, 0, 0]
      });
      
      assert.strictEqual(result, false);
    });

    it('should create new session when similarity below threshold', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T12:05:00Z'); // 5 minutes later
      
      // Very different embeddings (similarity < 0.7)
      const result = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: [1, 0, 0],
        currentPageEmbedding: [0, 1, 0]
      });
      
      assert.strictEqual(result, true);
    });

    it('should maintain session when similarity above threshold', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T12:05:00Z');
      
      // Similar embeddings (similarity > 0.7)
      const result = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: [1, 2, 3],
        currentPageEmbedding: [1.1, 2.1, 3.1]
      });
      
      assert.strictEqual(result, false);
    });

    it('should create new session when no previous page', () => {
      const result = shouldCreateNewSession({
        lastPageTimestamp: null,
        currentPageTimestamp: new Date(),
        lastPageEmbedding: null,
        currentPageEmbedding: [1, 0, 0]
      });
      
      assert.strictEqual(result, true);
    });

    it('should handle missing embeddings', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T12:05:00Z');
      
      // Without embeddings, only time matters
      const result = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: null,
        currentPageEmbedding: null
      });
      
      assert.strictEqual(result, false); // Within 30 minutes
    });

    it('should handle invalid timestamps', () => {
      const result = shouldCreateNewSession({
        lastPageTimestamp: 'invalid',
        currentPageTimestamp: 'invalid',
        lastPageEmbedding: [1, 0, 0],
        currentPageEmbedding: [1, 0, 0]
      });
      
      assert.strictEqual(result, true);
    });

    /**
     * Property test: Timeout boundary should be exact at 30 minutes
     */
    it('should respect exact 30-minute boundary', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      
      // Exactly 30 minutes - should NOT create new session
      const at30Min = new Date(lastTime.getTime() + SESSION_TIMEOUT_MS);
      const result1 = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: at30Min,
        lastPageEmbedding: [1, 0, 0],
        currentPageEmbedding: [1, 0, 0]
      });
      assert.strictEqual(result1, false);
      
      // Just over 30 minutes - should create new session
      const over30Min = new Date(lastTime.getTime() + SESSION_TIMEOUT_MS + 1);
      const result2 = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: over30Min,
        lastPageEmbedding: [1, 0, 0],
        currentPageEmbedding: [1, 0, 0]
      });
      assert.strictEqual(result2, true);
    });

    /**
     * Property test: Time takes precedence over similarity
     */
    it('should create new session on timeout regardless of similarity', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T13:00:00Z'); // 60 minutes later
      
      // Even with identical embeddings, timeout should trigger new session
      const result = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: [1, 2, 3],
        currentPageEmbedding: [1, 2, 3]
      });
      
      assert.strictEqual(result, true);
    });

    /**
     * Property test: Similarity threshold is exactly 0.7
     */
    it('should respect similarity threshold of 0.7', () => {
      const lastTime = new Date('2024-01-01T12:00:00Z');
      const currentTime = new Date('2024-01-01T12:05:00Z');
      
      // Create vectors with similarity just above 0.7
      const vec1 = [1, 0, 0];
      const vec2 = [0.8, 0.6, 0]; // Similarity ≈ 0.8
      
      const result1 = shouldCreateNewSession({
        lastPageTimestamp: lastTime,
        currentPageTimestamp: currentTime,
        lastPageEmbedding: vec1,
        currentPageEmbedding: vec2
      });
      
      // Should maintain session (similarity > 0.7)
      assert.strictEqual(result1, false);
    });
  });

  describe('Constants', () => {
    it('should have correct session timeout', () => {
      assert.strictEqual(SESSION_TIMEOUT_MS, 30 * 60 * 1000);
    });

    it('should have correct similarity threshold', () => {
      assert.strictEqual(SIMILARITY_THRESHOLD, 0.7);
    });
  });
});
