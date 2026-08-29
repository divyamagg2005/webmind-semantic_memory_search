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

console.log("[WebMind Background] Background worker running - ready to receive page captures")

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
chrome.runtime.onMessage.addListener((message: PageData, sender, sendResponse) => {
  console.log("[WebMind Background] Received page capture:", {
    url: message.url,
    title: message.title,
    dwellTime: message.engagement?.dwellTime,
    scrollDepth: message.engagement?.scrollDepth,
    revisitCount: message.engagement?.revisitCount,
    sessionId: message.context?.sessionId,
    images: message.media?.images?.length || 0,
    videos: message.media?.videos?.length || 0
  })

  // Handle async processing - return true to keep message channel open
  ;(async () => {
    try {
      // Check bookmark status (content scripts don't have access to bookmarks API)
      const isBookmarked = await new Promise<boolean>((resolve) => {
        chrome.bookmarks.search({ url: message.url }, (results) => {
          if (chrome.runtime.lastError) {
            console.warn("[WebMind Background] Bookmark check failed:", chrome.runtime.lastError.message)
            resolve(false)
          } else {
            resolve(results.length > 0)
          }
        })
      })

      // Get tab group ID (content scripts have limited tabs API access)
      const tabGroupId = await new Promise<string | null>((resolve) => {
        if (!sender.tab?.id) {
          resolve(null)
          return
        }

        chrome.tabs.get(sender.tab.id, (tab) => {
          if (chrome.runtime.lastError) {
            console.warn("[WebMind Background] Tab group check failed:", chrome.runtime.lastError.message)
            resolve(null)
          } else if (tab.groupId && tab.groupId !== -1) {
            resolve(`group-${tab.groupId}`)
          } else {
            resolve(null)
          }
        })
      })

      // Update page data with bookmark status and tab group
      const pageDataWithEnrichment: PageData = {
        ...message,
        engagement: {
          ...message.engagement,
          isBookmarked
        },
        context: {
          ...message.context,
          tabGroupId
        }
      }

      const response = await fetch("http://localhost:3001/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ pageData: pageDataWithEnrichment })
      })

      if (!response.ok) {
        throw new Error(`Sidecar returned ${response.status}: ${response.statusText}`)
      }

      const result: IngestResponse = await response.json()

      console.log("[WebMind Background] Sidecar ingestion successful:", {
        memoryId: result.memoryId,
        conceptsExtracted: result.conceptsExtracted,
        associationsCreated: result.associationsCreated,
        isBookmarked,
        tabGroupId
      })
      
      sendResponse({ success: true, result })
    } catch (err) {
      // Requirement 4.5: Handle ingestion failures gracefully
      console.error("[WebMind Background] Failed to send to sidecar:", err)
      sendResponse({ success: false, error: err.message })
    }
  })()

  // Return true to indicate async response
  return true
})