/**
 * TypeScript interfaces for WebMind Human-Like Memory Engine
 * 
 * This file contains all data model interfaces for the memory system,
 * including page data, engagement metrics, API requests/responses,
 * and knowledge graph structures.
 */

// ============================================================================
// Content Script Interfaces
// ============================================================================

/**
 * Complete page data captured by content script
 */
export interface PageData {
  title: string;
  url: string;
  content: string;
  timestamp: string;
  engagement: EngagementMetrics;
  context: BrowsingContext;
  media: MediaContent;
}

/**
 * Engagement signals tracked during page viewing
 */
export interface EngagementMetrics {
  /** Total time spent viewing page in milliseconds */
  dwellTime: number;
  /** Maximum scroll depth as percentage (0-100) */
  scrollDepth: number;
  /** Number of times this URL has been visited */
  revisitCount: number;
  /** Whether the page is bookmarked */
  isBookmarked: boolean;
}

/**
 * Contextual information about browsing session and tab organization
 */
export interface BrowsingContext {
  /** Unique identifier for the current browsing session */
  sessionId: string;
  /** Chrome tab group identifier, null if not in a group */
  tabGroupId: string | null;
  /** Sequential position within the current session */
  sequenceNumber: number;
  /** URL of the previously visited page in this session */
  previousUrl: string | null;
}

/**
 * Media content extracted from the page
 */
export interface MediaContent {
  images: ImageData[];
  videos: VideoData[];
}

/**
 * Image metadata extracted from page
 */
export interface ImageData {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Video metadata extracted from page
 */
export interface VideoData {
  url: string;
  duration: number;
  thumbnailUrl: string;
}

// ============================================================================
// Sidecar Server API Interfaces
// ============================================================================

/**
 * Request to ingest a new page into the memory system
 */
export interface IngestRequest {
  pageData: PageData;
}

/**
 * Response from page ingestion
 */
export interface IngestResponse {
  success: boolean;
  memoryId: string;
  conceptsExtracted: number;
  associationsCreated: number;
}

/**
 * Request to search memories
 */
export interface SearchRequest {
  query: string;
  options?: SearchOptions;
}

/**
 * Optional filters and parameters for search
 */
export interface SearchOptions {
  /** Include memories with decayed strength */
  includeDecayed?: boolean;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Filter by specific session ID */
  sessionFilter?: string;
  /** Filter by specific tab group ID */
  tabGroupFilter?: string;
  /** Filter by time range */
  timeRange?: TimeRange;
}

/**
 * Time range filter for search
 */
export interface TimeRange {
  /** Start timestamp in ISO format */
  start: string;
  /** End timestamp in ISO format */
  end: string;
}

/**
 * Complete search response with synthesized answer and raw results
 */
export interface SearchResponse {
  synthesizedAnswer: string;
  citations: Citation[];
  rawResults: MemoryResult[];
  associationPaths: AssociationPath[];
}

/**
 * Source citation for synthesized answer
 */
export interface Citation {
  memoryId: string;
  title: string;
  url: string;
  relevanceScore: number;
  excerpt: string;
}

/**
 * Individual memory result from search
 */
export interface MemoryResult {
  memoryId: string;
  title: string;
  url: string;
  content: string;
  timestamp: string;
  memoryStrength: number;
  engagementScore: number;
  decayedStrength: number;
  matchedConcepts: string[];
  isPinned: boolean;
  isBookmarked: boolean;
}

/**
 * Association path between memories through concepts
 */
export interface AssociationPath {
  fromMemory: string;
  toMemory: string;
  /** Array of concept names forming the path */
  path: string[];
  strength: number;
}

/**
 * Request to trigger clustering
 */
export interface ClusterRequest {
  /** Force reclustering even if threshold not met */
  force?: boolean;
}

/**
 * Response from clustering operation
 */
export interface ClusterResponse {
  clustersCreated: number;
  memoriesClustered: number;
}

/**
 * Current system configuration
 */
export interface ConfigResponse {
  decayRate: number;
  engagementWeights: EngagementWeights;
  sessionTimeout: number;
  minClusterSize: number;
}

/**
 * Weights for engagement score calculation
 */
export interface EngagementWeights {
  dwellTime: number;
  scrollDepth: number;
  revisitCount: number;
}

/**
 * Request to update system configuration
 */
export interface ConfigUpdateRequest {
  decayRate?: number;
  engagementWeights?: Partial<EngagementWeights>;
  sessionTimeout?: number;
  minClusterSize?: number;
}

// ============================================================================
// Knowledge Graph Node Types
// ============================================================================

/**
 * Concept node in knowledge graph (entity or topic)
 */
export interface ConceptNode {
  id: string;
  name: string;
  type: 'entity' | 'topic';
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  occurrenceCount: number;
}

/**
 * Memory node in knowledge graph
 */
export interface MemoryNode {
  id: string;
  /** References SQLite record ID */
  memoryId: string;
  timestamp: string;
}

/**
 * Cluster node in knowledge graph
 */
export interface ClusterNode {
  id: string;
  label: string;
  size: number;
  /** Embedding vector representing cluster centroid */
  centroid: number[];
  createdAt: string;
}

// ============================================================================
// Knowledge Graph Edge Types
// ============================================================================

/**
 * Bidirectional association between concepts
 */
export interface ConceptAssociation {
  /** Source concept ID */
  from: string;
  /** Target concept ID */
  to: string;
  /** Association strength (0.0 to 1.0) */
  strength: number;
  /** Number of times concepts appeared together */
  coOccurrences: number;
  /** Last time this association was reinforced */
  lastReinforced: string;
}

/**
 * Link between memory and concept
 */
export interface MemoryConceptLink {
  memoryId: string;
  conceptId: string;
  /** Relevance of concept to this memory */
  relevance: number;
}

/**
 * Membership of memory in a cluster
 */
export interface ClusterMembership {
  memoryId: string;
  clusterId: string;
  /** Distance from cluster centroid */
  distance: number;
}

/**
 * Association between clusters
 */
export interface CrossClusterLink {
  fromCluster: string;
  toCluster: string;
  /** Similarity between cluster centroids */
  similarity: number;
}

// ============================================================================
// Storage Layer Interfaces
// ============================================================================

/**
 * Text embedding stored in LanceDB
 */
export interface TextEmbedding {
  memory_id: number;
  /** 768-dimensional vector from nomic-embed-text */
  vector: number[];
  text: string;
  title: string;
  url: string;
  timestamp: string;
}

/**
 * Image embedding stored in LanceDB
 */
export interface ImageEmbedding {
  image_id: number;
  memory_id: number;
  /** 512-dimensional vector from CLIP ViT-B/32 */
  vector: number[];
  image_url: string;
  alt_text: string;
}

/**
 * Video embedding stored in LanceDB
 */
export interface VideoEmbedding {
  video_id: number;
  memory_id: number;
  /** 512-dimensional vector from CLIP ViT-B/32 */
  vector: number[];
  video_url: string;
  thumbnail_url: string;
}

/**
 * Memory entry record in SQLite
 */
export interface MemoryEntry {
  id: number;
  title: string;
  url: string;
  content: string;
  timestamp: string;
  
