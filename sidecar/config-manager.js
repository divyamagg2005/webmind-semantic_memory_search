/**
 * Configuration Management System
 * 
 * Manages application configuration with validation, persistence, and hot-reloading.
 * 
 * Requirements: 30.1-30.7
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

/**
 * Configuration schema with validation rules
 */
const CONFIG_SCHEMA = {
  decay_rate: {
    type: 'number',
    min: 0.001,
    max: 0.1,
    description: 'Base decay rate per day'
  },
  max_decay_rate: {
    type: 'number',
    min: 0.001,
    max: 0.01,
    description: 'Maximum decay rate cap'
  },
  engagement_weight_dwell: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Weight for dwell time in engagement score'
  },
  engagement_weight_scroll: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Weight for scroll depth in engagement score'
  },
  engagement_weight_revisit: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Weight for revisit count in engagement score'
  },
  session_timeout: {
    type: 'number',
    min: 300,
    max: 7200,
    description: 'Session timeout in seconds'
  },
  session_similarity_threshold: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Similarity threshold for session continuation'
  },
  min_cluster_size: {
    type: 'number',
    min: 2,
    max: 20,
    description: 'Minimum cluster size for HDBSCAN'
  },
  cluster_similarity_threshold: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Similarity threshold for cross-cluster associations'
  },
  max_dwell_time: {
    type: 'number',
    min: 60,
    max: 600,
    description: 'Maximum dwell time for normalization (seconds)'
  },
  bookmark_multiplier: {
    type: 'number',
    min: 1,
    max: 5,
    description: 'Memory strength multiplier for bookmarked pages'
  },
  hybrid_retrieval_semantic_limit: {
    type: 'number',
    min: 5,
    max: 100,
    description: 'Number of semantic search results'
  },
  hybrid_retrieval_max_hops: {
    type: 'number',
    min: 1,
    max: 5,
    description: 'Maximum hops for graph traversal'
  },
  hybrid_retrieval_min_association_strength: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Minimum association strength for retrieval'
  },
  hybrid_retrieval_semantic_weight: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Weight for semantic similarity in hybrid retrieval'
  },
  hybrid_retrieval_associative_weight: {
    type: 'number',
    min: 0,
    max: 1,
    description: 'Weight for associative similarity in hybrid retrieval'
  },
  llm_model: {
    type: 'string',
    allowed: [
      'llama3.2', 'llama3.2:1b', 'llama3.2:3b',
      'llama3.1', 'llama3.1:8b',
      'llama3', 'llama3:8b',
      'mistral', 'mixtral'
    ],
    description: 'LLM model for memory reconstruction / cluster labels (local Ollama tag; cloud uses AWS_LLAMA_MODEL)'
  },
  vision_model: {
    type: 'string',
    allowed: ['llava', 'llava:7b', 'llava:13b', 'llama3.2-vision', 'bakllava', 'moondream'],
    description: 'Ollama vision model used to caption page images'
  },
  image_caption_enabled: {
    type: 'boolean',
    description: 'When true, page images are captioned and embedded during ingest'
  },
  cloud_llama_enabled: {
    type: 'boolean',
    description: 'Route LLaMA text inference to the AWS endpoint (LLAMA_API_URL) instead of local Ollama'
  },
  cloud_llava_enabled: {
    type: 'boolean',
    description: 'Route LLaVA image captioning to the AWS endpoint (LLAVA_API_URL) instead of local Ollama'
  },
  max_images_per_page: {
    type: 'number',
    min: 0,
    max: 20,
    description: 'Maximum images captioned + embedded per page visit'
  },
  llm_temperature: {
    type: 'number',
    min: 0,
    max: 2,
    description: 'LLM temperature for generation'
  },
  llm_max_memories: {
    type: 'number',
    min: 1,
    max: 50,
    description: 'Maximum memories to include in LLM context'
  },
  cache_size: {
    type: 'number',
    min: 100,
    max: 10000,
    description: 'LRU cache size for memory entries'
  },
  batch_size: {
    type: 'number',
    min: 1,
    max: 100,
    description: 'Batch size for processing'
  },
  query_timeout: {
    type: 'number',
    min: 5000,
    max: 60000,
    description: 'Query timeout in milliseconds'
  },
  embedding_dimensions: {
    type: 'number',
    allowed: [768, 384, 1024],
    description: 'Embedding vector dimensions'
  }
};

