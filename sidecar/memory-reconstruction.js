/**
 * Memory Reconstruction with LLM
 * 
 * Implements LLM-powered synthesis of memory fragments into coherent answers.
 * Tracks source citations and handles fallback scenarios.
 * 
 * Requirements: 15.1-15.7, 17.1-17.4, 3.5
 */

const { generateText } = require('./model-provider');

/**
 * Default reconstruction options
 */
const DEFAULT_OPTIONS = {
  maxMemories: 5,
  model: 'llama3.2:3b',
  temperature: 0.3,
  maxTokens: 200
};

/**
 * Format memory fragments for LLM context
 * 
 * Requirement 15.3: Format context for LLM (limit to top 10 memories)
 * 
 * @param {Array<Object>} memories - Retrieved memories
 * @param {number} maxMemories - Maximum memories to include
 * @returns {string} Formatted context string
 */
function formatMemoriesForContext(memories, maxMemories = 5) {
  const topMemories = memories.slice(0, maxMemories);
  let context = 'Browsing history snippets:\n\n';
  topMemories.forEach((memory, index) => {
    const snippet = (memory.content || memory.text || '').slice(0, 300);
    context += `[${index + 1}] ${memory.title}\n${memory.url}\n${snippet}\n\n`;
  });
  return context;
}

/**
 * System instruction for synthesis.
 *
 * Chat-tuned endpoints (e.g. the AWS LLaMA endpoint) otherwise tend to reply
 * "I don't have access to your history / this conversation just started". The
 * snippets ARE the user's history — this makes the model use them.
 */
const SYNTHESIS_SYSTEM_PROMPT =
  "You reconstruct the user's own web browsing history. The numbered snippets " +
  "below ARE pages the user visited — treat them as ground truth. Answer the " +
  "question using ONLY those snippets, in 2-3 sentences, naming the site(s) " +
  "you drew from. If the snippets don't contain the answer, say so plainly. " +
  "Never claim you lack access to history or memory.";

/**
 * Generate synthesis prompt for LLM
 *
 * Requirement 15.4: Send query + fragments to Ollama for synthesis
 *
 * @param {string} query - User's search query
 * @param {string} context - Formatted memory context
 * @returns {string} Complete prompt for LLM
 */
function generateSynthesisPrompt(query, context) {
  return `${context}
Question: ${query}

Answer in 2-3 sentences using the snippets above. Mention the site name where you found it.

Answer:`;
}

/**
 * Synthesize answer using Ollama LLM
 * 
 * Requirements:
 * - 15.5: Generate coherent answer combining multiple memories
 * - 25.1: Use Ollama for all LLM inference tasks
 * 
 * @param {string} query - User's search query
 * @param {Array<Object>} memories - Retrieved memories
 * @param {Object} options - Synthesis options
 * @returns {Promise<Object>} Synthesis result with answer and metadata
 */
async function synthesizeAnswer(query, memories, options = {}) {
  const {
    maxMemories = DEFAULT_OPTIONS.maxMemories,
    model = DEFAULT_OPTIONS.model,
    temperature = DEFAULT_OPTIONS.temperature,
    maxTokens = DEFAULT_OPTIONS.maxTokens
  } = options;

  if (!query || typeof query !== 'string') {
    throw new Error('Invalid query');
  }

  if (!Array.isArray(memories) || memories.length === 0) {
    return {
      answer: 'No relevant memories found to answer this question.',
      memoriesUsed: 0,
      synthesized: false
    };
  }

  try {
    // Format context
    const context = formatMemoriesForContext(memories, maxMemories);

    // Generate prompt
    const prompt = generateSynthesisPrompt(query, context);

    // Synthesis runs through the model provider — local Ollama LLaMA or the
    // AWS LLaMA endpoint, depending on the cloud_llama_enabled switch.
    const answer = await generateText({
      prompt,
      system: SYNTHESIS_SYSTEM_PROMPT,
      model,
      temperature,
      maxTokens,
      numCtx: 2048
    });

    return {
      answer: answer.trim(),
      memoriesUsed: Math.min(memories.length, maxMemories),
      synthesized: true,
      model,
      promptTokens: prompt.length,
      responseTokens: answer.length
    };

  } catch (error) {
    console.error('LLM synthesis failed:', error);
    throw error;
  }
}

