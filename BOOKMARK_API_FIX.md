# Bookmark API Access Fix

## Problem

Content script was crashing with:
```
TypeError: Cannot read properties of undefined (reading 'search')
at isBookmarked (webmind.f438775a.js:648:26)
```

## Root Cause

**Content scripts don't have access to `chrome.bookmarks` API** in Chrome extensions. The API is only available to:
- Background workers (service workers)
- Popup scripts
- Options pages

The content script was trying to call:
```typescript
chrome.bookmarks.search({ url: window.location.href }, ...)
```

This resulted in `chrome.bookmarks` being `undefined`, causing the error.

## Solution

**Moved bookmark checking from content script to background worker:**

### 1. Content Script (`contents/webmind.ts`)

**Before (broken):**
```typescript
async function isBookmarked(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.bookmarks.search({ url: window.location.href }, (results) => {
      resolve(results.length > 0)
    })
  })
}

async function collectEngagementMetrics(): Promise<EngagementMetrics> {
  // ...
  const bookmarked = await isBookmarked() // ❌ Crashes!
  return { ..., isBookmarked: bookmarked }
}
```

**After (fixed):**
```typescript
// Removed isBookmarked() function entirely

async function collectEngagementMetrics(): Promise<EngagementMetrics> {
  // ...
  // Note: isBookmarked will be checked by background worker
  return { ..., isBookmarked: false } // ✅ Default value
}
```

### 2. Background Worker (`background.ts`)

**Added bookmark checking before forwarding to sidecar:**

```typescript
chrome.runtime.onMessage.addListener((message: PageData, sender, sendResponse) => {
  (async () => {
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

      // Update page data with bookmark status
      const pageDataWithBookmark: PageData = {
        ...message,
        engagement: {
          ...message.engagement,
          isBookmarked
        }
      }

      // Send updated data to sidecar
      const response = await fetch("http://localhost:3001/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageData: pageDataWithBookmark })
      })
      
      // ...
    } catch (err) {
      // ...
    }
  })()
  
  return true
})
```

## Why This Works

1. **Content script** collects all metrics it has access to:
   - Dwell time ✅
   - Scroll depth ✅
   - Revisit count ✅ (using `chrome.storage.local`)
   - Bookmark status ❌ (not accessible)

2. **Background worker** enriches the data with bookmark status:
   - Has access to `chrome.bookmarks` API ✅
   - Checks if URL is bookmarked
   - Updates the `pageData` object
   - Forwards complete data to sidecar

3. **Sidecar** receives complete data with correct bookmark status

## Architecture Pattern

```
┌─────────────────────────────────────────────────────┐
│ Content Script (Limited Permissions)               │
│                                                     │
│ ✅ Can access: DOM, storage, tabs (query only)    │
│ ❌ Cannot access: bookmarks, history, downloads   │
│                                                     │
│ Collects: dwell time, scroll, revisit count       │
│ Sends: pageData with isBookmarked = false         │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ chrome.runtime.sendMessage()
                   ▼
┌─────────────────────────────────────────────────────┐
│ Background Worker (Full Permissions)               │
│                                                     │
│ ✅ Can access: ALL Chrome APIs                    │
│                                                     │
│ 1. Receives pageData from content script          │
│ 2. Checks chrome.bookmarks.search()               │
│ 3. Updates pageData.engagement.isBookmarked       │
│ 4. Forwards complete data to sidecar              │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ fetch("http://localhost:3001/ingest")
                   ▼
┌─────────────────────────────────────────────────────┐
│ Sidecar Server                                     │
│                                                     │
│ Receives complete pageData with correct           │
│ bookmark status                                    │
└─────────────────────────────────────────────────────┘
```

## Chrome Extension API Access

| API | Content Script | Background | Popup |
|-----|----------------|------------|-------|
| `chrome.storage` | ✅ | ✅ | ✅ |
| `chrome.runtime.sendMessage` | ✅ | ✅ | ✅ |
| `chrome.tabs.query` | ✅ (limited) | ✅ | ✅ |
| `chrome.bookmarks` | ❌ | ✅ | ✅ |
| `chrome.history` | ❌ | ✅ | ✅ |
| `chrome.downloads` | ❌ | ✅ | ✅ |
| DOM access | ✅ | ❌ | ❌ (popup only) |

## Files Changed

- ✅ `contents/webmind.ts` - Removed `isBookmarked()` function, default to `false`
- ✅ `background.ts` - Added bookmark checking before forwarding to sidecar
- ✅ No TypeScript errors

## Testing

1. **Reload extension**: `chrome://extensions/` → Click reload
2. **Open Wikipedia**: https://en.wikipedia.org/wiki/Tom_Holland
3. **Check console** - Should NOT see the bookmark error anymore
4. **Wait 5 seconds** - Should see successful capture logs
5. **Check background console** - Should see bookmark status log
6. **Check sidecar** - Should receive data with correct `isBookmarked` value

### Test Bookmark Detection

**Test 1: Non-bookmarked page**
1. Visit any non-bookmarked URL
2. Background log should show: `isBookmarked: false`
3. Database should have `is_bookmarked: 0`

**Test 2: Bookmarked page**
1. Bookmark the Wikipedia page (Ctrl+D)
2. Visit the page again
3. Background log should show: `isBookmarked: true`
4. Database should have `is_bookmarked: 1`

**Verify in database:**
```bash
sqlite3 webmind.db "SELECT id, title, is_bookmarked FROM memories ORDER BY id DESC LIMIT 5;"
```

## Expected Console Output

### Content Script (Webpage Console)
```
[WebMind Capture] Content script loaded on: https://en.wikipedia.org/wiki/Tom_Holland
[WebMind Capture] ⏰ Capture timer started - will capture page in 5 seconds
[WebMind Capture] Collecting page data for: https://en.wikipedia.org/wiki/Tom_Holland
[WebMind Capture] Metrics collected: {dwellTime: 5234, scrollDepth: 23.45, revisitCount: 1}
[WebMind Capture] Page data sent to background worker
[WebMind Capture] Successfully sent page data: {...}
```

### Background Worker (Service Worker Console)
```
[WebMind Background] Received page capture: {url: "...", title: "Tom Holland - Wikipedia", ...}
[WebMind Background] Sidecar ingestion successful: {memoryId: "1", conceptsExtracted: 10, isBookmarked: false}
```

### Sidecar (Terminal)
```
⏳ [WebMind Ingestion] Starting capture...
   📄 Title: Tom Holland - Wikipedia
   🔗 URL: https://en.wikipedia.org/wiki/Tom_Holland

✅ [WebMind Ingestion] Successfully captured webpage:
   🆔 Memory ID: 1
   💾 Embedding stored: Yes
```

## Summary

**Problem:** Content script crashed trying to access `chrome.bookmarks` API  
**Cause:** Content scripts don't have bookmark API access  
**Solution:** Moved bookmark checking to background worker  
**Result:** No more crashes, bookmark status correctly detected  

The data flow is now:
1. Content script: Collect what it can access → Send to background
2. Background: Enrich with bookmark status → Forward to sidecar
3. Sidecar: Store complete data with correct bookmark flag

This is the **correct architecture** for Chrome extensions with content scripts!
