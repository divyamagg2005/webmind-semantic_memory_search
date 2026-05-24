/**
 * Engagement Score and Memory Strength Calculation Module
 * 
 * Implements formulas for calculating engagement scores and memory strength
 * based on user interaction metrics.
 * 
 * Requirements: 4.4, 4.6, 5.6, 5.7, 6.4, 6.5, 18.2, 20.1, 20.2, 20.4, 20.5
 */

/**
 * Default engagement weights
 */
const DEFAULT_WEIGHTS = {
  dwellTime: 0.4,
  scrollDepth: 0.3,
  revisitCount: 0.3
};

/**
 * Normalize dwell time to 0-1 range
 * Maximum dwell time is 300 seconds (5 minutes)
 * 
 * Formula: min(dwellTime / 300000, 1.0)
 * 
 * @param {number} dwellTimeMs - Dwell time in milliseconds
 * @returns {number} Normalized value (0-1)
 * 
 * Requirement 4.4: Implement dwell time normalization (max 300 seconds)
 */
function normalizeDwellTime(dwellTimeMs) {
  if (typeof dwellTimeMs !== 'number' || dwellTimeMs < 0) {
    return 0;
  }
  
  const MAX_DWELL_MS = 300000; // 5 minutes
  return Math.min(dwellTimeMs / MAX_DWELL_MS, 1.0);
}

/**
 * Convert scroll depth percentage to 0-1 range
 * 
 * Formula: scrollDepth / 100
 * 
 * @param {number} scrollDepthPercent - Scroll depth as percentage (0-100)
 * @returns {number} Normalized value (0-1)
 * 
 * Requirement 6.4: Implement scroll depth percentage conversion
 */
function normalizeScrollDepth(scrollDepthPercent) {
  if (typeof scrollDepthPercent !== 'number' || scrollDepthPercent < 0) {
    return 0;
  }
  
  // Clamp to 0-100 range and convert to 0-1
  const clamped = Math.min(Math.max(scrollDepthPercent, 0), 100);
  return clamped / 100;
}

/**
 * Apply logarithmic scaling to revisit count
 * 
 * Formula: log(1 + revisitCount) / log(1 + 100)
 * This scales revisit counts logarithmically, with 100 visits = 1.0
 * 
 * @param {number} revisitCount - Number of revisits
 * @returns {number} Scaled value (0-1)
 * 
 * Requirement 5.6: Implement logarithmic revisit count scaling
 */
function scaleRevisitCount(revisitCount) {
  if (typeof revisitCount !== 'number' || revisitCount < 0) {
    return 0;
  }
  
  const MAX_REVISITS = 100;
  return Math.log(1 + revisitCount) / Math.log(1 + MAX_REVISITS);
}

/**
 * Calculate engagement score from metrics
 * 
 * Formula: 
 *   (normalize(dwellTime) * 0.4) +
 *   (scrollDepth / 100 * 0.3) +
 *   (log(1 + revisitCount) * 0.3)
 * 
 * @param {Object} metrics - Engagement metrics
 * @param {number} metrics.dwellTime - Dwell time in milliseconds
 * @param {number} metrics.scrollDepth - Scroll depth percentage (0-100)
 * @param {number} metrics.revisitCount - Number of revisits
 * @param {Object} weights - Optional custom weights
 * @returns {number} Engagement score (0-1)
 * 
 * Requirements: 4.4, 5.7, 6.5
 */
function calculateEngagementScore(metrics, weights = DEFAULT_WEIGHTS) {
  const {
    dwellTime = 0,
    scrollDepth = 0,
    revisitCount = 0
  } = metrics;

  const normalizedDwell = normalizeDwellTime(dwellTime);
  const normalizedScroll = normalizeScrollDepth(scrollDepth);
  const scaledRevisit = scaleRevisitCount(revisitCount);

  const score = 
    (normalizedDwell * weights.dwellTime) +
    (normalizedScroll * weights.scrollDepth) +
    (scaledRevisit * weights.revisitCount);

  // Ensure score is in valid range
  return Math.min(Math.max(score, 0), 1.0);
}

/**
 * Calculate revisit boost for memory strength
 * 
 * Formula: min(log(1 + uniqueVisitDates) * 0.1, 1.0)
 * 
 * @param {number} uniqueVisitDates - Number of unique dates visited
 * @returns {number} Revisit boost (0-1)
 * 
 * Requirement 20.2: Add revisit boost (log-scaled, capped at 1.0)
 */
function calculateRevisitBoost(uniqueVisitDates) {
  if (typeof uniqueVisitDates !== 'number' || uniqueVisitDates < 0) {
    return 0;
  }
  
  const boost = Math.log(1 + uniqueVisitDates) * 0.1;
  return Math.min(boost, 1.0);
}

/**
 * Calculate memory strength from engagement and signals
 * 
 * Formula:
 *   base_strength = engagement_score * 0.4 + association_boost
 *   bookmark_multiplier = is_bookmarked ? 2.0 : 1.0
 *   revisit_boost = min(log(1 + unique_visit_dates) * 0.1, 1.0)
 *   memory_strength = (base_strength + revisit_boost) * bookmark_multiplier
 * 
 * @param {Object} params - Calculation parameters
 * @param {number} params.engagementScore - Engagement score (0-1)
 * @param {boolean} params.isBookmarked - Whether page is bookmarked
 * @param {number} params.uniqueVisitDates - Number of unique dates visited
 * @param {number} params.associationBoost - Boost from concept associations (default: 0)
 * @returns {number} Memory strength (0-2+)
 * 
 * Requirements: 18.2, 20.1, 20.4, 20.5
 */
function calculateMemoryStrength(params) {
  const {
    engagementScore = 0,
    isBookmarked = false,
    uniqueVisitDates = 0,
    associationBoost = 0
  } = params;

  // Validate inputs
  if (typeof engagementScore !== 'number' || engagementScore < 0) {
    throw new Error('Invalid engagement score');
  }

  // Calculate base strength
  const baseStrength = (engagementScore * 0.4) + associationBoost;

  // Apply bookmark multiplier
  const bookmarkMultiplier = isBookmarked ? 2.0 : 1.0;

  // Calculate revisit boost
  const revisitBoost = calculateRevisitBoost(uniqueVisitDates);

  // Calculate final memory strength
  const memoryStrength = (baseStrength + revisitBoost) * bookmarkMultiplier;

  // Ensure non-negative
  return Math.max(memoryStrength, 0);
}

/**
 * Get engagement weights from configuration
 * 
 * @param {Object} config - Configuration object
 * @returns {Object} Engagement weights
 */
function getEngagementWeights(config = {}) {
  return {
    dwellTime: config.engagement_weight_dwell || DEFAULT_WEIGHTS.dwellTime,
    scrollDepth: config.engagement_weight_scroll || DEFAULT_WEIGHTS.scrollDepth,
    revisitCount: config.engagement_weight_revisit || DEFAULT_WEIGHTS.revisitCount
  };
}

module.exports = {
  normalizeDwellTime,
  normalizeScrollDepth,
  scaleRevisitCount,
  calculateEngagementScore,
  calculateRevisitBoost,
  calculateMemoryStrength,
  getEngagementWeights,
  DEFAULT_WEIGHTS
};
