/**
 * Configuration Management Tests
 * 
 * Tests for configuration validation, persistence, and updates.
 * 
 * Requirements: 30.5, 30.6
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  validateConfigValue,
  validateConfig,
  getConfig,
  updateConfig,
  resetConfig,
  DEFAULT_CONFIG
} = require('./config-manager');

const TEST_CONFIG_FILE = path.join(__dirname, 'config.test.json');
const ORIGINAL_CONFIG_FILE = path.join(__dirname, 'config.json');

describe('Configuration Management', () => {
  
  // ============================================================================
  // CONFIGURATION VALIDATION TESTS (Requirement 30.5)
  // ============================================================================
  
  describe('Configuration Validation', () => {
    
    it('should validate decay_rate within range', () => {
      const result1 = validateConfigValue('decay_rate', 0.02);
      assert.strictEqual(result1.valid, true);
      
      const result2 = validateConfigValue('decay_rate', 0.0005);
      assert.strictEqual(result2.valid, false);
      
      const result3 = validateConfigValue('decay_rate', 0.15);
      assert.strictEqual(result3.valid, false);
    });
    
    it('should validate engagement weights', () => {
      const result1 = validateConfigValue('engagement_weight_dwell', 0.4);
      assert.strictEqual(result1.valid, true);
      
      const result2 = validateConfigValue('engagement_weight_dwell', -0.1);
      assert.strictEqual(result2.valid, false);
      
      const result3 = validateConfigValue('engagement_weight_dwell', 1.5);
      assert.strictEqual(result3.valid, false);
    });
    
    it('should validate session_timeout range', () => {
      const result1 = validateConfigValue('session_timeout', 1800);
      assert.strictEqual(result1.valid, true);
      
      const result2 = validateConfigValue('session_timeout', 100);
      assert.strictEqual(result2.valid, false);
      
      const result3 = validateConfigValue('session_timeout', 10000);
      assert.strictEqual(result3.valid, false);
    });
    
    it('should validate min_cluster_size range', () => {
      const result1 = validateConfigValue('min_cluster_size', 3);
      assert.strictEqual(result1.valid, true);
      
      const result2 = validateConfigValue('min_cluster_size', 1);
      assert.strictEqual(result2.valid, false);
      
      const result3 = validateConfigValue('min_cluster_size', 25);
      assert.strictEqual(result3.valid, false);
    });
    
    it('should validate llm_model allowed values', () => {
      const result1 = validateConfigValue('llm_model', 'llama3.2');
      assert.strictEqual(result1.valid, true);
      
      const result2 = validateConfigValue('llm_model', 'mistral');
      assert.strictEqual(result2.valid, true);
      
      const result3 = validateConfigValue('llm_model', 'gpt-4');
      assert.strictEqual(result3.valid, false);
    });
    
    it('should validate embedding_dimensions allowed values', () => {
      const result1 = validateConfigValue('embedding_dimensions', 768);
      assert.strictEqual(result1.valid, true);
      
      const result2 = validateConfigValue('embedding_dimensions', 384);
      assert.strictEqual(result2.valid, true);
      
      const result3 = validateConfigValue('embedding_dimensions', 512);
      assert.strictEqual(result3.valid, false);
    });
    
    it('should reject unknown configuration keys', () => {
      const result = validateConfigValue('unknown_key', 123);
      assert.strictEqual(result.valid, false);
      assert.ok(result.error.includes('Unknown configuration key'));
    });
    
    it('should reject invalid types', () => {
      const result1 = validateConfigValue('decay_rate', 'not a number');
      assert.strictEqual(result1.valid, false);
      
      const result2 = validateConfigValue('llm_model', 123);
      assert.strictEqual(result2.valid, false);
    });
    
    it('should validate engagement weights sum to 1.0', () => {
      const config1 = {
        ...DEFAULT_CONFIG,
        engagement_weight_dwell: 0.4,
        engagement_weight_scroll: 0.3,
        engagement_weight_revisit: 0.3
      };
      
      const result1 = validateConfig(config1);
      assert.strictEqual(result1.valid, true);
      
      const config2 = {
        ...DEFAULT_CONFIG,
        engagement_weight_dwell: 0.5,
        engagement_weight_scroll: 0.3,
        engagement_weight_revisit: 0.3
      };
      
      const result2 = validateConfig(config2);
      assert.strictEqual(result2.valid, false);
      assert.ok(result2.errors.some(e => e.includes('Engagement weights')));
    });
    
    it('should validate hybrid retrieval weights sum to 1.0', () => {
      const config1 = {
        ...DEFAULT_CONFIG,
        hybrid_retrieval_semantic_weight: 0.6,
        hybrid_retrieval_associative_weight: 0.4
      };
      
      const result1 = validateConfig(config1);
      assert.strictEqual(result1.valid, true);
      
      const config2 = {
        ...DEFAULT_CONFIG,
        hybrid_retrieval_semantic_weight: 0.7,
        hybrid_retrieval_associative_weight: 0.4
      };
      
      const result2 = validateConfig(config2);
      assert.strictEqual(result2.valid, false);
      assert.ok(result2.errors.some(e => e.includes('Hybrid retrieval weights')));
    });
    
  });
  
  // ============================================================================
  // CONFIGURATION UPDATE TESTS (Requirement 30.6)
  // ============================================================================
  
  describe('Configuration Updates', () => {
    
    it('should update valid configuration values', () => {
      const updates = {
        decay_rate: 0.03,
        session_timeout: 2400
      };
      
      const result = updateConfig(updates);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.config.decay_rate, 0.03);
      assert.strictEqual(result.config.session_timeout, 2400);
    });
    
    it('should reject invalid configuration updates', () => {
      const updates = {
        decay_rate: 0.5  // Out of range
      };
      
      const result = updateConfig(updates);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.errors.length > 0);
    });
    
    it('should reject updates that break weight constraints', () => {
      const updates = {
        engagement_weight_dwell: 0.5,
        engagement_weight_scroll: 0.5,
        engagement_weight_revisit: 0.5
      };
      
      const result = updateConfig(updates);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.errors.some(e => e.includes('Engagement weights')));
    });
    
    it('should allow partial updates', () => {
      const updates = {
        llm_temperature: 0.5
      };
      
      const result = updateConfig(updates);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.config.llm_temperature, 0.5);
      
      // Other values should remain unchanged
      assert.strictEqual(result.config.decay_rate, result.config.decay_rate);
    });
    
    it('should preserve configuration after failed update', () => {
      const originalConfig = getConfig();
      
      const invalidUpdates = {
        decay_rate: 999  // Invalid
      };
      
      const result = updateConfig(invalidUpdates);
      
      assert.strictEqual(result.success, false);
      
      const currentConfig = getConfig();
      assert.strictEqual(currentConfig.decay_rate, originalConfig.decay_rate);
    });
    
  });
  
  // ============================================================================
  // CONFIGURATION PERSISTENCE TESTS
  // ============================================================================
  
  describe('Configuration Persistence', () => {
    
    it('should get current configuration', () => {
      const config = getConfig();
      
      assert.ok(config);
      assert.ok(typeof config === 'object');
      assert.ok(config.decay_rate !== undefined);
      assert.ok(config.session_timeout !== undefined);
    });
    
    it('should reset configuration to defaults', () => {
      // Make some changes
      updateConfig({ decay_rate: 0.05 });
      
      // Reset
      const config = resetConfig();
      
      assert.strictEqual(config.decay_rate, DEFAULT_CONFIG.decay_rate);
      assert.strictEqual(config.session_timeout, DEFAULT_CONFIG.session_timeout);
    });
    
    it('should maintain configuration consistency', () => {
      const config1 = getConfig();
      const config2 = getConfig();
      
      assert.deepStrictEqual(config1, config2);
    });
    
  });
  
  // ============================================================================
  // EDGE CASES
  // ============================================================================
  
  describe('Edge Cases', () => {
    
    it('should handle empty updates', () => {
      const result = updateConfig({});
      
      assert.strictEqual(result.success, true);
    });
    
    it('should handle NaN values', () => {
      const result = validateConfigValue('decay_rate', NaN);
      
      assert.strictEqual(result.valid, false);
    });
    
    it('should handle null values', () => {
      const result = validateConfigValue('decay_rate', null);
      
      assert.strictEqual(result.valid, false);
    });
    
    it('should handle undefined values', () => {
      const result = validateConfigValue('decay_rate', undefined);
      
      assert.strictEqual(result.valid, false);
    });
    
    it('should validate boundary values', () => {
      // Test minimum boundary
      const result1 = validateConfigValue('decay_rate', 0.001);
      assert.strictEqual(result1.valid, true);
      
      // Test maximum boundary
      const result2 = validateConfigValue('decay_rate', 0.1);
      assert.strictEqual(result2.valid, true);
      
      // Test just below minimum
      const result3 = validateConfigValue('decay_rate', 0.0009);
      assert.strictEqual(result3.valid, false);
      
      // Test just above maximum
      const result4 = validateConfigValue('decay_rate', 0.101);
      assert.strictEqual(result4.valid, false);
    });
    
  });
  
});
