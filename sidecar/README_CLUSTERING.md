# WebMind Clustering Setup

## Overview

WebMind uses HDBSCAN (Hierarchical Density-Based Spatial Clustering of Applications with Noise) for automatic memory clustering. The clustering system is implemented as a hybrid Node.js/Python architecture:

- **Node.js**: Handles API, orchestration, and data management
- **Python**: Performs heavy ML clustering using HDBSCAN

## Architecture

```
Node.js (clustering.js)
    ↓
Python (hdbscan_cluster.py)
    ↓
HDBSCAN Algorithm
    ↓
Returns cluster labels
    ↓
Node.js processes results
```

## Installation

### 1. Install Python Dependencies

The clustering system requires Python 3.7+ with the following packages:

```bash
cd sidecar
pip install -r requirements.txt
```

Or install individually:

```bash
pip install hdbscan numpy scikit-learn
```

### 2. Verify Installation

Test that HDBSCAN is installed correctly:

```bash
python3 -c "import hdbscan; print('HDBSCAN version:', hdbscan.__version__)"
```

Expected output:
```
HDBSCAN version: 0.8.33 (or higher)
```

## Usage

### Automatic Clustering

Clustering is triggered automatically when:
- 50 new memories have been added since last clustering
- Manual trigger via `/cluster` endpoint

### Manual Clustering

Trigger clustering via API:

```bash
curl -X POST http://localhost:3001/cluster \
  -H "Content-Type: application/json" \
  -d '{
    "options": {
      "minClusterSize": 3,
      "minSamples": 2,
      "crossClusterThreshold": 0.5
    }
  }'
```

### Configuration Options

- **minClusterSize** (default: 3): Minimum number of memories in a cluster
- **minSamples** (default: 2): Minimum samples in a neighborhood for a point to be core
- **crossClusterThreshold** (default: 0.5): Similarity threshold for cross-cluster associations

## Fallback Behavior

If Python or HDBSCAN is not available, the system automatically falls back to a simplified similarity-based clustering algorithm. This ensures the system continues to work even without Python dependencies.

## How HDBSCAN Works

HDBSCAN is a density-based clustering algorithm that:

1. **Builds a hierarchy** of clusters based on density
2. **Identifies stable clusters** using persistence
3. **Handles noise** by marking outliers as unclustered (label = -1)
4. **Adapts to varying densities** unlike k-means

### Advantages over K-Means

- No need to specify number of clusters
- Handles clusters of varying shapes and sizes
- Identifies and excludes noise points
- More robust to outliers

### Parameters

- **min_cluster_size**: Smallest grouping considered a cluster
  - Smaller values = more, smaller clusters
  - Larger values = fewer, larger clusters
  
- **min_samples**: How conservative the clustering is
  - Smaller values = more points assigned to clusters
  - Larger values = more points marked as noise

## Troubleshooting

### Python Not Found

**Error**: `Failed to spawn Python process`

**Solution**: Ensure Python 3 is installed and in PATH:

```bash
# Windows
python --version

# macOS/Linux
python3 --version
```

### HDBSCAN Not Installed

**Error**: `hdbscan not installed`

**Solution**: Install HDBSCAN:

```bash
pip install hdbscan
```

### Import Errors

**Error**: `ModuleNotFoundError: No module named 'hdbscan'`

**Solution**: Check Python environment:

```bash
# Verify which Python is being used
which python3  # macOS/Linux
where python   # Windows

# Install in correct environment
python3 -m pip install hdbscan
```

### Performance Issues

If clustering is slow with large datasets:

1. **Limit data size**: Use `limit` option to cluster subset
2. **Increase min_cluster_size**: Reduces computation
3. **Use sampling**: Cluster representative sample, then assign rest

## Performance

### Benchmarks

- **1,000 memories**: ~2-5 seconds
- **10,000 memories**: ~20-30 seconds
- **100,000 memories**: ~3-5 minutes

### Optimization Tips

1. **Batch processing**: Cluster in background, don't block API
2. **Incremental updates**: Only recluster when needed (50+ new memories)
3. **Caching**: Store cluster assignments, only recompute periodically

## Development

### Testing Clustering

Run clustering tests:

```bash
npm test clustering.test.js
```

### Testing Python Script Directly

Test the Python script independently:

```bash
echo '{"embeddings": [[1,0,0], [0.9,0.1,0], [0,0,1]], "min_cluster_size": 2}' | python3 hdbscan_cluster.py
```

Expected output:
```json
{
  "success": true,
  "labels": [0, 0, -1],
  "n_clusters": 1,
  "noise_points": 1,
  "probabilities": [0.95, 0.92, 0.0]
}
```

## References

- [HDBSCAN Documentation](https://hdbscan.readthedocs.io/)
- [HDBSCAN Paper](https://link.springer.com/chapter/10.1007/978-3-642-37456-2_14)
- [Comparing Clustering Algorithms](https://scikit-learn.org/stable/modules/clustering.html)
