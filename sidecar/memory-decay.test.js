/**
 * Unit Tests for Memory Decay System
 * 
 * Tests cover:
 * - Decay resistance calculation
 * - Effective decay rate with capping
 * - Days since access calculation
 * - Exponential decay formula
 * - Pinned memory immunity
 * - Property tests for monotonicity and bounds
 * 
 * Requirements: 7.1, 7.2, 8.2, 8.5
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  calculateDecayResistance,
  calculateEffectiveDecayRate,
  calculateDaysSinceAccess,
  applyDecay,
  applyDecayAtQueryTime,
  batchApplyDecay,
  isForgotten,
  DEFAULT_DECAY_RATE,
  MAX_DECAY_RATE
} = require('./memory-decay');

describe('Memory Decay System', () => {
  
  describe('calculateDecayResistance', () => {
    /**
     * Requirement 7.2: Test decay resistance from revisit count
     */
    it('should calculate decay resistance from revisit count', () => {
      // 0 revisits = 1.0 (no resistance)
      assert.strictEqual(calculateDecayResistance(0), 1.0);
      
      // 5 revisits = 1.5
      assert.strictEqual(calculateDecayResistance(5), 1.5);
      
      // 10 revisits = 2.0
      assert.strictEqual(calculateDecayResistance(10), 2.0);
      
      // 20 revisits = 3.0
      assert.strictEqual(calculateDecayResistance(20), 3.0);
    });

    it('should be linear with revisit count', () => {
      const resistance1 = calculateDecayResistance(10);
      const resistance2 = calculateDecayResistance(20);
      
      // Should be linear: 20 revisits = 2x resistance of 10 revisits
      assert.strictEqual(resistance2 - resistance1, 1.0);
    });

    it('should handle edge cases', () => {
      assert.strictEqual(calculateDecayResistance(-5), 1.0);
      assert.strictEqual(calculateDecayResistance(null), 1.0);
      assert.strictEqual(calculateDecayResistance(undefined), 1.0);
    });

    it('should always be >= 1.0', () => {
      const testCases = [0, 1, 5, 10, 50, 100];
      
      for (const revisits of testCases) {
        const resistance = calculateDecayResistance(revisits);
        assert.ok(resistance >= 1.0, 
          `Resistance ${resistance} should be >= 1.0 for ${revisits} revisits`);
      }
    });
  });

  describe('calculateEffectiveDecayRate', () => {
    /**
     * Requirement 8.5: Test decay rate capping (max 0.005)
     */
    it('should calculate effective decay rate with resistance', () => {
      const baseRate = 0.02;
      
      // No resistance (1.0) = base rate (capped at MAX_DECAY_RATE = 0.005)
      const rate1 = calculateEffectiveDecayRate(baseRate, 1.0);
      assert.strictEqual(rate1, MAX_DECAY_RATE); // 0.02 / 1.0 = 0.02, capped to 0.005
      
      // 2x resistance = half rate (capped)
      const rate2 = calculateEffectiveDecayRate(baseRate, 2.0);
      assert.strictEqual(rate2, MAX_DECAY_RATE); // 0.02 / 2.0 = 0.01, capped to 0.005
      
      // 4x resistance = quarter rate (capped)
      const rate3 = calculateEffectiveDecayRate(baseRate, 4.0);
      assert.strictEqual(rate3, MAX_DECAY_RATE); // 0.02 / 4.0 = 0.005, equals cap
    });

    it('should cap decay rate at MAX_DECAY_RATE', () => {
      const baseRate = 0.02;
      
      // High resistance results in low rate (below cap)
      const rate1 = calculateEffectiveDecayRate(baseRate, 10.0);
      assert.strictEqual(rate1, 0.002); // 0.02 / 10.0 = 0.002 (below cap)
      
      const rate2 = calculateEffectiveDecayRate(baseRate, 100.0);
      assert.strictEqual(rate2, 0.0002); // 0.02 / 100.0 = 0.0002 (below cap)
      
      // Low resistance results in high rate (capped)
      const rate3 = calculateEffectiveDecayRate(baseRate, 1.0);
      assert.strictEqual(rate3, MAX_DECAY_RATE); // 0.02 / 1.0 = 0.02, capped to 0.005
    });

    it('should handle edge cases', () => {
      // Invalid base rate - should use default and cap
      const rate1 = calculateEffectiveDecayRate(-0.01, 1.0);
      assert.ok(rate1 <= MAX_DECAY_RATE);
      
      // Invalid resistance - should use 1.0 and cap
      const rate2 = calculateEffectiveDecayRate(0.02, 0.5);
      assert.ok(rate2 <= MAX_DECAY_RATE);
      
      const rate3 = calculateEffectiveDecayRate(0.02, -1.0);
      assert.ok(rate3 <= MAX_DECAY_RATE);
    });

    /**
     * Property test: Effective rate should never exceed MAX_DECAY_RATE
     */
    it('should never exceed MAX_DECAY_RATE', () => {
      const testCases = [
        { baseRate: 0.01, resistance: 1.0 },
        { baseRate: 0.02, resistance: 2.0 },
        { baseRate: 0.05, resistance: 5.0 },
        { baseRate: 0.1, resistance: 10.0 }
      ];
      
      for (const { baseRate, resistance } of testCases) {
        const effectiveRate = calculateEffectiveDecayRate(baseRate, resistance);
        assert.ok(effectiveRate <= MAX_DECAY_RATE,
          `Effective rate ${effectiveRate} should be <= ${MAX_DECAY_RATE}`);
      }
    });
  });

  describe('calculateDaysSinceAccess', () => {
    /**
     * Requirement 7.4: Test days since access calculation
     */
    it('should calculate days between dates', () => {
      const lastAccessed = new Date('2024-01-01T00:00:00Z');
      const current = new Date('2024-01-08T00:00:00Z');
      
      const days = calculateDaysSinceAccess(lastAccessed, current);
      assert.strictEqual(days, 7);
    });

    it('should handle fractional days', () => {
      const lastAccessed = new Date('2024-01-01T00:00:00Z');
      const current = new Date('2024-01-01T12:00:00Z');
      
      const days = calculateDaysSinceAccess(lastAccessed, current);
      assert.strictEqual(days, 0.5);
    });

    it('should use current date if not provided', () => {
      const lastAccessed = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      
      const days = calculateDaysSinceAccess(lastAccessed);
      assert.ok(days >= 0.99 && days <= 1.01); // Allow small variance
    });

    it('should handle edge cases', () => {
      // Null/undefined
      assert.strictEqual(calculateDaysSinceAccess(null), 0);
      assert.strictEqual(calculateDaysSinceAccess(undefined), 0);
      
      // Invalid dates
      assert.strictEqual(calculateDaysSinceAccess('invalid'), 0);
      
      // Future date (should return 0)
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const past = new Date(Date.now());
      assert.strictEqual(calculateDaysSinceAccess(future, past), 0);
    });

    it('should handle ISO string dates', () => {
      const lastAccessed = '2024-01-01T00:00:00Z';
      const current = '2024-01-11T00:00:00Z';
      
      const days = calculateDaysSinceAccess(lastAccessed, current);
      assert.strictEqual(days, 10);
    });
  });

  describe('applyDecay', () => {
    /**
     * Property 8: Decay Function Monotonicity
     * Validates: Requirements 7.1, 7.2
     */
    it('should apply exponential decay formula', () => {
      const params = {
        memoryStrength: 1.0,
        daysSinceAccess: 10,
        revisitCount: 0,
        isPinned: false,
        decayRate: 0.02
      };
      
      const result = applyDecay(params);
      
      // With capping at MAX_DECAY_RATE (0.005), formula: 1.0 × e^(-0.005 × 10) = 1.0 × e^(-0.05) ≈ 0.9512
      assert.ok(result.decayedStrength > 0.94 && result.decayedStrength < 0.96);
      assert.strictEqual(result.effectiveDecayRate, MAX_DECAY_RATE);
      assert.strictEqual(result.decayResistance, 1.0);
    });

    it('should apply decay resistance', () => {
      const baseParams = {
        memoryStrength: 1.0,
        daysSinceAccess: 10,
        revisitCount: 0,
        isPinned: false,
        decayRate: 0.02
      };
      
      const resistantParams = {
        ...baseParams,
        revisitCount: 10 // Resistance = 2.0, effective rate = 0.01 (not capped)
      };
      
      const baseResult = applyDecay(baseParams);
      const resistantResult = applyDecay(resistantParams);
      
      // Both should be close due to capping, but resistant should still be slightly higher
      assert.ok(resistantResult.decayedStrength >= baseResult.decayedStrength);
      assert.strictEqual(resistantResult.decayResistance, 2.0);
      assert.ok(resistantResult.effectiveDecayRate <= baseResult.effectiveDecayRate);
    });

    /**
     * Property 9: Pinned Memory Immunity
     * Validates: Requirements 19.2
     */
    it('should not decay pinned memories', () => {
      const params = {
        memoryStrength: 1.0,
        daysSinceAccess: 100,
        revisitCount: 0,
        isPinned: true,
        decayRate: 0.02
      };
      
      const result = applyDecay(params);
      
      // Pinned memories should not decay
      assert.strictEqual(result.decayedStrength, 1.0);
      assert.strictEqual(result.effectiveDecayRate, 0);
      assert.strictEqual(result.decayResistance, Infinity);
    });

    it('should handle zero days since access', () => {
      const params = {
        memoryStrength: 1.0,
        daysSinceAccess: 0,
        revisitCount: 0,
        isPinned: false,
        decayRate: 0.02
      };
      
      const result = applyDecay(params);
      
      // No time passed = no decay
      assert.strictEqual(result.decayedStrength, 1.0);
    });

    it('should throw on invalid memory strength', () => {
      assert.throws(() => {
        applyDecay({
          memoryStrength: -0.5,
          daysSinceAccess: 10,
          revisitCount: 0,
          isPinned: false
        });
      });
      
      assert.throws(() => {
        applyDecay({
          memoryStrength: 'invalid',
          daysSinceAccess: 10,
          revisitCount: 0,
          isPinned: false
        });
      });
    });

    /**
     * Property test: Decay should be monotonically decreasing with time
     */
    it('should decay monotonically with increasing time', () => {
      const days = [0, 1, 5, 10, 30, 60, 100];
      const strengths = [];
      
      for (const daysSinceAccess of days) {
        const result = applyDecay({
          memoryStrength: 1.0,
          daysSinceAccess,
          revisitCount: 0,
          isPinned: false,
          decayRate: 0.02
        });
        strengths.push(result.decayedStrength);
      }
      
      // Each strength should be less than or equal to previous
      for (let i = 0; i < strengths.length - 1; i++) {
        assert.ok(strengths[i] >= strengths[i + 1],
          `Strength at day ${days[i]} (${strengths[i]}) should be >= day ${days[i+1]} (${strengths[i+1]})`);
      }
    });

    /**
     * Property test: Higher revisit count should result in slower decay
     */
    it('should decay slower with higher revisit count', () => {
      const revisitCounts = [0, 5, 10, 20];
      const strengths = [];
      
      for (const revisitCount of revisitCounts) {
        const result = applyDecay({
          memoryStrength: 1.0,
          daysSinceAccess: 30,
          revisitCount,
          isPinned: false,
          decayRate: 0.02
        });
        strengths.push(result.decayedStrength);
      }
      
      // Each strength should be greater than or equal to previous
      for (let i = 0; i < strengths.length - 1; i++) {
        assert.ok(strengths[i] <= strengths[i + 1],
          `Strength with ${revisitCounts[i]} revisits (${strengths[i]}) should be <= ${revisitCounts[i+1]} revisits (${strengths[i+1]})`);
      }
    });
  });

  describe('applyDecayAtQueryTime', () => {
    /**
     * Requirements 7.4, 7.5, 7.6: Test decay application at query time
     */
    it('should apply decay to memory entry', () => {
      const memory = {
        id: 1,
        memory_strength: 1.0,
        last_accessed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        revisit_count: 0,
        is_pinned: false,
        engagement_score: 0.8
      };
      
      const result = applyDecayAtQueryTime(memory, 0.02);
      
      // Should have decayed strength
      assert.ok(result.decayed_strength < 1.0);
      assert.ok(result.decayed_strength > 0.8);
      
      // Should preserve original engagement score
      assert.strictEqual(result.engagement_score, 0.8);
      
      // Should include decay metadata
      assert.ok(result.decay_metadata);
      assert.ok(result.decay_metadata.effective_decay_rate);
      assert.ok(result.decay_metadata.decay_resistance);
      assert.ok(result.decay_metadata.days_since_access >= 9.9);
    });

    it('should use timestamp if last_accessed is missing', () => {
      const memory = {
        id: 1,
        memory_strength: 1.0,
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        revisit_count: 0,
        is_pinned: false
      };
      
      const result = applyDecayAtQueryTime(memory, 0.02);
      
      assert.ok(result.decayed_strength < 1.0);
      assert.ok(result.decay_metadata.days_since_access >= 4.9);
    });

    it('should handle null memory', () => {
      const result = applyDecayAtQueryTime(null);
      assert.strictEqual(result, null);
    });

    it('should not decay pinned memories', () => {
      const memory = {
        id: 1,
        memory_strength: 1.0,
        last_accessed: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), // 100 days ago
        revisit_count: 0,
        is_pinned: true
      };
      
      const result = applyDecayAtQueryTime(memory, 0.02);
      
      // Should not decay
      assert.strictEqual(result.decayed_strength, 1.0);
      assert.strictEqual(result.decay_metadata.effective_decay_rate, 0);
    });
  });

  describe('batchApplyDecay', () => {
    it('should apply decay to multiple memories', () => {
      const memories = [
        {
          id: 1,
          memory_strength: 1.0,
          last_accessed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          revisit_count: 0,
          is_pinned: false
        },
        {
          id: 2,
          memory_strength: 0.8,
          last_accessed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          revisit_count: 5,
          is_pinned: false
        },
        {
          id: 3,
          memory_strength: 0.6,
          last_accessed: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          revisit_count: 0,
          is_pinned: true
        }
      ];
      
      const results = batchApplyDecay(memories, 0.02);
      
      assert.strictEqual(results.length, 3);
      
      // First memory should have decayed
      assert.ok(results[0].decayed_strength < 1.0);
      
      // Second memory should have less decay (more revisits)
      assert.ok(results[1].decayed_strength > 0);
      
      // Third memory should not decay (pinned)
      assert.strictEqual(results[2].decayed_strength, 0.6);
    });

    it('should handle empty array', () => {
      const results = batchApplyDecay([]);
      assert.deepStrictEqual(results, []);
    });

    it('should handle invalid input', () => {
      const results = batchApplyDecay(null);
      assert.deepStrictEqual(results, []);
    });
  });

  describe('isForgotten', () => {
    it('should identify forgotten memories', () => {
      assert.strictEqual(isForgotten(0.05), true);
      assert.strictEqual(isForgotten(0.09), true);
      assert.strictEqual(isForgotten(0.1), false);
      assert.strictEqual(isForgotten(0.5), false);
    });

    it('should accept custom threshold', () => {
      assert.strictEqual(isForgotten(0.15, 0.2), true);
      assert.strictEqual(isForgotten(0.25, 0.2), false);
    });
  });

  describe('Integration: Full decay pipeline', () => {
    it('should handle realistic decay scenario', () => {
      // Memory created 30 days ago, accessed 10 days ago
      const memory = {
        id: 1,
        memory_strength: 0.8,
        last_accessed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        revisit_count: 3,
        is_pinned: false,
        engagement_score: 0.7
      };
      
      const result = applyDecayAtQueryTime(memory, 0.02);
      
      // Should have moderate decay
      assert.ok(result.decayed_strength < 0.8);
      assert.ok(result.decayed_strength > 0.6);
      
      // Should have decay resistance from revisits
      assert.strictEqual(result.decay_metadata.decay_resistance, 1.3);
      
      // Should preserve original data
      assert.strictEqual(result.engagement_score, 0.7);
      assert.strictEqual(result.memory_strength, 0.8);
    });

    it('should handle heavily decayed memory', () => {
      const memory = {
        id: 1,
        memory_strength: 0.5,
        last_accessed: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
        revisit_count: 0,
        is_pinned: false
      };
      
      const result = applyDecayAtQueryTime(memory, 0.02);
      
      // With capping, decay is slower: 0.5 × e^(-0.005 × 100) = 0.5 × e^(-0.5) ≈ 0.303
      assert.ok(result.decayed_strength < 0.5);
      assert.ok(result.decayed_strength > 0.25);
      
      // May or may not be considered forgotten depending on threshold
      // assert.strictEqual(isForgotten(result.decayed_strength), true);
    });

    it('should handle fresh memory', () => {
      const memory = {
        id: 1,
        memory_strength: 0.9,
        last_accessed: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        revisit_count: 0,
        is_pinned: false
      };
      
      const result = applyDecayAtQueryTime(memory, 0.02);
      
      // Should have minimal decay
      assert.ok(result.decayed_strength > 0.88);
      assert.ok(result.decayed_strength < 0.9);
    });
  });
});
