/**
 * Concept Extraction Module
 * 
 * Implements NLP pipeline for extracting concepts from page content:
 * - Tokenization and sentence splitting
 * - Named entity recognition (PERSON, ORG, TECH, TOPIC)
 * - TF-IDF for key topic extraction
 * - Normalization (lowercase, lemmatization)
 * - Stopword and common term filtering
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;
const stemmer = natural.PorterStemmer;

// Stopwords list (common English words to filter out)
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'by', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'itself', 'just', 'me', 'might', 'more', 'most', 'must', 'my', 'myself', 'no',
  'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

// Common terms to filter (generic web/tech terms that don't add value)
const COMMON_TERMS = new Set([
  'page', 'website', 'site', 'web', 'home', 'click', 'here', 'link', 'button', 'menu',
  'search', 'find', 'view', 'show', 'hide', 'open', 'close', 'back', 'next', 'previous',
  'first', 'last', 'new', 'old', 'update', 'updated', 'posted', 'published', 'created',
  'modified', 'edited', 'added', 'removed', 'deleted', 'saved', 'loading', 'loaded',
  'error', 'success', 'warning', 'info', 'message', 'notification', 'alert', 'confirm'
]);

// Technology keywords for TECH entity recognition
const TECH_KEYWORDS = new Set([
  'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'ruby', 'php', 'go', 'rust',
  'swift', 'kotlin', 'scala', 'haskell', 'clojure', 'elixir', 'erlang', 'perl', 'lua',
  'react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'gatsby', 'remix',
  'node.js', 'deno', 'bun', 'express', 'fastify', 'koa', 'nest.js',
  'django', 'flask', 'fastapi', 'rails', 'laravel', 'spring', 'asp.net',
  'mongodb', 'postgresql', 'mysql', 'redis', 'elasticsearch', 'cassandra', 'dynamodb',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'ansible',
  'git', 'github', 'gitlab', 'bitbucket', 'jenkins', 'circleci', 'travis',
  'webpack', 'vite', 'rollup', 'parcel', 'babel', 'eslint', 'prettier',
  'jest', 'mocha', 'cypress', 'playwright', 'selenium', 'puppeteer',
  'graphql', 'rest', 'grpc', 'websocket', 'http', 'https', 'api',
  'machine learning', 'deep learning', 'neural network', 'ai', 'ml', 'nlp',
  'blockchain', 'cryptocurrency', 'bitcoin', 'ethereum', 'web3', 'nft'
]);

// Organization indicators (words that often appear with organization names)
const ORG_INDICATORS = new Set([
  'inc', 'corp', 'corporation', 'company', 'ltd', 'limited', 'llc', 'co',
  'group', 'holdings', 'enterprises', 'industries', 'systems', 'solutions',
  'technologies', 'software', 'labs', 'studio', 'foundation', 'institute'
]);

/**
 * Tokenize text into sentences
 * 
 * @param {string} text - Input text
 * @returns {Array<string>} Array of sentences
 */
function tokenizeSentences(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Simple sentence splitting on common punctuation
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return sentences;
}

/**
 * Tokenize text into words
 * 
 * @param {string} text - Input text
 * @returns {Array<string>} Array of tokens
 */
function tokenizeWords(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return tokenizer.tokenize(text.toLowerCase());
}

/**
 * Normalize concept name
 * Apply lowercase and lemmatization (using stemming as approximation)
 * 
 * @param {string} concept - Concept name
 * @returns {string} Normalized concept name
 */
function normalizeConcept(concept) {
  if (!concept || typeof concept !== 'string') {
    return '';
  }

  // Convert to lowercase
  let normalized = concept.toLowerCase().trim();

  // Replace special characters with underscores
  normalized = normalized.replace(/[^\w\s-]/g, '');
  
  // Replace multiple spaces/hyphens with single underscore
  normalized = normalized.replace(/[\s-]+/g, '_');

  // Remove trailing/leading underscores
  normalized = normalized.replace(/^_+|_+$/g, '');

  // Apply stemming to each word for lemmatization approximation
  const words = normalized.split('_');
  const stemmed = words.map(word => {
    // Don't stem very short words or known tech terms
    if (word.length <= 3 || TECH_KEYWORDS.has(word)) {
      return word;
    }
    return stemmer.stem(word);
  });

  return stemmed.join('_');
}

/**
 * Check if a token is a stopword or common term
 * 
 * @param {string} token - Token to check
 * @returns {boolean} True if should be filtered
 */
function shouldFilter(token) {
  if (!token || token.length < 2) {
    return true;
  }
  const lower = token.toLowerCase();
  return STOPWORDS.has(lower) || COMMON_TERMS.has(lower);
}

/**
 * Extract named entities from text
 * Recognizes PERSON, ORG, TECH entity types
 * 
 * @param {string} text - Input text
 * @returns {Array<Object>} Array of entities with type and confidence
 */
