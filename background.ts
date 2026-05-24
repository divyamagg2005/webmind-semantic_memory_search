/**
 * WebMind Background Worker
 * 
 * Receives enhanced page data from content script and forwards to sidecar server.
 * Handles ingestion failures gracefully.
 * Monitors bookmark changes to update memory strength.
 * 
 * Requirements: 4.1, 4.5, 18.3, 18.4
 */

import type { PageData, IngestResponse } from "~types"

console.log("WebMind background worker running")

// ============================================================================
// BOOKMARK CHANGE MONITORING (Requirements 18.3, 18.4)
// ============================================================================

/**
 * Update bookmark status in sidecar when bookmark is added
 * Requirement 18.3: Handle bookmark addition
 */
chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
  if (bookmark.url) {
    try {
      const response = await fetch("http://localhost:3001/bookmark", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: bookmark.url,
          isBookmarked: true
        })
      })

      if (response.ok) {
        const result = await response.json()
        console.log(`Bookmark added: ${bookmark.url} (${result.memoriesUpdated} memories updated)`)
      }
    } catch (err) {
      console.error("Failed to update bookmark status:", err)
    }
  }
})

/**
 * Update bookmark status in sidecar when bookmark is removed
 * Requirement 18.3: Handle bookmark removal
 */
chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  if (removeInfo.node.url) {
    try {
      const response = await fetch("http://localhost:3001/bookmark", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          url: removeInfo.node.url,
          isBookmarked: false
        })
      })

      if (response.ok) {
        const result = await response.json()
        console.log(`Bookmark removed: ${removeInfo.node.url} (${result.memoriesUpdated} memories updated)`)
      }
    } catch (err) {
      console.error("Failed to update bookmark status:", err)
    }
  }
})

/**
 * Forward enhanced page data to sidecar server
 * Requirement 4.5: Forward to sidecar /ingest endpoint
 */
chrome.runtime.onMessage.addListener(async (message: PageData) => {
  console.log("Received from content script:", {
    url: message.url,
    title: message.title,
    dwellTime: message.engagement?.dwellTime,
    scrollDepth: message.engagement?.scrollDepth,
    revisitCount: message.engagement?.revisitCount,
    sessionId: message.context?.sessionId,
    images: message.media?.images?.length || 0,
    videos: message.media?.videos?.length || 0
  })

  try {
    const response = await fetch("http://localhost:3001/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ pageData: message })
    })

    if (!response.ok) {
      throw new Error(`Sidecar returned ${response.status}: ${response.statusText}`)
    }

    const result: IngestResponse = await response.json()

    console.log("Sidecar ingestion successful:", {
      memoryId: result.memoryId,
      conceptsExtracted: result.conceptsExtracted,
      associationsCreated: result.associationsCreated
    })
  } catch (err) {
    // Requirement 4.5: Handle ingestion failures gracefully
    console.error("Failed to send to sidecar:", err)
    
    // Could implement retry logic or queue for later
    // For now, just log the error
  }
})