/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
  decay_rate: 0.02,
  max_decay_rate: 0.005,
  engagement_weight_dwell: 0.4,
  engagement_weight_scroll: 0.3,
  engagement_weight_revisit: 0.3,
  session_timeout: 1800,
  session_similarity_threshold: 0.7,
  min_cluster_size: 3,
  cluster_similarity_threshold: 0.5,
  max_dwell_time: 300,
  bookmark_multiplier: 2.0,
  hybrid_retrieval_semantic_limit: 20,
  hybrid_retrieval_max_hops: 2,
  hybrid_retrieval_min_association_strength: 0.3,
  hybrid_retrieval_semantic_weight: 0.6,
  hybrid_retrieval_associative_weight: 0.4,
  llm_model: 'llama3.2',
  llm_temperature: 0.7,
  llm_max_memories: 10,
  cache_size: 1000,
  batch_size: 10,
  query_timeout: 15000,
  embedding_dimensions: 768,
  vision_model: 'llava',
  image_caption_enabled: true,
  max_images_per_page: 6,
  cloud_llama_enabled: false,
  cloud_llava_enabled: false
};

/**
 * Current configuration (in-memory)
 */
let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Configuration change listeners
 */
const listeners = [];

/**
 * Load configuration from file
 * 
 * @returns {Object} Loaded configuration
 * 
 * Requirement 30.1: Load configuration from JSON file
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const fileContent = fs.readFileSync(CONFIG_FILE, 'utf8');
      const loadedConfig = JSON.parse(fileContent);
      
      // Merge with defaults (in case new keys were added)
      currentConfig = { ...DEFAULT_CONFIG, ...loadedConfig };
      
      console.log('Configuration loaded from file');
      return currentConfig;
    } else {
      // Create default config file
      saveConfig(DEFAULT_CONFIG);
      console.log('Created default configuration file');
      return DEFAULT_CONFIG;
    }
  } catch (err) {
    console.error('Failed to load configuration:', err.message);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save configuration to file
 * 
 * @param {Object} config - Configuration to save
 * 
 * Requirement 30.7: Persist configuration to JSON file
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved to file');
  } catch (err) {
    console.error('Failed to save configuration:', err.message);
    throw err;
  }
}

/**
 * Validate a single configuration value
 * 
 * @param {string} key - Configuration key
 * @param {*} value - Value to validate
 * @returns {Object} Validation result { valid, error }
 * 
 * Requirements: 30.2, 30.3, 30.4, 30.5
 */
function validateConfigValue(key, value) {
  const schema = CONFIG_SCHEMA[key];
  
  if (!schema) {
    return {
      valid: false,
      error: `Unknown configuration key: ${key}`
    };
  }
  
  // Type validation
  if (schema.type === 'number') {
    if (typeof value !== 'number' || isNaN(value)) {
      return {
        valid: false,
        error: `${key} must be a number`
      };
    }
    
    // Range validation
    if (schema.min !== undefined && value < schema.min) {
      return {
        valid: false,
        error: `${key} must be >= ${schema.min}`
      };
    }
    
    if (schema.max !== undefined && value > schema.max) {
      return {
        valid: false,
        error: `${key} must be <= ${schema.max}`
      };
    }
    
    // Allowed values validation
    if (schema.allowed && !schema.allowed.includes(value)) {
      return {
        valid: false,
        error: `${key} must be one of: ${schema.allowed.join(', ')}`
      };
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return {
        valid: false,
        error: `${key} must be a string`
      };
    }
    
    // Allowed values validation
    if (schema.allowed && !schema.allowed.includes(value)) {
      return {
        valid: false,
        error: `${key} must be one of: ${schema.allowed.join(', ')}`
      };
    }
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return {
        valid: false,
        error: `${key} must be a boolean`
      };
    }
  }

  return { valid: true };
}

