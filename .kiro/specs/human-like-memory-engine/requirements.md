# Requirements Document

## Introduction

WebMind is evolving from a basic semantic search engine into a computational memory system that models human memory. The system will prioritize, forget, connect, contextualize, and recall information like a human brain through eight key capabilities: associative memory, engagement tracking, memory decay, contextual memory, multi-modal memory, memory reconstruction, priority weighting, and autonomous linking.

This transformation will enable WebMind to function as a memory assistant rather than a simple search engine, synthesizing information from browsing history to answer questions and surface relevant connections.

## Glossary

- **Memory_System**: The complete WebMind application including Chrome extension, sidecar server, and storage layers
- **Knowledge_Graph**: Graph database storing concepts, entities, and relationships between memories
- **Memory_Entry**: A stored webpage with metadata including title, URL, content, timestamp, and engagement metrics
- **Engagement_Score**: Numerical value derived from behavioral signals (dwell time, revisit count, scroll depth)
- **Memory_Strength**: Combined score from engagement, recency, and associations determining recall priority
- **Decay_Function**: Exponential function that reduces memory strength over time
- **Browsing_Session**: Sequence of related page visits within a temporal and contextual boundary
- **Association**: Bidirectional relationship between concepts, entities, or memories in the Knowledge_Graph
- **Embedding**: Vector representation of content (text, image, video) in high-dimensional space
- **Memory_Reconstruction**: LLM-powered synthesis of retrieved memory fragments into coherent answers
- **Content_Script**: Chrome extension component that captures page data
- **Sidecar_Server**: Local Node.js server handling storage, embeddings, and retrieval
- **Vector_Store**: LanceDB instance storing embeddings for semantic search
- **Metadata_Store**: SQLite database storing structured page metadata
- **Ollama**: Local LLM inference engine for embeddings and synthesis
- **CLIP**: Multi-modal embedding model for images and text
- **Concept**: Named entity or topic extracted from page content
- **Memory_Cluster**: Group of related memories automatically linked by content similarity

## Requirements

### Requirement 1: Knowledge Graph Storage

**User Story:** As a user, I want the system to store relationships between concepts I encounter, so that recalling one concept activates related memories.

#### Acceptance Criteria

1. THE Memory_System SHALL store concepts extracted from Memory_Entry content in the Knowledge_Graph
2. THE Memory_System SHALL store entities extracted from Memory_Entry content in the Knowledge_Graph
3. THE Memory_System SHALL create bidirectional associations between concepts in the Knowledge_Graph
4. THE Memory_System SHALL create associations between Memory_Entry records and related concepts
5. WHEN a concept is queried, THE Memory_System SHALL retrieve all associated concepts within 2 relationship hops
6. THE Memory_System SHALL assign association strength scores based on co-occurrence frequency
7. FOR ALL concept pairs with association strength above 0.3, the Knowledge_Graph SHALL maintain a persistent relationship

### Requirement 2: Concept Extraction

**User Story:** As a user, I want the system to automatically identify key concepts from pages I visit, so that my memories are organized by meaningful topics.

#### Acceptance Criteria

1. WHEN a Memory_Entry is created, THE Memory_System SHALL extract named entities using natural language processing
2. WHEN a Memory_Entry is created, THE Memory_System SHALL extract key topics using term frequency analysis
3. THE Memory_System SHALL normalize concept names to canonical forms
4. THE Memory_System SHALL filter extracted concepts to exclude common stopwords
5. THE Memory_System SHALL assign confidence scores to extracted concepts
6. THE Memory_System SHALL store only concepts with confidence scores above 0.6

### Requirement 3: Associative Retrieval

**User Story:** As a user, I want search results to include pages connected through concept relationships, so that I discover relevant memories I might have forgotten.

#### Acceptance Criteria

1. WHEN a search query matches a concept, THE Memory_System SHALL retrieve Memory_Entry records directly associated with that concept
2. WHEN a search query matches a concept, THE Memory_System SHALL retrieve Memory_Entry records associated with related concepts
3. THE Memory_System SHALL boost Memory_Strength scores for memories with multiple concept matches
4. THE Memory_System SHALL rank results by combined semantic similarity and association strength
5. FOR ALL retrieved memories, the Memory_System SHALL include the association path in result metadata

