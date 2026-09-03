/**
 * Unit Tests for Multi-Modal Embedding Core Logic
 * 
 * Tests cover:
 * - Multi-modal score combination
 * - Score normalization and bounds
 * - Missing modality handling
 * - Result ranking
 * - Property tests for score bounds
 * 
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  TEXT_WEIGHT,
  IMAGE_WEIGHT,
  VISION_MODEL,
  OllamaEmbeddingClient,
  OllamaVisionClient,
  CLIPEmbeddingClient,
  combineMultiModalScores,
  rankByMultiModalScore,
  handleMissingModalities
} = require('./multimodal-embeddings');

describe('Multi-Modal Embedding Core Logic', () => {
  
  describe('OllamaEmbeddingClient', () => {
    it('should create client instance', () => {
      const client = new OllamaEmbeddingClient();
      assert.ok(client);
      assert.strictEqual(client.isAvailable, null);
    });

    it('should handle invalid text input', async () => {
      const client = new OllamaEmbeddingClient();
      
      await assert.rejects(
        async () => await client.generateTextEmbedding(null),
        /Invalid text input/
      );
      
      await assert.rejects(
        async () => await client.generateTextEmbedding(''),
        /Invalid text input/
      );
    });

    it('should handle batch embedding with empty array', async () => {
      const client = new OllamaEmbeddingClient();
      const result = await client.generateTextEmbeddingsBatch([]);
      
      assert.deepStrictEqual(result, []);
    });
  });

  describe('CLIPEmbeddingClient', () => {
    it('should create CLIP client instance', () => {
      const client = new CLIPEmbeddingClient();
      assert.ok(client);
      assert.strictEqual(client.isLoaded, false);
    });

    it('should load model', async () => {
      const client = new CLIPEmbeddingClient();
      await client.loadModel();
      
      assert.strictEqual(client.isLoaded, true);
    });

    it('should handle invalid image URL', async () => {
      const client = new CLIPEmbeddingClient();
      
      await assert.rejects(
        async () => await client.generateImageEmbedding(null),
        /Invalid image URL/
      );
    });

    it('should handle invalid text input', async () => {
      const client = new CLIPEmbeddingClient();
      
      await assert.rejects(
        async () => await client.generateTextEmbedding(null),
        /Invalid text input/
      );
    });
  });

  describe('OllamaVisionClient', () => {
    it('uses the default vision model, and an override when given', () => {
      assert.strictEqual(new OllamaVisionClient().model, VISION_MODEL);
      assert.strictEqual(new OllamaVisionClient({ model: 'moondream' }).model, 'moondream');
    });

    it('decodes a base64 data: URL without touching the network', async () => {
      const client = new OllamaVisionClient();
      const b64 = Buffer.from('fakepng').toString('base64');
      const out = await client.fetchImageBase64(`data:image/png;base64,${b64}`);
      assert.strictEqual(out, b64);
    });

    it('rejects a non-image data: URL', async () => {
      const client = new OllamaVisionClient();
      const out = await client.fetchImageBase64('data:text/plain;base64,aGVsbG8=');
      assert.strictEqual(out, null);
    });

    it('rejects an SVG data: URL (crashes the vision runner)', async () => {
      const client = new OllamaVisionClient();
      const out = await client.fetchImageBase64('data:image/svg+xml;charset=utf8,%3Csvg%2F%3E');
      assert.strictEqual(out, null);
    });

    it('captionImage returns the trimmed model description', async () => {
      const client = new OllamaVisionClient();
      client.fetchImageBase64 = async () => 'ZmFrZQ==';
      client.ollama = { generate: async () => ({ response: '  A screenshot of a code editor.  ' }) };

      const caption = await client.captionImage('https://example.com/a.png', 'editor');
      assert.strictEqual(caption, 'A screenshot of a code editor.');
    });

    it('captionImage returns null when the image cannot be fetched', async () => {
      const client = new OllamaVisionClient();
      client.fetchImageBase64 = async () => null;
      let called = false;
      client.ollama = { generate: async () => { called = true; return { response: 'x' }; } };

      const caption = await client.captionImage('https://example.com/missing.png');
      assert.strictEqual(caption, null);
      assert.strictEqual(called, false);
    });

    it('captionImage returns null when the model call throws', async () => {
      const client = new OllamaVisionClient();
      client.fetchImageBase64 = async () => 'ZmFrZQ==';
      client.ollama = { generate: async () => { throw new Error('ollama down'); } };

      const caption = await client.captionImage('https://example.com/a.png');
      assert.strictEqual(caption, null);
    });
  });

  describe('combineMultiModalScores', () => {
    /**
     * Property 12: Multi-Modal Score Bounds
     * Validates: Requirement 14.3
     */
    it('should combine scores with default weights', () => {
      const score = combineMultiModalScores({
        textScore: 0.8,
        imageScore: 0.6
      });
      
      // Expected: 0.8 * 0.6 + 0.6 * 0.4 = 0.48 + 0.24 = 0.72
      assert.ok(score >= 0.71 && score <= 0.73);
    });

    it('should combine scores with custom weights', () => {
      const score = combineMultiModalScores(
        {
          textScore: 0.8,
          imageScore: 0.6
        },
        {
          textWeight: 0.5,
          imageWeight: 0.5
        }
      );
      
      // Expected: 0.8 * 0.5 + 0.6 * 0.5 = 0.4 + 0.3 = 0.7
      assert.strictEqual(score, 0.7);
    });

    it('should handle zero scores', () => {
      const score = combineMultiModalScores({
        textScore: 0,
        imageScore: 0
      });
      
      assert.strictEqual(score, 0);
    });

    it('should handle maximum scores', () => {
      const score = combineMultiModalScores({
        textScore: 1.0,
        imageScore: 1.0
      });
      
      assert.strictEqual(score, 1.0);
    });

    it('should normalize weights', () => {
      const score1 = combineMultiModalScores(
        { textScore: 0.8, imageScore: 0.6 },
        { textWeight: 0.6, imageWeight: 0.4 }
      );
      
      const score2 = combineMultiModalScores(
        { textScore: 0.8, imageScore: 0.6 },
        { textWeight: 6, imageWeight: 4 }
      );
      
      // Should be equal after normalization
      assert.ok(Math.abs(score1 - score2) < 0.001);
    });

    it('should throw on invalid text score', () => {
      assert.throws(() => {
        combineMultiModalScores({
          textScore: -0.1,
          imageScore: 0.5
        });
      }, /Invalid text score/);
      
      assert.throws(() => {
        combineMultiModalScores({
          textScore: 1.5,
          imageScore: 0.5
        });
      }, /Invalid text score/);
    });

    it('should throw on invalid image score', () => {
      assert.throws(() => {
        combineMultiModalScores({
          textScore: 0.5,
          imageScore: -0.1
        });
      }, /Invalid image score/);
      
      assert.throws(() => {
        combineMultiModalScores({
          textScore: 0.5,
          imageScore: 1.5
        });
      }, /Invalid image score/);
    });

    it('should handle zero weights', () => {
      const score = combineMultiModalScores(
        { textScore: 0.8, imageScore: 0.6 },
        { textWeight: 0, imageWeight: 0 }
      );
      
      assert.strictEqual(score, 0);
    });

    /**
     * Property test: Combined score should always be in [0, 1] range
     */
    it('should always return score in [0, 1] range', () => {
      const testCases = [
        { textScore: 0, imageScore: 0 },
        { textScore: 1, imageScore: 1 },
        { textScore: 0.5, imageScore: 0.5 },
        { textScore: 0.2, imageScore: 0.8 },
        { textScore: 0.9, imageScore: 0.1 }
      ];
      
      for (const scores of testCases) {
        const combined = combineMultiModalScores(scores);
        assert.ok(combined >= 0 && combined <= 1,
          `Combined score ${combined} should be in [0, 1] for ${JSON.stringify(scores)}`);
      }
    });

    /**
     * Property test: Higher individual scores should result in higher combined score
     */
    it('should be monotonically increasing with individual scores', () => {
      const base = combineMultiModalScores({ textScore: 0.5, imageScore: 0.5 });
      
      const higherText = combineMultiModalScores({ textScore: 0.7, imageScore: 0.5 });
      const higherImage = combineMultiModalScores({ textScore: 0.5, imageScore: 0.7 });
      const higherBoth = combineMultiModalScores({ textScore: 0.7, imageScore: 0.7 });
      
      assert.ok(higherText > base);
      assert.ok(higherImage > base);
      assert.ok(higherBoth > higherText);
      assert.ok(higherBoth > higherImage);
    });
  });

  describe('rankByMultiModalScore', () => {
    it('should rank results by combined score', () => {
      const results = [
        { id: 1, textScore: 0.5, imageScore: 0.5 },
        { id: 2, textScore: 0.9, imageScore: 0.8 },
        { id: 3, textScore: 0.3, imageScore: 0.4 }
      ];
      
      const ranked = rankByMultiModalScore(results);
      
      assert.strictEqual(ranked.length, 3);
      assert.strictEqual(ranked[0].id, 2); // Highest scores
      assert.strictEqual(ranked[2].id, 3); // Lowest scores
      
      // Verify combined scores are calculated
      assert.ok(ranked[0].combinedScore > 0);
      assert.ok(ranked[0].combinedScore > ranked[1].combinedScore);
      assert.ok(ranked[1].combinedScore > ranked[2].combinedScore);
    });

    it('should handle missing scores', () => {
      const results = [
        { id: 1, textScore: 0.8 }, // No image score
        { id: 2, imageScore: 0.7 }, // No text score
        { id: 3, textScore: 0.6, imageScore: 0.6 }
      ];
      
      const ranked = rankByMultiModalScore(results);
      
      assert.strictEqual(ranked.length, 3);
      // All should have combined scores
      ranked.forEach(result => {
        assert.ok(typeof result.combinedScore === 'number');
      });
    });

    it('should handle empty array', () => {
      const ranked = rankByMultiModalScore([]);
      assert.deepStrictEqual(ranked, []);
    });

    it('should handle null input', () => {
      const ranked = rankByMultiModalScore(null);
      assert.deepStrictEqual(ranked, []);
    });

    it('should use custom weights', () => {
      const results = [
        { id: 1, textScore: 1.0, imageScore: 0.0 },
        { id: 2, textScore: 0.0, imageScore: 1.0 }
      ];
      
      // With text-heavy weights, result 1 should rank higher
      const ranked1 = rankByMultiModalScore(results, { textWeight: 0.9, imageWeight: 0.1 });
      assert.strictEqual(ranked1[0].id, 1);
      
      // With image-heavy weights, result 2 should rank higher
      const ranked2 = rankByMultiModalScore(results, { textWeight: 0.1, imageWeight: 0.9 });
      assert.strictEqual(ranked2[0].id, 2);
    });
  });

  describe('handleMissingModalities', () => {
    it('should handle both modalities present', () => {
      const result = handleMissingModalities({
        textScore: 0.8,
        imageScore: 0.6
      });
      
      assert.strictEqual(result.scores.textScore, 0.8);
      assert.strictEqual(result.scores.imageScore, 0.6);
      assert.strictEqual(result.weights.textWeight, TEXT_WEIGHT);
      assert.strictEqual(result.weights.imageWeight, IMAGE_WEIGHT);
    });

    it('should handle missing text score', () => {
      const result = handleMissingModalities({
        imageScore: 0.7
      });
      
      assert.strictEqual(result.scores.textScore, 0);
      assert.strictEqual(result.scores.imageScore, 0.7);
      assert.strictEqual(result.weights.textWeight, 0);
      assert.strictEqual(result.weights.imageWeight, 1.0);
    });

    it('should handle missing image score', () => {
      const result = handleMissingModalities({
        textScore: 0.8
      });
      
      assert.strictEqual(result.scores.textScore, 0.8);
      assert.strictEqual(result.scores.imageScore, 0);
      assert.strictEqual(result.weights.textWeight, 1.0);
      assert.strictEqual(result.weights.imageWeight, 0);
    });

    it('should handle both missing', () => {
      const result = handleMissingModalities({});
      
      assert.strictEqual(result.scores.textScore, 0);
      assert.strictEqual(result.scores.imageScore, 0);
      assert.strictEqual(result.weights.textWeight, 0.5);
      assert.strictEqual(result.weights.imageWeight, 0.5);
    });

    it('should handle NaN scores', () => {
      const result = handleMissingModalities({
        textScore: NaN,
        imageScore: 0.5
      });
      
      assert.strictEqual(result.weights.textWeight, 0);
      assert.strictEqual(result.weights.imageWeight, 1.0);
    });
  });

  describe('Integration: Multi-modal scoring pipeline', () => {
    it('should handle complete multi-modal scoring workflow', () => {
      const results = [
        { id: 1, title: 'High text, low image', textScore: 0.9, imageScore: 0.3 },
        { id: 2, title: 'Balanced', textScore: 0.7, imageScore: 0.7 },
        { id: 3, title: 'Low text, high image', textScore: 0.3, imageScore: 0.9 },
        { id: 4, title: 'Text only', textScore: 0.8 },
        { id: 5, title: 'Image only', imageScore: 0.8 }
      ];
      
      const ranked = rankByMultiModalScore(results);
      
      // Verify all have combined scores
      assert.strictEqual(ranked.length, 5);
      ranked.forEach(result => {
        assert.ok(typeof result.combinedScore === 'number');
        assert.ok(result.combinedScore >= 0 && result.combinedScore <= 1);
      });
      
      // Verify descending order
      for (let i = 0; i < ranked.length - 1; i++) {
        assert.ok(ranked[i].combinedScore >= ranked[i + 1].combinedScore);
      }
    });

    it('should handle fallback for missing modalities', () => {
      const scores = { textScore: 0.8 }; // Missing image score
      
      const adjusted = handleMissingModalities(scores);
      const combined = combineMultiModalScores(adjusted.scores, adjusted.weights);
      
      // Should equal text score when only text available
      assert.strictEqual(combined, 0.8);
    });
  });

  describe('Constants', () => {
    it('should have correct default weights', () => {
      assert.strictEqual(TEXT_WEIGHT, 0.6);
      assert.strictEqual(IMAGE_WEIGHT, 0.4);
    });

    it('should have weights that sum to 1.0', () => {
      assert.strictEqual(TEXT_WEIGHT + IMAGE_WEIGHT, 1.0);
    });
  });
});
