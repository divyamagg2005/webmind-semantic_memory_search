/**
 * WebMind Content Script - Enhanced Engagement Tracking
 * 
 * Tracks user engagement signals:
 * - Dwell time (with pause/resume on blur/focus)
 * - Scroll depth (maximum percentage reached)
 * - Revisit count (from local storage)
 * - Tab group and session context
 * - Media content extraction (images and videos)
 * 
 * Requirements: 5.1-5.5, 6.1-6.3, 4.3, 4.7, 11.1, 10.1, 12.1-12.2, 13.1-13.2
 */

import type { PageData, EngagementMetrics, BrowsingContext, MediaContent, ImageData, VideoData } from "~types"

console.log("WebMind Active - Enhanced Engagement Tracking")

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/** Maximum scroll depth reached as percentage (0-100) */
let maxScrollDepth = 0

/** Total dwell time in milliseconds */
let totalDwellTime = 0

/** Timestamp when page became visible */
let dwellStartTime: number | null = null

/** Whether the page is currently visible */
let isPageVisible = true

/** Current session ID */
let currentSessionId: string | null = null

/** Sequence number within current session */
let sequenceNumber = 0

/** Previous URL in session */
let previousUrl: string | null = null

// ============================================================================
// DWELL TIME TRACKING (Requirements 5.1-5.5)
// ============================================================================

/**
 * Start the dwell time timer
 * Requirement 5.1: Implement timer that starts when page becomes visible
 */
function startDwellTimer(): void {
  if (dwellStartTime === null && isPageVisible) {
    dwellStartTime = Date.now()
  }
}

/**
 * Pause the dwell time timer
 * Requirement 5.2: Pause timer on tab blur
 */
function pauseDwellTimer(): void {
  if (dwellStartTime !== null) {
    const elapsed = Date.now() - dwellStartTime
    totalDwellTime += elapsed
    dwellStartTime = null
  }
}

/**
 * Resume the dwell time timer
 * Requirement 5.2: Resume timer on focus
 */
function resumeDwellTimer(): void {
  if (dwellStartTime === null && isPageVisible) {
    dwellStartTime = Date.now()
  }
}

/**
 * Stop the dwell time timer and return total time
 * Requirement 5.3: Stop timer on page unload
 */
function stopDwellTimer(): number {
  pauseDwellTimer()
  return totalDwellTime
}

/**
 * Get current total dwell time without stopping timer
 */
function getCurrentDwellTime(): number {
  let current = totalDwellTime
  if (dwellStartTime !== null) {
    current += Date.now() - dwellStartTime
  }
  return current
}

// Listen for visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isPageVisible = false
    pauseDwellTimer()
  } else {
    isPageVisible = true
    resumeDwellTimer()
  }
})

// Listen for window blur/focus
window.addEventListener('blur', () => {
  pauseDwellTimer()
})

window.addEventListener('focus', () => {
  resumeDwellTimer()
})

// Start timer on load
startDwellTimer()

// ============================================================================
// SCROLL DEPTH TRACKING (Requirements 6.1-6.3)
// ============================================================================

/**
 * Calculate current scroll depth as percentage of document height
 * Requirement 6.1: Calculate maximum scroll position as percentage of document height
 */
function calculateScrollDepth(): number {
  const windowHeight = window.innerHeight
  const documentHeight = document.documentElement.scrollHeight
  const scrollTop = window.scrollY || document.documentElement.scrollTop
  
  // Calculate how far down the page we've scrolled as a percentage
  const scrollableHeight = documentHeight - windowHeight
  
  // Handle edge case where page is shorter than viewport
  if (scrollableHeight <= 0) {
    return 100
  }
  
  const scrollPercentage = (scrollTop / scrollableHeight) * 100
  return Math.min(Math.max(scrollPercentage, 0), 100) // Clamp between 0 and 100
}

/**
 * Update maximum scroll depth continuously
 * Requirement 6.2: Update scroll depth continuously during page viewing
 */
function updateScrollDepth(): void {
  const currentScrollDepth = calculateScrollDepth()
  maxScrollDepth = Math.max(maxScrollDepth, currentScrollDepth)
}

// Initialize scroll depth on load
updateScrollDepth()

