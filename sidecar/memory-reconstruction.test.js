/**
 * Tests for Memory Reconstruction with LLM
 * 
 * Tests synthesis, citation generation, and fallback handling.
 * 
 * Requirements: 15.1-15.7, 17.1-17.4, 3.5
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  formatMemoriesForContext,
  generateSynthesisPrompt,
  identifyContributingMemories,
  generateCitations,
  extractAssociationPaths,
  formatCitationsAsMarkdown,
  formatSearchResponse,
  DEFAULT_OPTIONS
} = require('./memory-reconstruction');

describe('Memory Reconstruction', () => {
  const sampleMemories = [
    {
      memoryId: 1,
      title: 'React Hooks Tutorial',
      url: 'https://example.com/react-hooks',
      content: 'React Hooks are functions that let you use state and other React features without writing a class.',
      timestamp: '2024-01-01T10:00:00Z',
      combinedScore: 0.95,
      semanticScore: 0.9,
      associativeScore: 0.8,
      concepts: ['concept_react', 'concept_hooks'],
      hops: 0
    },
    {
      memoryId: 2,
      title: 'useState Hook Guide',
      url: 'https://example.com/usestate',
      content: 'useState is a Hook that lets you add state to functional components.',
      timestamp: '2024-01-02T10:00:00Z',
      combinedScore: 0.85,
      semanticScore: 0.8,
      associativeScore: 0.7,
      concepts: ['concept_react', 'concept_state'],
      hops: 1
    },
    {
      memoryId: 3,
      title: 'useEffect Hook Explained',
      url: 'https://example.com/useeffect',
      content: 'useEffect lets you perform side effects in functional components.',
      timestamp: '2024-01-03T10:00:00Z',
      combinedScore: 0.75,
      semanticScore: 0.7,
      associativeScore: 0.6,
      concepts: ['concept_react'],
      hops: 2
    }
  ];

  describe('formatMemoriesForContext', () => {
    it('should format memories for LLM context', () => {
      const context = formatMemoriesForContext(sampleMemories, 10);

      assert.ok(context.includes('Memory 1'), 'Should include memory numbers');
      assert.ok(context.includes('React Hooks Tutorial'), 'Should include titles');
      assert.ok(context.includes('https://example.com/react-hooks'), 'Should include URLs');
      assert.ok(context.includes('React Hooks are functions'), 'Should include content');
    });

    it('should respect maxMemories limit', () => {
      const context = formatMemoriesForContext(sampleMemories, 2);

      assert.ok(context.includes('Memory 1'), 'Should include first memory');
      assert.ok(context.includes('Memory 2'), 'Should include second memory');
      assert.ok(!context.includes('Memory 3'), 'Should not include third memory');
    });

    it('should handle empty memories array', () => {
      const context = formatMemoriesForContext([], 10);

      assert.ok(context.includes('relevant memories'), 'Should include header');
      assert.ok(!context.includes('Memory 1'), 'Should not include any memories');
    });

    it('should include relevance scores', () => {
      const context = formatMemoriesForContext(sampleMemories, 10);

      assert.ok(context.includes('Relevance Score'), 'Should include relevance score label');
      assert.ok(context.includes('0.950'), 'Should include formatted score');
    });

    it('should handle memories without content', () => {
      const memoriesWithoutContent = [
        {
          memoryId: 1,
          title: 'Test',
          url: 'https://example.com',
          timestamp: '2024-01-01T10:00:00Z',
          combinedScore: 0.8
        }
      ];

      const context = formatMemoriesForContext(memoriesWithoutContent, 10);

      assert.ok(context.includes('Memory 1'), 'Should still format memory');
      assert.ok(context.includes('Test'), 'Should include title');
    });
  });

  describe('generateSynthesisPrompt', () => {
    it('should generate complete synthesis prompt', () => {
      const context = formatMemoriesForContext(sampleMemories, 3);
      const prompt = generateSynthesisPrompt('What are React Hooks?', context);

      assert.ok(prompt.includes('What are React Hooks?'), 'Should include query');
      assert.ok(prompt.includes('Memory 1'), 'Should include context');
      assert.ok(prompt.includes('synthesize'), 'Should include instructions');
      assert.ok(prompt.includes('Answer:'), 'Should include answer prompt');
    });

    it('should include synthesis instructions', () => {
      const context = 'Test context';
      const prompt = generateSynthesisPrompt('Test query', context);

      assert.ok(prompt.includes('coherent answer'), 'Should mention coherent answer');
      assert.ok(prompt.includes('multiple memories'), 'Should mention multiple memories');
      assert.ok(prompt.includes('Reference specific memories'), 'Should mention referencing');
    });

    it('should handle empty context', () => {
      const prompt = generateSynthesisPrompt('Test query', '');

      assert.ok(prompt.includes('Test query'), 'Should include query');
      assert.ok(prompt.includes('Answer:'), 'Should include answer prompt');
    });
  });

  describe('identifyContributingMemories', () => {
    it('should identify memories mentioned in answer', () => {
      const answer = 'According to Memory 1, React Hooks are functions. Memory 2 explains useState.';
      const contributing = identifyContributingMemories(answer, sampleMemories, 10);

      assert.ok(contributing.includes(0), 'Should identify Memory 1 (index 0)');
      assert.ok(contributing.includes(1), 'Should identify Memory 2 (index 1)');
    });

    it('should handle case-insensitive matching', () => {
      const answer = 'memory 1 says something';
      const contributing = identifyContributingMemories(answer, sampleMemories, 10);

      assert.ok(contributing.includes(0), 'Should match case-insensitively');
    });

    it('should return all memories if none explicitly mentioned', () => {
      const answer = 'React Hooks are useful for state management.';
      const contributing = identifyContributingMemories(answer, sampleMemories, 3);

      assert.strictEqual(contributing.length, 3, 'Should return all top memories');
    });

    it('should respect maxMemories limit', () => {
      const answer = 'General answer without specific references.';
      const contributing = identifyContributingMemories(answer, sampleMemories, 2);

      assert.strictEqual(contributing.length, 2, 'Should respect maxMemories');
    });

    it('should handle empty answer', () => {
      const contributing = identifyContributingMemories('', sampleMemories, 10);

      assert.ok(Array.isArray(contributing), 'Should return array');
    });
  });

  describe('generateCitations', () => {
    it('should generate citations for contributing memories', () => {
      const answer = 'According to Memory 1, React Hooks are functions.';
      const citations = generateCitations(answer, sampleMemories, 10);

      assert.ok(citations.length > 0, 'Should generate citations');
      assert.ok(citations[0].memoryId, 'Should include memory ID');
      assert.ok(citations[0].title, 'Should include title');
      assert.ok(citations[0].url, 'Should include URL');
      assert.ok(typeof citations[0].relevanceScore === 'number', 'Should include relevance score');
    });

    it('should include excerpts from content', () => {
      const answer = 'Memory 1 is relevant.';
      const citations = generateCitations(answer, sampleMemories, 10);

      assert.ok(citations[0].excerpt, 'Should include excerpt');
      assert.ok(citations[0].excerpt.length <= 203, 'Should limit excerpt length');
    });

    it('should truncate long excerpts', () => {
      const longMemory = [{
        memoryId: 1,
        title: 'Long Content',
        url: 'https://example.com',
        content: 'A'.repeat(300),
        combinedScore: 0.9
      }];

      const citations = generateCitations('Memory 1', longMemory, 10);

      assert.ok(citations[0].excerpt.includes('...'), 'Should truncate with ellipsis');
      assert.ok(citations[0].excerpt.length <= 203, 'Should respect length limit');
    });

    it('should sort citations by relevance score', () => {
      const answer = 'Memory 1, Memory 2, and Memory 3 are all relevant.';
      const citations = generateCitations(answer, sampleMemories, 10);

      // Should be sorted by combinedScore descending
      for (let i = 0; i < citations.length - 1; i++) {
        assert.ok(
          citations[i].relevanceScore >= citations[i + 1].relevanceScore,
          'Should be sorted by relevance'
        );
      }
    });

    it('should include position information', () => {
      const answer = 'Memory 1 is relevant.';
      const citations = generateCitations(answer, sampleMemories, 10);

      assert.ok(typeof citations[0].position === 'number', 'Should include position');
      assert.ok(citations[0].position > 0, 'Position should be 1-indexed');
    });

    it('should handle memories without content', () => {
      const memoriesWithoutContent = [{
        memoryId: 1,
        title: 'Test',
        url: 'https://example.com',
        combinedScore: 0.8
      }];

      const citations = generateCitations('Memory 1', memoriesWithoutContent, 10);

      assert.strictEqual(citations.length, 1, 'Should generate citation');
      assert.strictEqual(citations[0].excerpt, '', 'Should have empty excerpt');
    });
  });

  describe('extractAssociationPaths', () => {
    it('should extract association paths from memories', () => {
      const paths = extractAssociationPaths(sampleMemories);

      assert.ok(paths.length > 0, 'Should extract paths');
      assert.ok(paths[0].memoryId, 'Should include memory ID');
      assert.ok(Array.isArray(paths[0].concepts), 'Should include concepts array');
      assert.ok(typeof paths[0].hops === 'number', 'Should include hop count');
    });

    it('should only include memories with concepts', () => {
      const memoriesWithoutConcepts = [
        ...sampleMemories,
        {
          memoryId: 4,
          title: 'No Concepts',
          url: 'https://example.com',
          combinedScore: 0.5
        }
      ];

      const paths = extractAssociationPaths(memoriesWithoutConcepts);

      // Should only include memories with concepts
      assert.ok(paths.every(p => p.concepts && p.concepts.length > 0), 'Should have concepts');
    });

    it('should include associative scores', () => {
      const paths = extractAssociationPaths(sampleMemories);

      assert.ok(
        paths.every(p => typeof p.associativeScore === 'number'),
        'Should include associative scores'
      );
    });

    it('should handle empty memories array', () => {
      const paths = extractAssociationPaths([]);

      assert.strictEqual(paths.length, 0, 'Should return empty array');
    });

    it('should handle memories with null hops', () => {
      const memoriesWithNullHops = [{
        memoryId: 1,
        concepts: ['concept_1'],
        hops: null
      }];

      const paths = extractAssociationPaths(memoriesWithNullHops);

      assert.strictEqual(paths.length, 0, 'Should not include memories with null hops');
    });
  });

  describe('formatCitationsAsMarkdown', () => {
    it('should format citations as markdown links', () => {
      const citations = [
        {
          memoryId: 1,
          title: 'Test Page',
          url: 'https://example.com',
          relevanceScore: 0.95,
          excerpt: 'Test excerpt'
        }
      ];

      const markdown = formatCitationsAsMarkdown(citations);

      assert.ok(markdown.includes('**Sources:**'), 'Should include header');
      assert.ok(markdown.includes('[Test Page](https://example.com)'), 'Should include markdown link');
      assert.ok(markdown.includes('95.0%'), 'Should include formatted relevance');
      assert.ok(markdown.includes('> Test excerpt'), 'Should include quoted excerpt');
    });

    it('should number citations sequentially', () => {
      const citations = [
        { memoryId: 1, title: 'A', url: 'https://a.com', relevanceScore: 0.9 },
        { memoryId: 2, title: 'B', url: 'https://b.com', relevanceScore: 0.8 }
      ];

      const markdown = formatCitationsAsMarkdown(citations);

      assert.ok(markdown.includes('1. [A]'), 'Should include first citation');
      assert.ok(markdown.includes('2. [B]'), 'Should include second citation');
    });

    it('should handle empty citations array', () => {
      const markdown = formatCitationsAsMarkdown([]);

      assert.strictEqual(markdown, '', 'Should return empty string');
    });

    it('should handle citations without excerpts', () => {
      const citations = [
        {
          memoryId: 1,
          title: 'Test',
          url: 'https://example.com',
          relevanceScore: 0.8
        }
      ];

      const markdown = formatCitationsAsMarkdown(citations);

      assert.ok(markdown.includes('[Test]'), 'Should include citation');
      assert.ok(!markdown.includes('>'), 'Should not include excerpt marker');
    });
  });

  describe('formatSearchResponse', () => {
    it('should format complete search response', () => {
      const reconstruction = {
        synthesizedAnswer: 'React Hooks are functions.',
        citations: [
          {
            memoryId: 1,
            title: 'Test',
            url: 'https://example.com',
            relevanceScore: 0.9,
            excerpt: 'Test excerpt'
          }
        ],
        rawResults: sampleMemories,
        associationPaths: [
          {
            memoryId: 1,
            concepts: ['concept_react'],
            hops: 0
          }
        ],
        metadata: {
          memoriesRetrieved: 3,
          memoriesUsed: 2,
          synthesized: true,
          model: 'llama3.2'
        }
      };

      const response = formatSearchResponse(reconstruction);

      assert.ok(response.answer, 'Should include answer');
      assert.ok(Array.isArray(response.citations), 'Should include citations array');
      assert.ok(Array.isArray(response.results), 'Should include results array');
      assert.ok(Array.isArray(response.associationPaths), 'Should include association paths');
      assert.ok(response.metadata, 'Should include metadata');
    });

    it('should append citations to answer', () => {
      const reconstruction = {
        synthesizedAnswer: 'Test answer',
        citations: [
          {
            memoryId: 1,
            title: 'Source',
            url: 'https://example.com',
            relevanceScore: 0.9,
            excerpt: 'Excerpt'
          }
        ],
        rawResults: [],
        associationPaths: [],
        metadata: { synthesized: true }
      };

      const response = formatSearchResponse(reconstruction);

      assert.ok(response.answer.includes('Test answer'), 'Should include original answer');
      assert.ok(response.answer.includes('**Sources:**'), 'Should include citations');
    });

    it('should handle null synthesized answer', () => {
      const reconstruction = {
        synthesizedAnswer: null,
        citations: [],
        rawResults: sampleMemories,
        associationPaths: [],
        metadata: {
          synthesized: false,
          fallbackReason: 'LLM unavailable'
        }
      };

      const response = formatSearchResponse(reconstruction);

      assert.strictEqual(response.answer, null, 'Should preserve null answer');
      assert.strictEqual(response.synthesized, false, 'Should indicate not synthesized');
      assert.ok(response.metadata.fallbackReason, 'Should include fallback reason');
    });

    it('should map results with relevant fields', () => {
      const memoriesWithScores = sampleMemories.map(m => ({
        ...m,
        scores: {
          semantic: m.semanticScore,
          associative: m.associativeScore,
          combined: m.combinedScore
        }
      }));

      const reconstruction = {
        synthesizedAnswer: 'Answer',
        citations: [],
        rawResults: memoriesWithScores,
        associationPaths: [],
        metadata: { synthesized: true }
      };

      const response = formatSearchResponse(reconstruction);

      assert.strictEqual(response.results.length, 3, 'Should include all results');
      assert.ok(response.results[0].memoryId, 'Should include memory ID');
      assert.ok(response.results[0].title, 'Should include title');
      assert.ok(response.results[0].scores, 'Should include scores');
    });
  });

  describe('Integration: Full reconstruction workflow', () => {
    it('should handle complete reconstruction pipeline', () => {
      // This test verifies the integration of all components
      
      const query = 'What are React Hooks?';
      
      // Format context
      const context = formatMemoriesForContext(sampleMemories, 3);
      assert.ok(context.length > 0, 'Should format context');
      
      // Generate prompt
      const prompt = generateSynthesisPrompt(query, context);
      assert.ok(prompt.includes(query), 'Should include query in prompt');
      
      // Simulate answer
      const answer = 'According to Memory 1, React Hooks are functions that let you use state.';
      
      // Generate citations
      const citations = generateCitations(answer, sampleMemories, 3);
      assert.ok(citations.length > 0, 'Should generate citations');
      
      // Extract paths
      const paths = extractAssociationPaths(sampleMemories);
      assert.ok(paths.length > 0, 'Should extract paths');
      
      // Format response
      const reconstruction = {
        synthesizedAnswer: answer,
        citations,
        rawResults: sampleMemories,
        associationPaths: paths,
        metadata: {
          memoriesRetrieved: 3,
          memoriesUsed: 3,
          synthesized: true
        }
      };
      
      const response = formatSearchResponse(reconstruction);
      assert.ok(response.answer, 'Should have formatted answer');
      assert.ok(response.citations.length > 0, 'Should have citations');
      assert.ok(response.results.length > 0, 'Should have results');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long content', () => {
      const longMemory = [{
        memoryId: 1,
        title: 'Long Content',
        url: 'https://example.com',
        content: 'A'.repeat(10000),
        combinedScore: 0.9
      }];

      const context = formatMemoriesForContext(longMemory, 1);
      assert.ok(context.length > 0, 'Should handle long content');
    });

    it('should handle special characters in content', () => {
      const specialMemory = [{
        memoryId: 1,
        title: 'Special <>&"',
        url: 'https://example.com',
        content: 'Content with <tags> and & symbols',
        combinedScore: 0.9
      }];

      const context = formatMemoriesForContext(specialMemory, 1);
      assert.ok(context.includes('<tags>'), 'Should preserve special characters');
    });

    it('should handle missing optional fields', () => {
      const minimalMemory = [{
        memoryId: 1,
        title: 'Minimal',
        url: 'https://example.com'
      }];

      const context = formatMemoriesForContext(minimalMemory, 1);
      assert.ok(context.includes('Minimal'), 'Should handle minimal memory');
      
      const citations = generateCitations('Memory 1', minimalMemory, 1);
      assert.strictEqual(citations.length, 1, 'Should generate citation');
    });
  });
});