### Requirement 4: Engagement Tracking

**User Story:** As a user, I want pages I spend more time reading to rank higher in search results, so that important memories are prioritized over quickly skimmed content.

#### Acceptance Criteria

1. THE Content_Script SHALL measure page dwell time from load to tab close or navigation
2. THE Content_Script SHALL track scroll depth as percentage of page height
3. THE Content_Script SHALL count revisit events for each unique URL
4. THE Memory_System SHALL calculate Engagement_Score from dwell time, scroll depth, and revisit count
5. THE Memory_System SHALL store Engagement_Score with each Memory_Entry
6. WHEN calculating Memory_Strength, THE Memory_System SHALL weight Engagement_Score with coefficient 0.4
7. THE Memory_System SHALL update Engagement_Score when a Memory_Entry is revisited

### Requirement 5: Dwell Time Measurement

**User Story:** As a user, I want the system to distinguish between pages I read carefully and pages I glanced at, so that search results reflect actual engagement.

#### Acceptance Criteria

1. THE Content_Script SHALL start a timer when a page becomes visible
2. THE Content_Script SHALL pause the timer when the tab loses focus
3. THE Content_Script SHALL resume the timer when the tab regains focus
4. THE Content_Script SHALL stop the timer when the page is unloaded
5. THE Content_Script SHALL send total dwell time to the Sidecar_Server
6. THE Memory_System SHALL classify dwell time below 10 seconds as low engagement
7. THE Memory_System SHALL classify dwell time above 120 seconds as high engagement

### Requirement 6: Scroll Depth Tracking

**User Story:** As a user, I want the system to recognize when I read an entire article versus just the headline, so that fully consumed content ranks higher.

#### Acceptance Criteria

1. THE Content_Script SHALL calculate maximum scroll position as percentage of document height
2. THE Content_Script SHALL update scroll depth continuously during page viewing
3. THE Content_Script SHALL send final scroll depth to the Sidecar_Server on page unload
4. THE Memory_System SHALL classify scroll depth below 25 percent as low engagement
5. THE Memory_System SHALL classify scroll depth above 75 percent as high engagement

### Requirement 7: Memory Decay

**User Story:** As a user, I want old memories to naturally fade unless reinforced, so that recent information is prioritized and my memory system doesn't treat everything equally.

#### Acceptance Criteria

1. THE Memory_System SHALL apply exponential decay to Memory_Strength based on time since last access
2. THE Decay_Function SHALL use formula: strength × e^(-0.02 × days_since_access)
3. WHEN a Memory_Entry is accessed, THE Memory_System SHALL reset the decay timer
4. WHEN calculating search rankings, THE Memory_System SHALL apply the Decay_Function to all Memory_Entry records
5. THE Memory_System SHALL recalculate decayed Memory_Strength at query time
6. THE Memory_System SHALL preserve original Engagement_Score independent of decay

### Requirement 8: Memory Reinforcement

**User Story:** As a user, I want frequently revisited pages to resist decay, so that important recurring information remains accessible.

#### Acceptance Criteria

1. WHEN a Memory_Entry is revisited, THE Memory_System SHALL increment its revisit counter
2. THE Memory_System SHALL reduce decay rate for Memory_Entry records with revisit count above 3
3. THE Memory_System SHALL calculate decay resistance as: 1 + (0.1 × revisit_count)
4. THE Memory_System SHALL divide the decay coefficient by decay resistance
5. FOR ALL Memory_Entry records with revisit count above 10, the decay coefficient SHALL not exceed 0.005

### Requirement 9: Session Detection

**User Story:** As a user, I want the system to recognize when I'm researching a topic across multiple pages, so that related browsing is grouped as a coherent memory.

#### Acceptance Criteria

1. THE Memory_System SHALL create a new Browsing_Session when 30 minutes elapse between page visits
2. THE Memory_System SHALL assign each Memory_Entry to the current Browsing_Session
3. THE Memory_System SHALL detect topic continuity by comparing embeddings of consecutive pages
4. WHEN embedding similarity exceeds 0.7 between consecutive pages, THE Memory_System SHALL maintain the current Browsing_Session
5. THE Memory_System SHALL store session metadata including start time, end time, and page count
6. THE Memory_System SHALL assign session labels based on dominant concepts

### Requirement 10: Sequential Context