// Listen for scroll events to track maximum scroll depth
window.addEventListener('scroll', updateScrollDepth, { passive: true })

// ============================================================================
// REVISIT DETECTION (Requirements 4.3, 4.7)
// ============================================================================

const STORAGE_KEY_PREFIX = 'webmind_visits_'

/**
 * Get revisit count for current URL
 * Requirement 4.3: Track unique URL visits in local storage
 */
async function getRevisitCount(): Promise<number> {
  const url = window.location.href
  const storageKey = STORAGE_KEY_PREFIX + btoa(url).substring(0, 50)
  
  return new Promise((resolve) => {
    chrome.storage.local.get([storageKey], (result) => {
      const count = result[storageKey] || 0
      resolve(count)
    })
  })
}

/**
 * Increment revisit counter for current URL
 * Requirement 4.7: Increment revisit counter for known URLs
 */
async function incrementRevisitCount(): Promise<number> {
  const url = window.location.href
  const storageKey = STORAGE_KEY_PREFIX + btoa(url).substring(0, 50)
  
  return new Promise((resolve) => {
    chrome.storage.local.get([storageKey], (result) => {
      const newCount = (result[storageKey] || 0) + 1
      chrome.storage.local.set({ [storageKey]: newCount }, () => {
        resolve(newCount)
      })
    })
  })
}

// ============================================================================
// TAB GROUP AND SESSION CONTEXT (Requirements 11.1, 10.1)
// ============================================================================

/**
 * Get current tab group ID
 * Requirement 11.1: Detect Chrome tab group identifier
 */
async function getTabGroupId(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.groupId && tabs[0].groupId !== -1) {
        resolve(`group-${tabs[0].groupId}`)
      } else {
        resolve(null)
      }
    })
  })
}

/**
 * Get or create session ID
 * Requirement 10.1: Track sequential page visits
 */
async function getSessionId(): Promise<string> {
  const SESSION_KEY = 'webmind_current_session'
  const SESSION_TIMESTAMP_KEY = 'webmind_session_timestamp'
  const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  
  return new Promise((resolve) => {
    chrome.storage.local.get([SESSION_KEY, SESSION_TIMESTAMP_KEY], (result) => {
      const now = Date.now()
      const lastTimestamp = result[SESSION_TIMESTAMP_KEY] || 0
      
      // Check if session has timed out
      if (now - lastTimestamp > SESSION_TIMEOUT || !result[SESSION_KEY]) {
        // Create new session
        const newSessionId = `session-${now}-${Math.random().toString(36).substring(7)}`
        chrome.storage.local.set({
          [SESSION_KEY]: newSessionId,
          [SESSION_TIMESTAMP_KEY]: now
        }, () => {
          resolve(newSessionId)
        })
      } else {
        // Update timestamp for existing session
        chrome.storage.local.set({ [SESSION_TIMESTAMP_KEY]: now }, () => {
          resolve(result[SESSION_KEY])
        })
      }
    })
  })
}

/**
 * Get sequence number for current session
 */
async function getSequenceNumber(sessionId: string): Promise<number> {
  const SEQUENCE_KEY = `webmind_sequence_${sessionId}`
  
  return new Promise((resolve) => {
    chrome.storage.local.get([SEQUENCE_KEY], (result) => {
      const newSequence = (result[SEQUENCE_KEY] || 0) + 1
      chrome.storage.local.set({ [SEQUENCE_KEY]: newSequence }, () => {
        resolve(newSequence)
      })
    })
  })
}

/**
 * Get previous URL from session
 */
async function getPreviousUrl(): Promise<string | null> {
  const PREVIOUS_URL_KEY = 'webmind_previous_url'
  
  return new Promise((resolve) => {
    chrome.storage.local.get([PREVIOUS_URL_KEY], (result) => {
      const prev = result[PREVIOUS_URL_KEY] || null
      // Store current URL as previous for next page
      chrome.storage.local.set({ [PREVIOUS_URL_KEY]: window.location.href })
      resolve(prev)
    })
  })
}

// ============================================================================
// MEDIA CONTENT EXTRACTION (Requirements 12.1-12.2, 13.1-13.2)
// ============================================================================

/**
 * Extract image data from page
 * Requirement 12.1: Extract image URLs with dimensions (filter >= 200x200)
 */
