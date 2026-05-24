/**
 * Example usage of WebMind type definitions
 * 
 * This file demonstrates how to use the interfaces defined in index.ts
 * and serves as a reference for developers.
 */

import type {
  PageData,
  EngagementMetrics,
  BrowsingContext,
  MediaContent,
  IngestRequest,
  SearchRequest,
  SearchResponse,
  MemoryResult,
  ConceptNode,
  ConceptAssociation,
} from './index';

// ============================================================================
// Example 1: Creating PageData from content script
// ============================================================================

function createPageData(): PageData {
  const engagement: EngagementMetrics = {
    dwellTime: 45000, // 45 seconds
    scrollDepth: 75.5, // 75.5% of page
    revisitCount: 2,
    isBookmarked: false,
  };

  const context: BrowsingContext = {
    sessionId: 'session-123',
    tabGroupId: 'group-456',
    sequenceNumber: 3,
    previousUrl: 'https://example.com/previous',
  };

  const media: MediaContent = {
    images: [
      {
        url: 'https://example.com/image.jpg',
        width: 800,
        height: 600,
        alt: 'Example image',
      },
    ],
    videos: [],
  };

  const pageData: PageData = {
    title: 'Example Page',
    url: 'https://example.com/page',
    content: 'This is the page content...',
    timestamp: new Date().toISOString(),
    engagement,
    context,
    media,
  };

  return pageData;
}

// ============================================================================
// Example 2: Creating an ingest request
// ============================================================================

function createIngestRequest(pageData: PageData): IngestRequest {
  return {
    pageData,
  };
}

// ============================================================================
// Example 3: Creating a search request
// ============================================================================

function createSearchRequest(query: string): SearchRequest {
  return {
    query,
    options: {
      maxResults: 10,
      includeDecayed: false,
      timeRange: {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
        end: new Date().toISOString(),
      },
    },
  };
}

// ============================================================================
// Example 4: Processing search results
// ============================================================================

function processSearchResults(response: SearchResponse): void {
  console.log('Synthesized Answer:', response.synthesizedAnswer);
  
  console.log('\nCitations:');
  response.citations.forEach((citation, index) => {
    console.log(`${index + 1}. ${citation.title}`);
    console.log(`   URL: ${citation.url}`);
    console.log(`   Relevance: ${citation.relevanceScore.toFixed(2)}`);
    console.log(`   Excerpt: ${citation.excerpt}`);
  });
  
  console.log('\nRaw Results:');
  response.rawResults.forEach((result: MemoryResult) => {
    console.log(`- ${result.title}`);
    console.log(`  Memory Strength: ${result.memoryStrength.toFixed(2)}`);
    console.log(`  Decayed Strength: ${result.decayedStrength.toFixed(2)}`);
    console.log(`  Matched Concepts: ${result.matchedConcepts.join(', ')}`);
    console.log(`  Pinned: ${result.isPinned}, Bookmarked: ${result.isBookmarked}`);
  });
  
  console.log('\nAssociation Paths:');
  response.associationPaths.forEach((path) => {
    console.log(`${path.fromMemory} -> ${path.toMemory}`);
    console.log(`  Path: ${path.path.join(' -> ')}`);
    console.log(`  Strength: ${path.strength.toFixed(2)}`);
  });
}

// ============================================================================
// Example 5: Working with concept nodes
// ============================================================================

function createConceptNode(name: string, type: 'entity' | 'topic'): ConceptNode {
  return {
    id: `concept-${Date.now()}`,
    name,
    type,
    confidence: 0.85,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    occurrenceCount: 1,
  };
}

// ============================================================================
// Example 6: Creating concept associations
// ============================================================================

function createConceptAssociation(
  fromId: string,
  toId: string,
  coOccurrences: number
): ConceptAssociation {
  return {
    from: fromId,
    to: toId,
    strength: 0.75,
    coOccurrences,
    lastReinforced: new Date().toISOString(),
  };
}

// ============================================================================
// Example 7: Type guards for error handling
// ============================================================================

function isErrorResponse(response: unknown): response is { success: false; error: string } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === false &&
    'error' in response
  );
}

async function safeIngest(pageData: PageData): Promise<void> {
  try {
    const response = await fetch('http://localhost:3001/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageData }),
    });
    
    const result = await response.json();
    
    if (isErrorResponse(result)) {
      console.error('Ingestion failed:', result.error);
      return;
    }
    
    console.log('Ingestion successful:', result);
  } catch (error) {
    console.error('Network error:', error);
  }
}

// ============================================================================
// Example 8: Calculating engagement score
// ============================================================================

function calculateEngagementScore(metrics: EngagementMetrics): number {
  // Normalize dwell time (max 300 seconds = 1.0)
  const normalizedDwellTime = Math.min(metrics.dwellTime / 300000, 1.0);
  
  // Convert scroll depth to 0-1 range
  const normalizedScrollDepth = metrics.scrollDepth / 100;
  
  // Logarithmic scaling of revisit count
  const normalizedRevisitCount = Math.log(1 + metrics.revisitCount);
  
  // Weighted combination
  const engagementScore =
    normalizedDwellTime * 0.4 +
    normalizedScrollDepth * 0.3 +
    normalizedRevisitCount * 0.3;
  
  return engagementScore;
}

// ============================================================================
// Example 9: Type-safe configuration updates
// ============================================================================

import type { ConfigUpdateRequest } from './index';

function updateDecayRate(newRate: number): ConfigUpdateRequest {
  // Validate decay rate is between 0 and 1
  if (newRate < 0 || newRate > 1) {
    throw new Error('Decay rate must be between 0 and 1');
  }
  
  return {
    decayRate: newRate,
  };
}

function updateEngagementWeights(
  dwellTime?: number,
  scrollDepth?: number,
  revisitCount?: number
): ConfigUpdateRequest {
  return {
    engagementWeights: {
      ...(dwellTime !== undefined && { dwellTime }),
      ...(scrollDepth !== undefined && { scrollDepth }),
      ...(revisitCount !== undefined && { revisitCount }),
    },
  };
}

// Export examples for testing
export {
  createPageData,
  createIngestRequest,
  createSearchRequest,
  processSearchResults,
  createConceptNode,
  createConceptAssociation,
  isErrorResponse,
  safeIngest,
  calculateEngagementScore,
  updateDecayRate,
  updateEngagementWeights,
};
