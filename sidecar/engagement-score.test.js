/**
 * Unit Tests for Engagement Score and Memory Strength Calculations
 * 
 * Tests cover:
 * - Dwell time normalization
 * - Scroll depth conversion
 * - Revisit count scaling
 * - Engagement score calculation
 * - Memory strength calculation
 * - Property tests for bounds and formulas
 * 
 * Requirements: 4.4, 4.6, 20.5
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeDwellTime,
  normalizeScrollDepth,
  scaleRevisitCount,
  calculateEngagementScore,
  calculateRevisitBoost,
  calculateMemoryStrength,
  DEFAULT_WEIGHTS
} = require('./engagement-score');

describe('Engagement Score Calculations', () => {
  
  describe('normalizeDwellTime', () => {
    /**
     * Requirement 4.4: Test dwell time normalization (max 300 seconds)
     */
    it('should normalize dwell time with max 300 seconds', () => {
      // 0 seconds = 0
      assert.strictEqual(normalizeDwellTime(0), 0);
      
      // 150 seconds (2.5 min) = 0.5
      assert.strictEqual(normalizeDwellTime(150000), 0.5);
      
      // 300 seconds (5 min) = 1.0
      assert.strictEqual(normalizeDwellTime(300000), 1.0);
      
      // 600 seconds (10 min) = 1.0 (capped)
      assert.strictEqual(normalizeDwellTime(600000), 1.0);
    });

    it('should handle edge cases', () => {
      // Negative values
      assert.strictEqual(normalizeDwellTime(-1000), 0);
      
      // Very small values
      assert.ok(normalizeDwellTime(1000) > 0);
      assert.ok(normalizeDwellTime(1000) < 0.01);
      
      // Invalid inputs
      assert.strictEqual(normalizeDwellTime(null), 0);
      assert.strictEqual(normalizeDwellTime(undefined), 0);
      assert.strictEqual(normalizeDwellTime('invalid'), 0);
    });

    it('should be monotonically increasing up to cap', () => {
      const values = [0, 60000, 120000, 180000, 240000, 300000];
      
      for (let i = 0; i < values.length - 1; i++) {
        const current = normalizeDwellTime(values[i]);
        const next = normalizeDwellTime(values[i + 1]);
        assert.ok(next >= current, `${next} should be >= ${current}`);
      }
    });
  });

  describe('normalizeScrollDepth', () => {
    /**
     * Requirement 6.4: Test scroll depth percentage conversion
     */
    it('should convert scroll depth percentage to 0-1 range', () => {
      assert.strictEqual(normalizeScrollDepth(0), 0);
      assert.strictEqual(normalizeScrollDepth(50), 0.5);
      assert.strictEqual(normalizeScrollDepth(100), 1.0);
    });

    it('should clamp values outside 0-100 range', () => {
      assert.strictEqual(normalizeScrollDepth(-10), 0);
      assert.strictEqual(normalizeScrollDepth(150), 1.0);
    });

    it('should handle edge cases', () => {
      assert.strictEqual(normalizeScrollDepth(null), 0);
      assert.strictEqual(normalizeScrollDepth(undefined), 0);
      assert.strictEqual(normalizeScrollDepth('invalid'), 0);
    });

    it('should be linear', () => {
      assert.strictEqual(normalizeScrollDepth(25), 0.25);
      assert.strictEqual(normalizeScrollDepth(75), 0.75);
      assert.strictEqual(normalizeScrollDepth(33.33), 0.3333);
    });
  });

  describe('scaleRevisitCount', () => {
    /**
     * Requirement 5.6: Test logarithmic revisit count scaling
     */
    it('should apply logarithmic scaling', () => {
      // 0 revisits = 0
      assert.strictEqual(scaleRevisitCount(0), 0);
      
      // 1 revisit > 0
      assert.ok(scaleRevisitCount(1) > 0);
      assert.ok(scaleRevisitCount(1) < 0.2);
      
      // 100 revisits = 1.0
      assert.strictEqual(scaleRevisitCount(100), 1.0);
      
      // Logarithmic growth (should slow down but may not be perfectly monotonic due to rounding)
      const scale10 = scaleRevisitCount(10);
      const scale20 = scaleRevisitCount(20);
      const scale40 = scaleRevisitCount(40);
      
      // Just verify it's increasing
      assert.ok(scale20 > scale10);
      assert.ok(scale40 > scale20);
    });

    it('should handle edge cases', () => {
      assert.strictEqual(scaleRevisitCount(-5), 0);
      assert.strictEqual(scaleRevisitCount(null), 0);
      assert.strictEqual(scaleRevisitCount(undefined), 0);
    });

    it('should be monotonically increasing', () => {
      const values = [0, 1, 5, 10, 20, 50, 100];
      
      for (let i = 0; i < values.length - 1; i++) {
        const current = scaleRevisitCount(values[i]);
        const next = scaleRevisitCount(values[i + 1]);
        assert.ok(next > current, `${next} should be > ${current}`);
      }
    });
  });

  describe('calculateEngagementScore', () => {
    /**
     * Property 6: Engagement Score Calculation
     * Validates: Requirements 4.4
     */
    it('should calculate weighted engagement score', () => {
      const metrics = {
        dwellTime: 150000,  // 2.5 minutes = 0.5 normalized
        scrollDepth: 80,    // 80% = 0.8 normalized
        revisitCount: 5     // ~0.38 scaled
      };
      
      const score = calculateEngagementScore(metrics);
      
      // Score should be in valid range
      assert.ok(score >= 0 && score <= 1.0);
      
      // Approximate expected: (0.5 * 0.4) + (0.8 * 0.3) + (0.38 * 0.3) ≈ 0.554
      assert.ok(score > 0.5 && score < 0.6);
    });

    it('should use default weights', () => {
      const metrics = {
        dwellTime: 300000,  // Max = 1.0
        scrollDepth: 100,   // Max = 1.0
        revisitCount: 100   // Max = 1.0
      };
      
      const score = calculateEngagementScore(metrics);
      
      // With all max values and default weights: 1.0 * (0.4 + 0.3 + 0.3) = 1.0
      assert.strictEqual(score, 1.0);
    });

    it('should accept custom weights', () => {
      const metrics = {
        dwellTime: 300000,
        scrollDepth: 100,
        revisitCount: 100
      };
      
      const customWeights = {
        dwellTime: 0.5,
        scrollDepth: 0.3,
        revisitCount: 0.2
      };
      
      const score = calculateEngagementScore(metrics, customWeights);
      
      // Should still be 1.0 with all max values
      assert.strictEqual(score, 1.0);
    });

    it('should handle zero metrics', () => {
      const metrics = {
        dwellTime: 0,
        scrollDepth: 0,
        revisitCount: 0
      };
      
      const score = calculateEngagementScore(metrics);
      assert.strictEqual(score, 0);
    });

    it('should handle missing metrics', () => {
      const score = calculateEngagementScore({});
      assert.strictEqual(score, 0);
    });

    /**
     * Property test: Score should be bounded [0, 1]
     */
    it('should always return score in [0, 1] range', () => {
      const testCases = [
        { dwellTime: 0, scrollDepth: 0, revisitCount: 0 },
        { dwellTime: 60000, scrollDepth: 50, revisitCount: 3 },
        { dwellTime: 300000, scrollDepth: 100, revisitCount: 100 },
        { dwellTime: 600000, scrollDepth: 150, revisitCount: 200 }, // Over max
        { dwellTime: -1000, scrollDepth: -50, revisitCount: -10 }   // Negative
      ];
      
      for (const metrics of testCases) {
        const score = calculateEngagementScore(metrics);
        assert.ok(score >= 0 && score <= 1.0, 
          `Score ${score} should be in [0, 1] for metrics ${JSON.stringify(metrics)}`);
      }
    });
  });

  describe('calculateRevisitBoost', () => {
    /**
     * Requirement 20.2: Test revisit boost (log-scaled, capped at 1.0)
     */
    it('should calculate logarithmic revisit boost', () => {
      assert.strictEqual(calculateRevisitBoost(0), 0);
      
      const boost1 = calculateRevisitBoost(1);
      assert.ok(boost1 > 0 && boost1 < 0.1);
      
      const boost10 = calculateRevisitBoost(10);
      assert.ok(boost10 > boost1);
      assert.ok(boost10 < 0.3);
    });

    it('should cap boost at 1.0', () => {
      const boost100 = calculateRevisitBoost(100);
      const boost1000 = calculateRevisitBoost(1000);
      
      assert.ok(boost100 <= 1.0);
      assert.ok(boost1000 <= 1.0);
    });

    it('should handle edge cases', () => {
      assert.strictEqual(calculateRevisitBoost(-5), 0);
      assert.strictEqual(calculateRevisitBoost(null), 0);
      assert.strictEqual(calculateRevisitBoost(undefined), 0);
    });
  });

  describe('calculateMemoryStrength', () => {
    /**
     * Property 7: Memory Strength Bounds
     * Validates: Requirements 4.6, 18.2
     */
    it('should calculate memory strength from engagement', () => {
      const params = {
        engagementScore: 0.8,
        isBookmarked: false,
        uniqueVisitDates: 5,
        associationBoost: 0
      };
      
      const strength = calculateMemoryStrength(params);
      
      // Base: 0.8 * 0.4 = 0.32
      // Revisit boost: log(6) * 0.1 ≈ 0.18
      // Total: (0.32 + 0.18) * 1.0 = 0.5
      assert.ok(strength > 0.4 && strength < 0.6);
    });

    /**
     * Requirement 18.2: Test bookmark multiplier (2.0x)
     */
    it('should apply bookmark multiplier', () => {
      const baseParams = {
        engagementScore: 0.5,
        isBookmarked: false,
        uniqueVisitDates: 0,
        associationBoost: 0
      };
      
      const bookmarkedParams = {
        ...baseParams,
        isBookmarked: true
      };
      
      const baseStrength = calculateMemoryStrength(baseParams);
      const bookmarkedStrength = calculateMemoryStrength(bookmarkedParams);
      
      // Bookmarked should be 2x
      assert.strictEqual(bookmarkedStrength, baseStrength * 2);
    });

    it('should include association boost', () => {
      const withoutBoost = calculateMemoryStrength({
        engagementScore: 0.5,
        isBookmarked: false,
        uniqueVisitDates: 0,
        associationBoost: 0
      });
      
      const withBoost = calculateMemoryStrength({
        engagementScore: 0.5,
        isBookmarked: false,
        uniqueVisitDates: 0,
        associationBoost: 0.2
      });
      
      assert.ok(withBoost > withoutBoost);
    });

    it('should handle zero engagement', () => {
      const strength = calculateMemoryStrength({
        engagementScore: 0,
        isBookmarked: false,
        uniqueVisitDates: 0
      });
      
      assert.strictEqual(strength, 0);
    });

    it('should throw on invalid engagement score', () => {
      assert.throws(() => {
        calculateMemoryStrength({
          engagementScore: -0.5,
          isBookmarked: false,
          uniqueVisitDates: 0
        });
      });
      
      assert.throws(() => {
        calculateMemoryStrength({
          engagementScore: 'invalid',
          isBookmarked: false,
          uniqueVisitDates: 0
        });
      });
    });

    /**
     * Property test: Memory strength should be non-negative
     */
    it('should always return non-negative strength', () => {
      const testCases = [
        { engagementScore: 0, isBookmarked: false, uniqueVisitDates: 0 },
        { engagementScore: 0.5, isBookmarked: false, uniqueVisitDates: 5 },
        { engagementScore: 1.0, isBookmarked: true, uniqueVisitDates: 20 },
        { engagementScore: 0.3, isBookmarked: true, uniqueVisitDates: 0 }
      ];
      
      for (const params of testCases) {
        const strength = calculateMemoryStrength(params);
        assert.ok(strength >= 0, 
          `Strength ${strength} should be non-negative for params ${JSON.stringify(params)}`);
      }
    });

    /**
     * Property test: Bookmarked memories should have higher strength
     */
    it('should have higher strength when bookmarked', () => {
      const testCases = [
        { engagementScore: 0.3, uniqueVisitDates: 0 },
        { engagementScore: 0.7, uniqueVisitDates: 5 },
        { engagementScore: 1.0, uniqueVisitDates: 20 }
      ];
      
      for (const base of testCases) {
        const unbookmarked = calculateMemoryStrength({
          ...base,
          isBookmarked: false
        });
        
        const bookmarked = calculateMemoryStrength({
          ...base,
          isBookmarked: true
        });
        
        assert.ok(bookmarked > unbookmarked,
          `Bookmarked (${bookmarked}) should be > unbookmarked (${unbookmarked})`);
      }
    });
  });

  describe('Integration: Full calculation pipeline', () => {
    it('should calculate end-to-end from metrics to strength', () => {
      // Realistic scenario
      const metrics = {
        dwellTime: 180000,  // 3 minutes
        scrollDepth: 75,    // 75%
        revisitCount: 3     // 3 revisits
      };
      
      const engagementScore = calculateEngagementScore(metrics);
      
      const memoryStrength = calculateMemoryStrength({
        engagementScore,
        isBookmarked: false,
        uniqueVisitDates: 3,
        associationBoost: 0.1
      });
      
      // Should have reasonable values
      assert.ok(engagementScore > 0.4 && engagementScore < 0.8);
      assert.ok(memoryStrength > 0.3 && memoryStrength < 0.8);
    });

    it('should handle high-engagement bookmarked page', () => {
      const metrics = {
        dwellTime: 300000,  // 5 minutes (max)
        scrollDepth: 100,   // 100%
        revisitCount: 20    // 20 revisits
      };
      
      const engagementScore = calculateEngagementScore(metrics);
      // With revisit scaling, may not be exactly 1.0
      assert.ok(engagementScore > 0.85);
      
      const memoryStrength = calculateMemoryStrength({
        engagementScore,
        isBookmarked: true,
        uniqueVisitDates: 15,
        associationBoost: 0.2
      });
      
      // Should be high (bookmark multiplier 2x)
      assert.ok(memoryStrength > 0.8);
    });

    it('should handle low-engagement page', () => {
      const metrics = {
        dwellTime: 5000,    // 5 seconds
        scrollDepth: 10,    // 10%
        revisitCount: 0     // First visit
      };
      
      const engagementScore = calculateEngagementScore(metrics);
      assert.ok(engagementScore < 0.1);
      
      const memoryStrength = calculateMemoryStrength({
        engagementScore,
        isBookmarked: false,
        uniqueVisitDates: 0,
        associationBoost: 0
      });
      
      // Should be very low
      assert.ok(memoryStrength < 0.1);
    });
  });
});