function extractImages(): ImageData[] {
  const images: ImageData[] = []
  const imgElements = document.querySelectorAll('img')
  
  imgElements.forEach((img) => {
    // Filter images that are at least 200x200
    if (img.naturalWidth >= 200 && img.naturalHeight >= 200) {
      images.push({
        url: img.src,
        width: img.naturalWidth,
        height: img.naturalHeight,
        alt: img.alt || ''
      })
    }
  })
  
  return images
}

/**
 * Extract video data from page
 * Requirement 13.1-13.2: Detect video elements and extract metadata
 */
function extractVideos(): VideoData[] {
  const videos: VideoData[] = []
  const videoElements = document.querySelectorAll('video')
  
  videoElements.forEach((video) => {
    // Get thumbnail from poster attribute or first frame
    const thumbnailUrl = video.poster || video.currentSrc || ''
    
    videos.push({
      url: video.currentSrc || video.src,
      duration: video.duration || 0,
      thumbnailUrl
    })
  })
  
  return videos
}

/**
 * Extract all media content
 */
function extractMediaContent(): MediaContent {
  return {
    images: extractImages(),
    videos: extractVideos()
  }
}

// ============================================================================
// BOOKMARK DETECTION
// ============================================================================

/**
 * Check if current URL is bookmarked
 */
async function isBookmarked(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.bookmarks.search({ url: window.location.href }, (results) => {
      resolve(results.length > 0)
    })
  })
}

// ============================================================================
// PAGE DATA COLLECTION AND SENDING
// ============================================================================

/**
 * Collect all engagement metrics
 */
async function collectEngagementMetrics(): Promise<EngagementMetrics> {
  updateScrollDepth() // Final update
  const dwellTime = stopDwellTimer()
  const revisitCount = await getRevisitCount()
  const bookmarked = await isBookmarked()
  
  return {
    dwellTime,
    scrollDepth: Math.round(maxScrollDepth * 100) / 100, // Round to 2 decimal places
    revisitCount,
    isBookmarked: bookmarked
  }
}

/**
 * Collect browsing context
 */
async function collectBrowsingContext(): Promise<BrowsingContext> {
  const sessionId = await getSessionId()
  const tabGroupId = await getTabGroupId()
  const sequence = await getSequenceNumber(sessionId)
  const prevUrl = await getPreviousUrl()
  
  return {
    sessionId,
    tabGroupId,
    sequenceNumber: sequence,
    previousUrl: prevUrl
  }
}

/**
 * Send complete page data to background worker
 * Requirement 5.4: Send total dwell time to background worker
 * Requirement 6.3: Send final scroll depth on page unload
 * Requirement 4.7: Send revisit count with page data
 */
async function sendPageData(): Promise<void> {
  try {
    const engagement = await collectEngagementMetrics()
    const context = await collectBrowsingContext()
    const media = extractMediaContent()
    
    const pageData: PageData = {
      title: document.title,
      url: window.location.href,
      content: document.body.innerText.slice(0, 10000), // Increased from 5000
      timestamp: new Date().toISOString(),
      engagement,
      context,
      media
    }

    // Increment revisit count after collecting data
    await incrementRevisitCount()

    // Send to background worker
    chrome.runtime.sendMessage(pageData)

    console.log("WebMind: Sent page data", {
      dwellTime: `${Math.round(engagement.dwellTime / 1000)}s`,
      scrollDepth: `${engagement.scrollDepth}%`,
      revisitCount: engagement.revisitCount,
      images: media.images.length,
      videos: media.videos.length
    })
  } catch (error) {
    console.error("WebMind: Failed to send page data", error)
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Send data after initial delay (allow page to load and user to engage)
setTimeout(sendPageData, 5000)

// Send final data on page unload
window.addEventListener('beforeunload', () => {
  sendPageData()
})

// Also send on visibility change (when tab is hidden for a while)
let visibilityTimeout: NodeJS.Timeout | null = null
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Set timeout to send data if tab stays hidden for 30 seconds
    visibilityTimeout = setTimeout(() => {
      sendPageData()
    }, 30000)
  } else {
    // Cancel timeout if tab becomes visible again
    if (visibilityTimeout) {
      clearTimeout(visibilityTimeout)
      visibilityTimeout = null
    }
  }
})