/**
 * Track which memories contributed to the answer
 * 
 * Requirement 17.1: Track which memories contributed to each synthesized answer
 * 
 * @param {string} answer - Synthesized answer
 * @param {Array<Object>} memories - Retrieved memories
 * @param {number} maxMemories - Maximum memories used
 * @returns {Array<number>} Indices of memories that contributed
 */
function identifyContributingMemories(answer, memories, maxMemories = 10) {
  const contributing = [];
  const topMemories = memories.slice(0, maxMemories);
  
  // Simple heuristic: check if memory number is mentioned in answer
  for (let i = 0; i < topMemories.length; i++) {
    const memoryNumber = i + 1;
    const pattern = new RegExp(`Memory ${memoryNumber}\\b`, 'i');
    
    if (pattern.test(answer)) {
      contributing.push(i);
    }
  }
  
  // If no explicit mentions, assume all top memories contributed
  if (contributing.length === 0) {
    return topMemories.map((_, i) => i);
  }
  
  return contributing;
}

/**
 * Generate citations for synthesized answer
 * 
 * Requirements:
 * - 17.2: Include title, URL, and relevance score for each source
 * - 17.3: Order citations by contribution
 * - 17.4: Format citations as clickable links
 * 
 * @param {string} answer - Synthesized answer
 * @param {Array<Object>} memories - Retrieved memories
 * @param {number} maxMemories - Maximum memories used
 * @returns {Array<Object>} Citation objects
 */
function generateCitations(answer, memories, maxMemories = 10) {
  const contributingIndices = identifyContributingMemories(answer, memories, maxMemories);
  const citations = [];
  
  for (const index of contributingIndices) {
    const memory = memories[index];
    
    // Extract excerpt from content
    const content = memory.content || memory.text || '';
    const excerpt = content.length > 200 
      ? content.substring(0, 200) + '...'
      : content;
    
    citations.push({
      memoryId: memory.memoryId,
      title: memory.title,
      url: memory.url,
      relevanceScore: memory.combinedScore || memory.semanticScore || 0,
      excerpt,
      position: index + 1
    });
  }
  
  // Sort by relevance score (descending)
  citations.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  return citations;
}

/**
 * Extract association paths from memories
 * 
 * Requirement 3.5: Include association paths in result metadata
 * 
 * @param {Array<Object>} memories - Retrieved memories
 * @returns {Array<Object>} Association path objects
 */
function extractAssociationPaths(memories) {
  const paths = [];
  
  for (const memory of memories) {
    if (memory.concepts && memory.concepts.length > 0 && memory.hops !== null) {
      paths.push({
        memoryId: memory.memoryId,
        concepts: memory.concepts,
        hops: memory.hops,
        associativeScore: memory.associativeScore || 0
      });
    }
  }
  
  return paths;
}

/**
 * Perform complete memory reconstruction pipeline
 * 
 * Requirements:
 * - 15.1: Retrieve relevant memories using hybrid retrieval
 * - 15.2: Expand via graph traversal
 * - 15.6: Return both synthesized answer and raw search results
 * - 15.7: Include citations with each answer
 * 
 * @param {Object} params - Reconstruction parameters
 * @param {string} params.query - User's search query
 * @param {Array<Object>} params.memories - Retrieved memories from hybrid retrieval
 * @param {Object} params.options - Reconstruction options
 * @returns {Promise<Object>} Complete reconstruction result
 */