**User Story:** As a user, I want the system to remember the order I visited pages, so that I can recall "what I read after that Rust article."

#### Acceptance Criteria

1. THE Memory_System SHALL store page visit sequence within each Browsing_Session
2. THE Memory_System SHALL assign sequential position numbers to Memory_Entry records within sessions
3. WHEN querying by temporal context, THE Memory_System SHALL retrieve pages by session and sequence
4. THE Memory_System SHALL support queries for pages visited before or after a specified Memory_Entry
5. THE Memory_System SHALL include sequential neighbors in associative retrieval results

### Requirement 11: Tab Group Context

**User Story:** As a user, I want pages opened in the same tab group to be contextually linked, so that my organizational structure is preserved in memory.

#### Acceptance Criteria

1. THE Content_Script SHALL detect the Chrome tab group identifier for each page
2. THE Memory_System SHALL store tab group identifier with each Memory_Entry
3. THE Memory_System SHALL create associations between Memory_Entry records in the same tab group
4. WHEN querying, THE Memory_System SHALL boost results from the same tab group as the query context
5. THE Memory_System SHALL support filtering search results by tab group

### Requirement 12: Image Embedding

**User Story:** As a user, I want to search for pages by visual content, so that I can find "that page with the dark themed database diagram."

#### Acceptance Criteria

1. THE Content_Script SHALL extract image URLs from page content
2. THE Content_Script SHALL filter images by minimum dimensions of 200×200 pixels
3. THE Sidecar_Server SHALL generate CLIP embeddings for extracted images
4. THE Memory_System SHALL store image embeddings in the Vector_Store
5. THE Memory_System SHALL link image embeddings to parent Memory_Entry records
6. WHEN a text query describes visual content, THE Memory_System SHALL search both text and image embeddings
7. THE Memory_System SHALL support image-to-image similarity search

### Requirement 13: Video Frame Embedding

**User Story:** As a user, I want to search for video content by visual appearance, so that I can find educational videos by their diagrams or demonstrations.

#### Acceptance Criteria

1. THE Content_Script SHALL detect video elements on pages
2. THE Content_Script SHALL extract video metadata including duration and thumbnail URL
3. THE Sidecar_Server SHALL generate CLIP embeddings for video thumbnails
4. THE Memory_System SHALL store video embeddings in the Vector_Store
5. THE Memory_System SHALL link video embeddings to parent Memory_Entry records
6. WHEN a query matches video content, THE Memory_System SHALL include video timestamp metadata

### Requirement 14: Multi-Modal Query Processing

**User Story:** As a user, I want to search using natural language that describes visual content, so that I can find pages by appearance without remembering exact text.

#### Acceptance Criteria

1. WHEN a query contains visual descriptors, THE Memory_System SHALL generate both text and CLIP embeddings
2. THE Memory_System SHALL search text embeddings with weight 0.6 and image embeddings with weight 0.4
3. THE Memory_System SHALL combine multi-modal similarity scores using weighted average
4. THE Memory_System SHALL rank results by combined multi-modal score
5. THE Memory_System SHALL support queries like "dark themed diagram" or "code screenshot"

### Requirement 15: Memory Reconstruction Pipeline

**User Story:** As a user, I want the system to synthesize answers from my browsing history, so that I get coherent responses instead of just search results.

#### Acceptance Criteria

1. WHEN a query is submitted, THE Memory_System SHALL retrieve relevant Memory_Entry records using semantic search
2. THE Memory_System SHALL expand retrieved memories by traversing the Knowledge_Graph
3. THE Memory_System SHALL collect content fragments from retrieved and associated memories
4. THE Memory_System SHALL send query and fragments to Ollama for synthesis
5. THE Memory_System SHALL generate a coherent answer combining information from multiple memories
6. THE Memory_System SHALL include source citations with each synthesized answer
7. THE Memory_System SHALL return both synthesized answer and raw search results

### Requirement 16: Graph Expansion

**User Story:** As a user, I want the system to include related concepts when answering questions, so that responses are comprehensive and contextual.

#### Acceptance Criteria

