#!/usr/bin/env python3
"""
HDBSCAN Clustering Script for WebMind

This script performs density-based clustering on memory embeddings using HDBSCAN.
It reads embeddings from stdin as JSON and outputs cluster labels.

Requirements:
- hdbscan
- numpy
- scikit-learn (for additional metrics)

Install: pip install hdbscan numpy scikit-learn
"""

import sys
import json
import numpy as np

try:
    import hdbscan
except ImportError:
    print(json.dumps({
        "error": "hdbscan not installed. Install with: pip install hdbscan",
        "success": False
    }))
    sys.exit(1)


def cluster_embeddings(embeddings, min_cluster_size=3, min_samples=2):
    """
    Perform HDBSCAN clustering on embeddings.
    
    Args:
        embeddings: List of embedding vectors
        min_cluster_size: Minimum size of clusters
        min_samples: Minimum samples in a neighborhood for a point to be core
        
    Returns:
        Dictionary with cluster labels and metadata
    """
    if len(embeddings) < min_cluster_size:
        return {
            "success": True,
            "labels": [-1] * len(embeddings),
            "n_clusters": 0,
            "noise_points": len(embeddings),
            "message": "Not enough data points for clustering"
        }
    
    # Convert to numpy array
    X = np.array(embeddings, dtype=np.float32)
    
    # Perform HDBSCAN clustering
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom'  # Excess of Mass
    )
    
    labels = clusterer.fit_predict(X)
    
    # Calculate statistics
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_points = list(labels).count(-1)
    
    # Get cluster probabilities (confidence scores)
    probabilities = clusterer.probabilities_.tolist() if hasattr(clusterer, 'probabilities_') else []
    
    return {
        "success": True,
        "labels": labels.tolist(),
        "n_clusters": n_clusters,
        "noise_points": noise_points,
        "probabilities": probabilities
    }


def main():
    """Main entry point for the clustering script."""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        embeddings = input_data.get("embeddings", [])
        min_cluster_size = input_data.get("min_cluster_size", 3)
        min_samples = input_data.get("min_samples", 2)
        
        if not embeddings:
            print(json.dumps({
                "error": "No embeddings provided",
                "success": False
            }))
            sys.exit(1)
        
        # Perform clustering
        result = cluster_embeddings(embeddings, min_cluster_size, min_samples)
        
        # Output result as JSON
        print(json.dumps(result))
        
    except json.JSONDecodeError as e:
        print(json.dumps({
            "error": f"Invalid JSON input: {str(e)}",
            "success": False
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "error": f"Clustering failed: {str(e)}",
            "success": False
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
