/**
 * Memory Decay System
 * 
 * Implements exponential decay for memory strength based on time since last access.
 * Includes decay resistance from revisit patterns and special handling for pinned memories.
 * 
 * Requirements: 7.1, 7.2, 7.4, 7.5, 7.6, 8.2, 8.3, 8.4, 8.5
 */

/**
 * Default decay rate (per day)
 */
const DEFAULT_DECAY_RATE = 0.02;

/**
 * Maximum decay rate cap
 */
const MAX_DECAY_RATE = 0.005;

/**
 * Calculate decay resistance from revisit count
 * 
 * Formula: 1 + (0.1 * revisitCount)
 * 
 * Higher revisit counts increase resistance to decay.
 * 
 * @param {number} revisitCount - Number of times page was revisited
 * @returns {number} Decay resistance multiplier (>= 1.0)
 * 
 * Requirement 7.2: Calculate decay resistance from revisit count
 */
function calculateDecayResistance(revisitCount) {
  if (typeof revisitCount !== 'number' || revisitCount < 0) {
    return 1.0;
  }
  
  return 1.0 + (0.1 * revisitCount);
}

/**
 * Calculate effective decay rate with resistance and capping
 * 
 * Formula: min(decay_rate / decay_resistance, MAX_DECAY_RATE)
 * 
 * @param {number} baseDecayRate - Base decay rate
 * @param {number} decayResistance - Decay resistance multiplier
 * @returns {number} Effective decay rate (capped at 0.005)
 * 
 * Requirement 8.5: Apply decay rate capping (max 0.005)
 */
function calculateEffectiveDecayRate(baseDecayRate, decayResistance) {
  if (typeof baseDecayRate !== 'number' || baseDecayRate < 0) {
    baseDecayRate = DEFAULT_DECAY_RATE;
  }
  
  if (typeof decayResistance !== 'number' || decayResistance < 1.0) {
    decayResistance = 1.0;
  }
  
  const effectiveRate = baseDecayRate / decayResistance;
  return Math.min(effectiveRate, MAX_DECAY_RATE);
}

/**
 * Calculate days since last access
 * 
 * @param {string|Date} lastAccessedDate - Last accessed timestamp
 * @param {string|Date} currentDate - Current timestamp (default: now)
 * @returns {number} Days since last access
 * 
 * Requirement 7.4: Calculate days since last access
 */
function calculateDaysSinceAccess(lastAccessedDate, currentDate = new Date()) {
  if (!lastAccessedDate) {
    return 0;
  }
  
  const lastDate = new Date(lastAccessedDate);
  const nowDate = new Date(currentDate);
  
  if (isNaN(lastDate.getTime()) || isNaN(nowDate.getTime())) {
    return 0;
  }
  
  const diffMs = nowDate.getTime() - lastDate.getTime();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  
  return Math.max(diffDays, 0);
}

/**
 * Apply exponential decay to memory strength
 * 
 * Formula: strength × e^(-effective_rate × days)
 * 
 * For pinned memories, decay is zero (returns original strength).
 * 
 * @param {Object} params - Decay parameters
 * @param {number} params.memoryStrength - Original memory strength
 * @param {number} params.daysSinceAccess - Days since last access
 * @param {number} params.revisitCount - Number of revisits
 * @param {boolean} params.isPinned - Whether memory is pinned
 * @param {number} params.decayRate - Base decay rate (default: 0.02)
 * @returns {Object} Decay result with decayed strength and metadata
 * 
 * Requirements: 7.1, 8.2, 8.3, 8.4
 */
function applyDecay(params) {
  const {
    memoryStrength = 0,
    daysSinceAccess = 0,
    revisitCount = 0,
    isPinned = false,
    decayRate = DEFAULT_DECAY_RATE
  } = params;

  // Validate inputs
  if (typeof memoryStrength !== 'number' || memoryStrength < 0) {
    throw new Error('Invalid memory strength');
  }

  // Requirement 8.4: Handle pinned memories (zero decay)
  if (isPinned) {
    return {
      decayedStrength: memoryStrength,
      effectiveDecayRate: 0,
      decayResistance: Infinity,
      daysSinceAccess
    };
  }

  // Calculate decay resistance
  const decayResistance = calculateDecayResistance(revisitCount);

  // Calculate effective decay rate with capping
  const effectiveDecayRate = calculateEffectiveDecayRate(decayRate, decayResistance);

  // Requirement 7.1: Apply exponential decay formula
  // Formula: strength × e^(-rate × days)
  const decayFactor = Math.exp(-effectiveDecayRate * daysSinceAccess);
  const decayedStrength = memoryStrength * decayFactor;

  return {
    decayedStrength: Math.max(decayedStrength, 0),
    effectiveDecayRate,
    decayResistance,
    daysSinceAccess
  };
}

/**
 * Apply decay at query time
 * 
 * Calculates decayed strength without modifying the original memory entry.
 * The last_accessed timestamp should be updated separately when memory is retrieved.
 * 
 * @param {Object} memory - Memory entry from database
 * @param {number} memory.memory_strength - Original memory strength
 * @param {string} memory.last_accessed - Last accessed timestamp
 * @param {number} memory.revisit_count - Number of revisits
 * @param {boolean} memory.is_pinned - Whether memory is pinned
 * @param {number} decayRate - Base decay rate from config
 * @returns {Object} Memory with decayed strength
 * 
 * Requirements: 7.4, 7.5, 7.6
 */
function applyDecayAtQueryTime(memory, decayRate = DEFAULT_DECAY_RATE) {
  if (!memory) {
    return null;
  }

  // Calculate days since last access
  const daysSinceAccess = calculateDaysSinceAccess(
    memory.last_accessed || memory.timestamp
  );

  // Apply decay
  const decayResult = applyDecay({
    memoryStrength: memory.memory_strength || 0,
    daysSinceAccess,
    revisitCount: memory.revisit_count || 0,
    isPinned: memory.is_pinned || false,
    decayRate
  });

  // Return memory with decayed strength
  // Requirement 7.5: Preserve original engagement score
  return {
    ...memory,
    decayed_strength: decayResult.decayedStrength,
    decay_metadata: {
      effective_decay_rate: decayResult.effectiveDecayRate,
      decay_resistance: decayResult.decayResistance,
      days_since_access: decayResult.daysSinceAccess
    }
  };
}

/**
 * Batch apply decay to multiple memories
 * 
 * @param {Array<Object>} memories - Array of memory entries
 * @param {number} decayRate - Base decay rate from config
 * @returns {Array<Object>} Memories with decayed strengths
 */
function batchApplyDecay(memories, decayRate = DEFAULT_DECAY_RATE) {
  if (!Array.isArray(memories)) {
    return [];
  }

  return memories.map(memory => applyDecayAtQueryTime(memory, decayRate));
}

/**
 * Check if memory should be considered "forgotten"
 * 
 * A memory is considered forgotten if its decayed strength falls below a threshold.
 * 
 * @param {number} decayedStrength - Decayed memory strength
 * @param {number} threshold - Forgetting threshold (default: 0.1)
 * @returns {boolean} True if memory is forgotten
 */
function isForgotten(decayedStrength, threshold = 0.1) {
  return decayedStrength < threshold;
}

module.exports = {
  calculateDecayResistance,
  calculateEffectiveDecayRate,
  calculateDaysSinceAccess,
  applyDecay,
  applyDecayAtQueryTime,
  batchApplyDecay,
  isForgotten,
  DEFAULT_DECAY_RATE,
  MAX_DECAY_RATE
};