1. WHEN reconstructing memory, THE Memory_System SHALL identify concepts in the top 5 retrieved memories
2. THE Memory_System SHALL traverse the Knowledge_Graph to find associated concepts
3. THE Memory_System SHALL retrieve Memory_Entry records associated with expanded concepts
4. THE Memory_System SHALL limit graph expansion to 2 relationship hops
5. THE Memory_System SHALL include expanded memories in the synthesis context
6. THE Memory_System SHALL weight expanded memories lower than directly retrieved memories

### Requirement 17: Source Citation

**User Story:** As a user, I want synthesized answers to cite their sources, so that I can verify information and revisit original pages.

#### Acceptance Criteria

1. THE Memory_System SHALL track which Memory_Entry records contributed to each synthesized answer
2. THE Memory_System SHALL include title, URL, and relevance score for each source
3. THE Memory_System SHALL order citations by contribution to the answer
4. THE Memory_System SHALL format citations as clickable links in the user interface
5. THE Memory_System SHALL highlight which parts of the answer came from which sources

### Requirement 18: Bookmark Integration

**User Story:** As a user, I want bookmarked pages to have higher memory strength, so that content I explicitly saved is prioritized.

#### Acceptance Criteria

1. THE Content_Script SHALL detect when a page is bookmarked
2. THE Memory_System SHALL apply a bookmark boost multiplier of 2.0 to Memory_Strength
3. WHEN a bookmark is removed, THE Memory_System SHALL remove the boost multiplier
4. THE Memory_System SHALL persist bookmark status with each Memory_Entry
5. WHEN ranking search results, THE Memory_System SHALL apply bookmark boost before decay

### Requirement 19: Manual Pinning

**User Story:** As a user, I want to manually pin important memories, so that critical information never decays.

#### Acceptance Criteria

1. THE Memory_System SHALL provide a user interface control to pin Memory_Entry records
2. WHEN a Memory_Entry is pinned, THE Memory_System SHALL set decay coefficient to 0
3. THE Memory_System SHALL display pinned status in search results
4. THE Memory_System SHALL support unpinning to restore normal decay
5. THE Memory_System SHALL persist pin status across application restarts

### Requirement 20: Revisit Importance

**User Story:** As a user, I want pages I visit repeatedly to rank higher, so that frequently referenced information is easily accessible.

#### Acceptance Criteria

1. THE Memory_System SHALL weight revisit count with coefficient 0.3 in Memory_Strength calculation
2. THE Memory_System SHALL apply logarithmic scaling to revisit count: log(1 + revisit_count)
3. THE Memory_System SHALL track unique visit dates to distinguish daily revisits from same-day refreshes
4. THE Memory_System SHALL boost Memory_Strength by 0.1 for each unique visit date
5. THE Memory_System SHALL cap revisit boost at 1.0 to prevent dominance over other factors

### Requirement 21: Automatic Clustering

**User Story:** As a user, I want the system to automatically group related content, so that I discover thematic connections without manual tagging.

#### Acceptance Criteria

1. THE Memory_System SHALL perform clustering analysis on Memory_Entry embeddings weekly
2. THE Memory_System SHALL use HDBSCAN algorithm with minimum cluster size of 3
3. THE Memory_System SHALL assign Memory_Cluster labels based on dominant concepts
4. THE Memory_System SHALL create associations between Memory_Entry records in the same Memory_Cluster
5. THE Memory_System SHALL support browsing memories by cluster
6. THE Memory_System SHALL recalculate clusters when 50 new Memory_Entry records are added

### Requirement 22: Cluster Labeling

**User Story:** As a user, I want automatically created clusters to have meaningful names, so that I understand what each group represents.

#### Acceptance Criteria

1. WHEN a Memory_Cluster is created, THE Memory_System SHALL extract the top 10 concepts from cluster members
2. THE Memory_System SHALL send concepts to Ollama to generate a descriptive cluster label
3. THE Memory_System SHALL limit cluster labels to 5 words
4. THE Memory_System SHALL store cluster labels in the Knowledge_Graph
5. THE Memory_System SHALL display cluster labels in the user interface
6. THE Memory_System SHALL allow users to rename cluster labels

### Requirement 23: Cross-Cluster Associations

**User Story:** As a user, I want the system to recognize when different topic clusters are related, so that I can navigate between connected areas of knowledge.

#### Acceptance Criteria

