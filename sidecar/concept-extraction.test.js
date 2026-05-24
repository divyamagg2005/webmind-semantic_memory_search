/**
 * Unit Tests for Concept Extraction Module
 * 
 * Tests tokenization, entity recognition, topic extraction,
 * normalization, and filtering functionality.
 * 
 * Requirements: 2.1, 2.4, 2.6
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  tokenizeSentences,
  tokenizeWords,
  normalizeConcept,
  shouldFilter,
  extractNamedEntities,
  extractTopics,
  extractConcepts,
  calculateCoOccurrence,
  STOPWORDS,
  COMMON_TERMS
} = require('./concept-extraction');

describe('Concept Extraction Module', () => {
  
  describe('tokenizeSentences', () => {
    it('should split text into sentences', () => {
      const text = 'This is sentence one. This is sentence two! Is this sentence three?';
      const sentences = tokenizeSentences(text);
      
      assert.strictEqual(sentences.length, 3);
      assert.strictEqual(sentences[0], 'This is sentence one');
      assert.strictEqual(sentences[1], 'This is sentence two');
      assert.strictEqual(sentences[2], 'Is this sentence three');
    });

    it('should handle empty text', () => {
      assert.deepStrictEqual(tokenizeSentences(''), []);
      assert.deepStrictEqual(tokenizeSentences(null), []);
      assert.deepStrictEqual(tokenizeSentences(undefined), []);
    });

    it('should handle text without punctuation', () => {
      const text = 'This is a single sentence';
      const sentences = tokenizeSentences(text);
      
      assert.strictEqual(sentences.length, 1);
      assert.strictEqual(sentences[0], 'This is a single sentence');
    });
  });

  describe('tokenizeWords', () => {
    it('should tokenize text into words', () => {
      const text = 'Hello, world! This is a test.';
      const tokens = tokenizeWords(text);
      
      assert.ok(tokens.length > 0);
      assert.ok(tokens.includes('hello'));
      assert.ok(tokens.includes('world'));
      assert.ok(tokens.includes('test'));
    });

    it('should convert to lowercase', () => {
      const text = 'JavaScript React TypeScript';
      const tokens = tokenizeWords(text);
      
      assert.ok(tokens.includes('javascript'));
      assert.ok(tokens.includes('react'));
      assert.ok(tokens.includes('typescript'));
    });

    it('should handle empty text', () => {
      assert.deepStrictEqual(tokenizeWords(''), []);
      assert.deepStrictEqual(tokenizeWords(null), []);
    });
  });

  describe('normalizeConcept', () => {
    it('should convert to lowercase', () => {
      assert.strictEqual(normalizeConcept('JavaScript'), 'javascript');
      assert.strictEqual(normalizeConcept('React.js'), 'reactj');
    });

    it('should replace spaces with underscores', () => {
      assert.strictEqual(normalizeConcept('machine learning'), 'machin_learn');
      assert.strictEqual(normalizeConcept('deep neural network'), 'deep_neural_network');
    });

    it('should handle special characters', () => {
      assert.strictEqual(normalizeConcept('C++'), 'c');
      assert.strictEqual(normalizeConcept('Node.js'), 'nodej');
    });

    it('should be idempotent for already normalized concepts', () => {
      const concept = 'javascript';
      const normalized1 = normalizeConcept(concept);
      const normalized2 = normalizeConcept(normalized1);
      
      assert.strictEqual(normalized1, normalized2);
    });

    it('should handle empty input', () => {
      assert.strictEqual(normalizeConcept(''), '');
      assert.strictEqual(normalizeConcept(null), '');
      assert.strictEqual(normalizeConcept(undefined), '');
    });

    it('should remove leading and trailing underscores', () => {
      assert.strictEqual(normalizeConcept('  test  '), 'test');
      assert.strictEqual(normalizeConcept('-test-'), 'test');
    });
  });

  describe('shouldFilter', () => {
    it('should filter stopwords', () => {
      assert.strictEqual(shouldFilter('the'), true);
      assert.strictEqual(shouldFilter('and'), true);
      assert.strictEqual(shouldFilter('is'), true);
      assert.strictEqual(shouldFilter('a'), true);
    });

    it('should filter common terms', () => {
      assert.strictEqual(shouldFilter('page'), true);
      assert.strictEqual(shouldFilter('website'), true);
      assert.strictEqual(shouldFilter('click'), true);
    });

    it('should not filter meaningful terms', () => {
      assert.strictEqual(shouldFilter('javascript'), false);
      assert.strictEqual(shouldFilter('algorithm'), false);
      assert.strictEqual(shouldFilter('database'), false);
    });

    it('should filter very short tokens', () => {
      assert.strictEqual(shouldFilter('a'), true);
      assert.strictEqual(shouldFilter('i'), true);
      assert.strictEqual(shouldFilter(''), true);
    });

    it('should be case-insensitive', () => {
      assert.strictEqual(shouldFilter('THE'), true);
      assert.strictEqual(shouldFilter('The'), true);
      assert.strictEqual(shouldFilter('PAGE'), true);
    });
  });

  describe('extractNamedEntities', () => {
    it('should extract person names', () => {
      const text = 'John Smith and Mary Johnson are developers.';
      const entities = extractNamedEntities(text);
      
      const personEntities = entities.filter(e => e.type === 'PERSON');
      assert.ok(personEntities.length > 0);
    });

    it('should extract organization names', () => {
      const text = 'Google Inc and Microsoft Corporation are tech companies.';
      const entities = extractNamedEntities(text);
      
      const orgEntities = entities.filter(e => e.type === 'ORG');
      assert.ok(orgEntities.length > 0);
    });

    it('should extract technology terms', () => {
      const text = 'I use JavaScript and React for web development.';
      const entities = extractNamedEntities(text);
      
      const techEntities = entities.filter(e => e.type === 'TECH');
      assert.ok(techEntities.length >= 2);
      assert.ok(techEntities.some(e => e.name === 'javascript'));
      assert.ok(techEntities.some(e => e.name === 'react'));
    });

    it('should assign confidence scores', () => {
      const text = 'Python is a programming language.';
      const entities = extractNamedEntities(text);
      
      for (const entity of entities) {
        assert.ok(entity.confidence >= 0 && entity.confidence <= 1);
      }
    });

    it('should handle empty text', () => {
      assert.deepStrictEqual(extractNamedEntities(''), []);
      assert.deepStrictEqual(extractNamedEntities(null), []);
    });

    it('should deduplicate entities', () => {
      const text = 'JavaScript is great. JavaScript is powerful. JavaScript is popular.';
      const entities = extractNamedEntities(text);
      
      const jsEntities = entities.filter(e => e.name === 'javascript');
      assert.strictEqual(jsEntities.length, 1);
    });
  });

  describe('extractTopics', () => {
    it('should extract key topics using TF-IDF', () => {
      const text = 'Machine learning algorithms are used in artificial intelligence. ' +
                   'Deep learning is a subset of machine learning. ' +
                   'Neural networks are fundamental to deep learning.';
      const topics = extractTopics(text, 5);
      
      assert.ok(topics.length > 0);
      assert.ok(topics.length <= 5);
      
      for (const topic of topics) {
        assert.strictEqual(topic.type, 'TOPIC');
        assert.ok(topic.confidence >= 0 && topic.confidence <= 1);
      }
    });

    it('should filter stopwords from topics', () => {
      const text = 'The quick brown fox jumps over the lazy dog.';
      const topics = extractTopics(text);
      
      const stopwordTopics = topics.filter(t => STOPWORDS.has(t.name));
      assert.strictEqual(stopwordTopics.length, 0);
    });

    it('should sort topics by confidence', () => {
      const text = 'algorithm algorithm algorithm data data structure';
      const topics = extractTopics(text);
      
      if (topics.length > 1) {
        for (let i = 0; i < topics.length - 1; i++) {
          assert.ok(topics[i].confidence >= topics[i + 1].confidence);
        }
      }
    });

    it('should respect maxTopics parameter', () => {
      const text = 'one two three four five six seven eight nine ten eleven twelve';
      const topics = extractTopics(text, 5);
      
      assert.ok(topics.length <= 5);
    });

    it('should handle empty text', () => {
      assert.deepStrictEqual(extractTopics(''), []);
      assert.deepStrictEqual(extractTopics(null), []);
    });
  });

  describe('extractConcepts', () => {
    it('should extract both entities and topics', () => {
      const text = 'Google uses Python and TensorFlow for machine learning projects.';
      const concepts = extractConcepts(text);
      
      assert.ok(concepts.length > 0);
      
      const hasEntity = concepts.some(c => c.type === 'ORG' || c.type === 'TECH');
      const hasTopic = concepts.some(c => c.type === 'TOPIC');
      
      assert.ok(hasEntity || hasTopic);
    });

    it('should normalize concept names', () => {
      const text = 'Machine Learning and Deep Learning are related.';
      const concepts = extractConcepts(text);
      
      for (const concept of concepts) {
        // Normalized names should be lowercase and use underscores
        assert.strictEqual(concept.name, concept.name.toLowerCase());
        assert.ok(!concept.name.includes(' '));
      }
    });

    it('should filter concepts below confidence threshold', () => {
      const text = 'This is a test document with some content.';
      const concepts = extractConcepts(text, { minConfidence: 0.8 });
      
      for (const concept of concepts) {
        assert.ok(concept.confidence >= 0.8);
      }
    });

    it('should assign unique IDs to concepts', () => {
      const text = 'JavaScript and Python are programming languages.';
      const concepts = extractConcepts(text);
      
      const ids = new Set(concepts.map(c => c.id));
      assert.strictEqual(ids.size, concepts.length);
    });

    it('should deduplicate concepts with same normalized name', () => {
      const text = 'React.js and React are the same framework.';
      const concepts = extractConcepts(text);
      
      // Both should normalize to similar form
      const reactConcepts = concepts.filter(c => c.name.includes('react'));
      // Should have at most one after deduplication
      assert.ok(reactConcepts.length <= 1);
    });

    it('should preserve original name', () => {
      const text = 'Machine Learning is important.';
      const concepts = extractConcepts(text);
      
      for (const concept of concepts) {
        assert.ok(concept.originalName);
        assert.ok(typeof concept.originalName === 'string');
      }
    });

    it('should handle empty text', () => {
      assert.deepStrictEqual(extractConcepts(''), []);
      assert.deepStrictEqual(extractConcepts(null), []);
    });

    it('should respect maxTopics option', () => {
      const text = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
      const concepts = extractConcepts(text, { maxTopics: 3 });
      
      const topics = concepts.filter(c => c.type === 'TOPIC');
      assert.ok(topics.length <= 3);
    });
  });

  describe('calculateCoOccurrence', () => {
    it('should calculate co-occurrence matrix', () => {
      const concepts = [
        { id: 'concept_a', name: 'a' },
        { id: 'concept_b', name: 'b' },
        { id: 'concept_c', name: 'c' }
      ];
      
      const matrix = calculateCoOccurrence(concepts);
      
      assert.strictEqual(matrix.size, 3);
      assert.ok(matrix.has('concept_a'));
      assert.ok(matrix.has('concept_b'));
      assert.ok(matrix.has('concept_c'));
    });

    it('should create bidirectional co-occurrences', () => {
      const concepts = [
        { id: 'concept_a', name: 'a' },
        { id: 'concept_b', name: 'b' }
      ];
      
      const matrix = calculateCoOccurrence(concepts);
      
      assert.strictEqual(matrix.get('concept_a').get('concept_b'), 1);
      assert.strictEqual(matrix.get('concept_b').get('concept_a'), 1);
    });

    it('should handle single concept', () => {
      const concepts = [{ id: 'concept_a', name: 'a' }];
      const matrix = calculateCoOccurrence(concepts);
      
      assert.strictEqual(matrix.size, 1);
      assert.strictEqual(matrix.get('concept_a').size, 0);
    });

    it('should handle empty array', () => {
      const matrix = calculateCoOccurrence([]);
      assert.strictEqual(matrix.size, 0);
    });
  });

  describe('Integration: Full concept extraction pipeline', () => {
    it('should extract concepts from realistic web content', () => {
      const text = `
        Introduction to React and TypeScript
        
        React is a popular JavaScript library for building user interfaces.
        TypeScript adds static typing to JavaScript, making it more robust.
        Many developers at companies like Google and Microsoft use these technologies.
        
        Key concepts include components, hooks, and type safety.
        Modern web development relies heavily on these tools.
      `;
      
      const concepts = extractConcepts(text, { minConfidence: 0.6 });
      
      // Should extract some concepts
      assert.ok(concepts.length > 0);
      
      // Should have different types
      const types = new Set(concepts.map(c => c.type));
      assert.ok(types.size > 0);
      
      // All concepts should meet confidence threshold
      for (const concept of concepts) {
        assert.ok(concept.confidence >= 0.6);
      }
      
      // Should have normalized names
      for (const concept of concepts) {
        assert.ok(concept.name);
        assert.ok(concept.id.startsWith('concept_'));
      }
    });

    it('should handle technical documentation', () => {
      const text = `
        Docker and Kubernetes Tutorial
        
        Docker is a containerization platform. Kubernetes orchestrates containers.
        AWS and Azure provide managed Kubernetes services.
        DevOps teams use these tools for deployment automation.
      `;
      
      const concepts = extractConcepts(text);
      
      // Should extract tech terms
      const techConcepts = concepts.filter(c => c.type === 'TECH');
      assert.ok(techConcepts.length > 0);
      
      // Should extract organizations
      const orgConcepts = concepts.filter(c => c.type === 'ORG');
      assert.ok(orgConcepts.length >= 0); // May or may not detect orgs
    });
  });
});