async function reconstructMemory(params) {
  const {
    query,
    memories,
    options = {}
  } = params;

  if (!query || !memories || memories.length === 0) {
    return {
      synthesizedAnswer: null,
      citations: [],
      rawResults: memories || [],
      associationPaths: [],
      metadata: {
        memoriesRetrieved: 0,
        memoriesUsed: 0,
        synthesized: false,
        fallbackReason: 'No memories found'
      }
    };
  }

  try {
    // Synthesize answer using LLM
    const synthesis = await synthesizeAnswer(query, memories, options);
    
    // Generate citations
    const citations = generateCitations(
      synthesis.answer,
      memories,
      options.maxMemories || DEFAULT_OPTIONS.maxMemories
    );
    
    // Extract association paths
    const associationPaths = extractAssociationPaths(memories);
    
    return {
      synthesizedAnswer: synthesis.answer,
      citations,
      rawResults: memories,
      associationPaths,
      metadata: {
        memoriesRetrieved: memories.length,
        memoriesUsed: synthesis.memoriesUsed,
        synthesized: synthesis.synthesized,
        model: synthesis.model,
        promptTokens: synthesis.promptTokens,
        responseTokens: synthesis.responseTokens
      }
    };

  } catch (error) {
    // Requirement 15.7: Handle LLM synthesis failures (fallback to raw results)
    console.error('Memory reconstruction failed:', error);
    
    return {
      synthesizedAnswer: null,
      citations: [],
      rawResults: memories,
      associationPaths: extractAssociationPaths(memories),
      metadata: {
        memoriesRetrieved: memories.length,
        memoriesUsed: 0,
        synthesized: false,
        fallbackReason: error.message || 'LLM synthesis failed',
        error: error.message
      }
    };
  }
}

/**
 * Format citations as markdown links
 * 
 * Requirement 17.4: Format citations as clickable links
 * 
 * @param {Array<Object>} citations - Citation objects
 * @returns {string} Formatted citations string
 */
function formatCitationsAsMarkdown(citations) {
  if (!citations || citations.length === 0) {
    return '';
  }
  
  let formatted = '\n\n**Sources:**\n\n';
  
  citations.forEach((citation, index) => {
    formatted += `${index + 1}. [${citation.title}](${citation.url}) `;
    formatted += `(Relevance: ${(citation.relevanceScore * 100).toFixed(1)}%)\n`;
    if (citation.excerpt) {
      formatted += `   > ${citation.excerpt}\n`;
    }
    formatted += '\n';
  });
  
  return formatted;
}

/**
 * Format complete search response
 * 
 * @param {Object} reconstruction - Reconstruction result
 * @returns {Object} Formatted search response
 */
function formatSearchResponse(reconstruction) {
  const {
    synthesizedAnswer,
    citations,
    rawResults,
    associationPaths,
    metadata
  } = reconstruction;

  // Format answer with citations
  let formattedAnswer = synthesizedAnswer;
  if (synthesizedAnswer && citations.length > 0) {
    formattedAnswer += formatCitationsAsMarkdown(citations);
  }

  return {
    answer: formattedAnswer,
    synthesized: metadata.synthesized,
    citations: citations.map(c => ({
      memoryId: c.memoryId,
      title: c.title,
      url: c.url,
      relevanceScore: c.relevanceScore,
      excerpt: c.excerpt
    })),
    results: rawResults.map(r => ({
      memoryId: r.memoryId,
      title: r.title,
      url: r.url,
      timestamp: r.timestamp,
      engagementScore: r.engagementScore,
      memoryStrength: r.memoryStrength,
      decayedStrength: r.decayedStrength,
      isBookmarked: r.isBookmarked,
      isPinned: r.isPinned,
      scores: r.scores
    })),
    associationPaths: associationPaths.map(p => ({
      memoryId: p.memoryId,
      concepts: p.concepts,
      hops: p.hops
    })),
    metadata: {
      totalResults: rawResults.length,
      memoriesUsed: metadata.memoriesUsed,
      synthesized: metadata.synthesized,
      model: metadata.model,
      fallbackReason: metadata.fallbackReason
    }
  };
}

module.exports = {
  formatMemoriesForContext,
  generateSynthesisPrompt,
  synthesizeAnswer,
  identifyContributingMemories,
  generateCitations,
  extractAssociationPaths,
  reconstructMemory,
  formatCitationsAsMarkdown,
  formatSearchResponse,
  DEFAULT_OPTIONS
};