1. THE Memory_System SHALL calculate similarity between Memory_Cluster centroids
2. WHEN cluster similarity exceeds 0.5, THE Memory_System SHALL create a cross-cluster association
3. THE Memory_System SHALL store cross-cluster associations in the Knowledge_Graph
4. WHEN browsing a cluster, THE Memory_System SHALL suggest related clusters
5. THE Memory_System SHALL support graph visualization of cluster relationships

### Requirement 24: Embedding Model Management

**User Story:** As a developer, I want the system to use consistent embedding models, so that vector similarity remains meaningful over time.

#### Acceptance Criteria

1. THE Memory_System SHALL use nomic-embed-text model for text embeddings
2. THE Memory_System SHALL use CLIP ViT-B/32 model for image embeddings
3. THE Memory_System SHALL store model version metadata with each embedding
4. WHEN an embedding model is updated, THE Memory_System SHALL flag affected embeddings for regeneration
5. THE Memory_System SHALL support batch re-embedding of historical content

### Requirement 25: LLM Integration

**User Story:** As a developer, I want the system to use local LLM inference, so that user data remains private and the system works offline.

#### Acceptance Criteria

1. THE Memory_System SHALL use Ollama for all LLM inference tasks
2. THE Memory_System SHALL support configurable LLM model selection
3. THE Memory_System SHALL default to llama3.2 model for memory reconstruction
4. THE Memory_System SHALL handle Ollama connection failures gracefully
5. THE Memory_System SHALL fall back to search-only mode when LLM is unavailable

### Requirement 26: Privacy Preservation

**User Story:** As a user, I want all my browsing data to stay on my device, so that my memory system is completely private.

#### Acceptance Criteria

1. THE Memory_System SHALL store all data locally on the user's device
2. THE Memory_System SHALL NOT send any data to external servers
3. THE Memory_System SHALL use local Ollama instance for all embeddings and synthesis
4. THE Memory_System SHALL encrypt the Metadata_Store using SQLite encryption extension
5. THE Memory_System SHALL provide data export functionality in standard formats

### Requirement 27: Performance Optimization

**User Story:** As a user, I want search results to appear within 500 milliseconds, so that memory recall feels instantaneous.

#### Acceptance Criteria

1. THE Memory_System SHALL return search results within 500 milliseconds for 95 percent of queries
2. THE Memory_System SHALL use approximate nearest neighbor search for vector queries
3. THE Memory_System SHALL cache frequently accessed Memory_Entry records
4. THE Memory_System SHALL index the Knowledge_Graph for fast traversal
5. THE Memory_System SHALL limit graph expansion to prevent query timeout

### Requirement 28: Scalability

**User Story:** As a user, I want the system to handle years of browsing history, so that my memory system grows with my knowledge.

#### Acceptance Criteria

1. THE Memory_System SHALL support at least 100,000 Memory_Entry records
2. THE Memory_System SHALL maintain sub-second query performance with 100,000 records
3. THE Memory_System SHALL implement incremental indexing for new content
4. THE Memory_System SHALL support archiving of low-strength memories to reduce active dataset size
5. THE Memory_System SHALL provide storage usage statistics in the user interface

### Requirement 29: Data Migration

**User Story:** As a user, I want to migrate my existing WebMind data to the new memory system, so that I don't lose my browsing history.

#### Acceptance Criteria

1. THE Memory_System SHALL detect existing WebMind SQLite and LanceDB data
2. THE Memory_System SHALL migrate existing Memory_Entry records to the new schema
3. THE Memory_System SHALL generate missing engagement metrics using default values
4. THE Memory_System SHALL extract concepts from historical content during migration
5. THE Memory_System SHALL preserve original timestamps during migration
6. THE Memory_System SHALL complete migration of 10,000 records within 10 minutes

### Requirement 30: Configuration Management

**User Story:** As a user, I want to customize memory system behavior, so that it matches my personal preferences.

#### Acceptance Criteria

1. THE Memory_System SHALL provide configuration for decay rate coefficient
2. THE Memory_System SHALL provide configuration for engagement score weights
3. THE Memory_System SHALL provide configuration for session timeout duration
4. THE Memory_System SHALL provide configuration for minimum cluster size
5. THE Memory_System SHALL validate configuration values before applying
6. THE Memory_System SHALL persist configuration in a JSON file
7. THE Memory_System SHALL apply configuration changes without requiring restart