  // Engagement metrics
  dwell_time: number;
  scroll_depth: number;
  revisit_count: number;
  last_accessed: string;
  
  // Context
  session_id: string;
  tab_group_id: string | null;
  sequence_number: number;
  previous_url: string | null;
  
  // Priority signals
  is_bookmarked: boolean;
  is_pinned: boolean;
  
  // Calculated scores
  engagement_score: number;
  memory_strength: number;
  
  // Metadata
  created_at: string;
  updated_at: string;
}

/**
 * Browsing session record in SQLite
 */
export interface BrowsingSession {
  id: string;
  start_time: string;
  end_time: string | null;
  page_count: number;
  /** JSON array of dominant concept names */
  dominant_concepts: string;
  label: string | null;
}

/**
 * Image record in SQLite
 */
export interface ImageRecord {
  id: number;
  memory_id: number;
  url: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * Video record in SQLite
 */
export interface VideoRecord {
  id: number;
  memory_id: number;
  url: string;
  duration: number;
  thumbnail_url: string;
}

/**
 * Configuration record in SQLite
 */
export interface ConfigRecord {
  key: string;
  value: string;
  updated_at: string;
}

// ============================================================================
// Calculation and Processing Interfaces
// ============================================================================

/**
 * Parameters for engagement score calculation
 */
export interface EngagementScoreParams {
  dwellTime: number;
  scrollDepth: number;
  revisitCount: number;
  weights: EngagementWeights;
}

/**
 * Parameters for memory strength calculation
 */
export interface MemoryStrengthParams {
  engagementScore: number;
  isBookmarked: boolean;
  uniqueVisitDates: number;
  associationBoost?: number;
}

/**
 * Parameters for decay calculation
 */
export interface DecayParams {
  memoryStrength: number;
  daysSinceAccess: number;
  revisitCount: number;
  isPinned: boolean;
  decayRate: number;
}

/**
 * Result of decay calculation
 */
export interface DecayResult {
  decayedStrength: number;
  effectiveDecayRate: number;
  decayResistance: number;
}

/**
 * Parameters for association strength calculation
 */
export interface AssociationStrengthParams {
  coOccurrences: number;
  maxCoOccurrences: number;
  daysSinceReinforcement: number;
}

/**
 * Concept extraction result
 */
export interface ExtractedConcept {
  name: string;
  type: 'entity' | 'topic';
  confidence: number;
  positions: number[];
}

/**
 * Session detection result
 */
export interface SessionDetectionResult {
  sessionId: string;
  isNewSession: boolean;
  reason: 'timeout' | 'similarity' | 'first_page';
}

/**
 * Multi-modal search scores
 */
export interface MultiModalScores {
  textScore: number;
  imageScore: number;
  combinedScore: number;
}

// ============================================================================
// Error and Status Types
// ============================================================================

/**
 * Error response from API
 */
export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  details?: unknown;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    sqlite: boolean;
    lancedb: boolean;
    graph: boolean;
    ollama: boolean;
  };
  timestamp: string;
}

/**
 * Migration progress status
 */
export interface MigrationProgress {
  phase: 'schema' | 'embeddings' | 'concepts' | 'validation' | 'complete';
  totalRecords: number;
  processedRecords: number;
  percentComplete: number;
  estimatedTimeRemaining: number;
  errors: string[];
}