function extractNamedEntities(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const entities = [];
  const sentences = tokenizeSentences(text);

  for (const sentence of sentences) {
    // Extract capitalized sequences (potential PERSON or ORG names)
    const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const matches = sentence.match(capitalizedPattern) || [];

    for (const match of matches) {
      const words = match.split(/\s+/);
      const lastWord = words[words.length - 1].toLowerCase();

      // Determine entity type
      let type = 'PERSON';
      let confidence = 0.6;

      // Check if it's an organization
      if (ORG_INDICATORS.has(lastWord) || words.length > 2) {
        type = 'ORG';
        confidence = 0.7;
      }

      // Check if any word is in the match
      if (words.some(w => ORG_INDICATORS.has(w.toLowerCase()))) {
        type = 'ORG';
        confidence = 0.8;
      }

      entities.push({
        name: match,
        type,
        confidence
      });
    }

    // Extract technology terms
    const lowerSentence = sentence.toLowerCase();
    for (const tech of TECH_KEYWORDS) {
      if (lowerSentence.includes(tech)) {
        entities.push({
          name: tech,
          type: 'TECH',
          confidence: 0.9
        });
      }
    }
  }

  // Deduplicate entities
  const uniqueEntities = new Map();
  for (const entity of entities) {
    const key = `${entity.name.toLowerCase()}_${entity.type}`;
    if (!uniqueEntities.has(key) || uniqueEntities.get(key).confidence < entity.confidence) {
      uniqueEntities.set(key, entity);
    }
  }

  return Array.from(uniqueEntities.values());
}

/**
 * Extract key topics using TF-IDF
 * 
 * @param {string} text - Input text
 * @param {number} maxTopics - Maximum number of topics to extract
 * @returns {Array<Object>} Array of topics with scores
 */
function extractTopics(text, maxTopics = 10) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const tfidf = new TfIdf();
  tfidf.addDocument(text);

  const topics = [];
  tfidf.listTerms(0).forEach(item => {
    // Filter stopwords and common terms
    if (!shouldFilter(item.term) && item.term.length > 2) {
      topics.push({
        name: item.term,
        type: 'TOPIC',
        confidence: Math.min(item.tfidf / 10, 1.0) // Normalize to 0-1 range
      });
    }
  });

  // Sort by confidence and take top N
  return topics
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxTopics);
}

/**
 * Extract all concepts from text
 * Combines named entities and topics
 * 
 * @param {string} text - Input text
 * @param {Object} options - Extraction options
 * @param {number} options.maxTopics - Maximum topics to extract (default: 10)
 * @param {number} options.minConfidence - Minimum confidence threshold (default: 0.6)
 * @returns {Array<Object>} Array of concepts with normalized names
 */
function extractConcepts(text, options = {}) {
  const {
    maxTopics = 10,
    minConfidence = 0.6
  } = options;

  if (!text || typeof text !== 'string') {
    return [];
  }

  // Extract entities and topics
  const entities = extractNamedEntities(text);
  const topics = extractTopics(text, maxTopics);

  // Combine and normalize
  const allConcepts = [...entities, ...topics];
  const normalizedConcepts = [];

  for (const concept of allConcepts) {
    // Filter by confidence threshold
    if (concept.confidence < minConfidence) {
      continue;
    }

    // Normalize the concept name
    const normalized = normalizeConcept(concept.name);
    
    // Skip if normalization resulted in empty string or filtered term
    if (!normalized || shouldFilter(normalized)) {
      continue;
    }

    normalizedConcepts.push({
      id: `concept_${normalized}`,
      name: normalized,
      originalName: concept.name,
      type: concept.type,
      confidence: concept.confidence
    });
  }

  // Deduplicate by normalized name, keeping highest confidence
  const uniqueConcepts = new Map();
  for (const concept of normalizedConcepts) {
    if (!uniqueConcepts.has(concept.id) || 
        uniqueConcepts.get(concept.id).confidence < concept.confidence) {
      uniqueConcepts.set(concept.id, concept);
    }
  }

  return Array.from(uniqueConcepts.values());
}

/**
 * Calculate co-occurrence matrix for concepts
 * Used to determine association strengths
 * 
 * @param {Array<Object>} concepts - Array of concepts
 * @returns {Map<string, Map<string, number>>} Co-occurrence matrix
 */
function calculateCoOccurrence(concepts) {
  const matrix = new Map();

  // Initialize matrix
  for (const concept of concepts) {
    matrix.set(concept.id, new Map());
  }

  // Calculate co-occurrences (all concepts in same document co-occur)
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const id1 = concepts[i].id;
      const id2 = concepts[j].id;

      // Increment co-occurrence count
      const map1 = matrix.get(id1);
      map1.set(id2, (map1.get(id2) || 0) + 1);

      const map2 = matrix.get(id2);
      map2.set(id1, (map2.get(id1) || 0) + 1);
    }
  }

  return matrix;
}

module.exports = {
  tokenizeSentences,
  tokenizeWords,
  normalizeConcept,
  shouldFilter,
  extractNamedEntities,
  extractTopics,
  extractConcepts,
  calculateCoOccurrence,
  STOPWORDS,
  COMMON_TERMS,
  TECH_KEYWORDS
};