/**
 * Validate entire configuration object
 * 
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result { valid, errors }
 * 
 * Requirement 30.5: Validate configuration values
 */
function validateConfig(config) {
  const errors = [];
  
  for (const [key, value] of Object.entries(config)) {
    const result = validateConfigValue(key, value);
    if (!result.valid) {
      errors.push(result.error);
    }
  }
  
  // Validate engagement weights sum to 1.0
  const weightSum = 
    (config.engagement_weight_dwell || 0) +
    (config.engagement_weight_scroll || 0) +
    (config.engagement_weight_revisit || 0);
  
  if (Math.abs(weightSum - 1.0) > 0.01) {
    errors.push(`Engagement weights must sum to 1.0 (current: ${weightSum.toFixed(2)})`);
  }
  
  // Validate hybrid retrieval weights sum to 1.0
  const retrievalWeightSum =
    (config.hybrid_retrieval_semantic_weight || 0) +
    (config.hybrid_retrieval_associative_weight || 0);
  
  if (Math.abs(retrievalWeightSum - 1.0) > 0.01) {
    errors.push(`Hybrid retrieval weights must sum to 1.0 (current: ${retrievalWeightSum.toFixed(2)})`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get current configuration
 * 
 * @returns {Object} Current configuration
 * 
 * Requirement 30.6: GET /config endpoint
 */
function getConfig() {
  return { ...currentConfig };
}

/**
 * Get a specific configuration value
 * 
 * @param {string} key - Configuration key
 * @returns {*} Configuration value
 */
function getConfigValue(key) {
  return currentConfig[key];
}

/**
 * Update configuration
 * 
 * @param {Object} updates - Configuration updates
 * @returns {Object} Result { success, errors, config }
 * 
 * Requirement 30.6: PUT /config endpoint for updates
 */
function updateConfig(updates) {
  // Validate updates
  const validation = validateConfig({ ...currentConfig, ...updates });
  
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors
    };
  }
  
  // Apply updates
  const oldConfig = { ...currentConfig };
  currentConfig = { ...currentConfig, ...updates };
  
  // Persist to file
  try {
    saveConfig(currentConfig);
  } catch (err) {
    // Rollback on save failure
    currentConfig = oldConfig;
    return {
      success: false,
      errors: [`Failed to save configuration: ${err.message}`]
    };
  }
  
  // Notify listeners
  notifyListeners(updates);
  
  return {
    success: true,
    config: currentConfig
  };
}

/**
 * Reset configuration to defaults
 * 
 * @returns {Object} Default configuration
 */
function resetConfig() {
  currentConfig = { ...DEFAULT_CONFIG };
  saveConfig(currentConfig);
  notifyListeners(currentConfig);
  return currentConfig;
}

/**
 * Register a configuration change listener
 * 
 * @param {Function} callback - Callback function(updates)
 */
function onConfigChange(callback) {
  listeners.push(callback);
}

/**
 * Notify all listeners of configuration changes
 * 
 * @param {Object} updates - Configuration updates
 */
function notifyListeners(updates) {
  listeners.forEach(callback => {
    try {
      callback(updates);
    } catch (err) {
      console.error('Configuration listener error:', err);
    }
  });
}

/**
 * Get configuration schema
 * 
 * @returns {Object} Configuration schema
 */
function getSchema() {
  return CONFIG_SCHEMA;
}

// Load configuration on module initialization
loadConfig();

module.exports = {
  loadConfig,
  saveConfig,
  validateConfigValue,
  validateConfig,
  getConfig,
  getConfigValue,
  updateConfig,
  resetConfig,
  onConfigChange,
  getSchema,
  DEFAULT_CONFIG,
  CONFIG_SCHEMA
};
