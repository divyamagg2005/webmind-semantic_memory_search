# WebMind Type Definitions

This directory contains TypeScript interface definitions for the WebMind Human-Like Memory Engine.

## Overview

The type definitions are organized into several categories:

### Content Script Interfaces
- **PageData**: Complete page data captured by content script
- **EngagementMetrics**: Engagement signals (dwell time, scroll depth, revisits)
- **BrowsingContext**: Session and tab group context
- **MediaContent**: Images and videos extracted from pages

### API Interfaces
- **IngestRequest/Response**: Page ingestion endpoints
- **SearchRequest/Response**: Memory search and retrieval
- **ClusterRequest/Response**: Clustering operations
- **ConfigResponse/UpdateRequest**: Configuration management

### Memory and Results
- **MemoryResult**: Individual search result with scores
- **Citation**: Source citation for synthesized answers
- **AssociationPath**: Concept-based connection between memories

### Knowledge Graph
- **ConceptNode**: Entities and topics in the graph
- **MemoryNode**: Memory entries in the graph
- **ClusterNode**: Automatically discovered memory clusters
- **ConceptAssociation**: Bidirectional concept relationships
- **MemoryConceptLink**: Links between memories and concepts
- **ClusterMembership**: Memory-to-cluster assignments
- **CrossClusterLink**: Inter-cluster relationships

### Storage Layer
- **TextEmbedding**: 768-dim vectors from nomic-embed-text
- **ImageEmbedding**: 512-dim vectors from CLIP ViT-B/32
- **VideoEmbedding**: 512-dim vectors from CLIP ViT-B/32
- **MemoryEntry**: SQLite memory record
- **BrowsingSession**: SQLite session record

### Calculation Interfaces
- **EngagementScoreParams**: Parameters for engagement calculation
- **MemoryStrengthParams**: Parameters for strength calculation
- **DecayParams/Result**: Memory decay calculations
- **AssociationStrengthParams**: Concept association strength

## Usage

Import types in your TypeScript files:

```typescript
import type { 
  PageData, 
  EngagementMetrics, 
  SearchRequest,
  MemoryResult 
} from '~/types';
```

## Key Concepts

### Engagement Score
Calculated from:
- Dwell time (normalized to 300s max) × 0.4
- Scroll depth (0-100%) × 0.3
- Log(1 + revisit count) × 0.3

### Memory Strength
Base strength from engagement, boosted by:
- Bookmark multiplier: 2.0×
- Revisit boost: log(1 + unique_visit_dates) × 0.1 (capped at 1.0)

### Memory Decay
Exponential decay: `strength × e^(-rate × days)`
- Decay resistance: 1 + (0.1 × revisit_count)
- Pinned memories: zero decay
- Max decay rate: 0.005

### Association Strength
Based on:
- Co-occurrence frequency (log-scaled)
- Recency factor: `e^(-0.01 × days_since_reinforcement)`

## Requirements Mapping

These interfaces satisfy:
- **Requirement 1.1**: Knowledge Graph Storage
- **Requirement 2.1**: Concept Extraction
- **Requirement 4.1**: Engagement Tracking
- **Requirement 9.5**: Session Detection
- **Requirement 12.1**: Image Embedding
- **Requirement 13.1**: Video Frame Embedding
- **Requirement 15.1**: Memory Reconstruction Pipeline

## Related Files

- `/sidecar/server.js`: Implements API endpoints using these types
- `/contents/webmind.ts`: Content script that captures PageData
- `/background.ts`: Background worker that forwards data
- `/popup.tsx`: UI that displays MemoryResult and Citations
