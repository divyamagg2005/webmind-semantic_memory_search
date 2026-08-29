# WebMind Verification Checklist

## Quick Test After Updates

### Prerequisites
- [ ] Sidecar is **stopped** (Ctrl+C if running)
- [ ] Plasmo dev server is running (`npm run dev`)

### Step 1: Restart Sidecar (Pick up new timeout)
```bash
cd sidecar
node server.js
```

**Expected output:**
```
Configuration loaded from file
WebMind sidecar running on port 3001
Opened existing LanceDB table
...
Database indexes optimized
Ollama availability: available
WebMind sidecar initialized
```

### Step 2: Reload Extension
1. Open `chrome://extensions/`
2. Find "DEV | Web mind"
3. Click the reload icon 🔄

### Step 3: Open Service Worker Console
1. On the extensions page, under "DEV | Web mind"
2. Find "Service worker" section
3. Click "Inspect" or the blue link

**Expected log:**
```
[WebMind Background] Background worker running - ready to receive page captures
```

### Step 4: Test Page Capture
1. Open new tab: `https://en.wikipedia.org/wiki/Tom_Holland`
2. Open browser console (F12)

**Expected logs (immediately):**
```
[WebMind Capture] Content script loaded on: https://en.wikipedia.org/wiki/Tom_Holland
[WebMind Capture] ⏰ Capture timer started - will capture page in 5 seconds
```

3. Wait 5+ seconds

**Expected logs (after 5s):**
```
[WebMind Capture] Collecting page data for: https://en.wikipedia.org/wiki/Tom_Holland
[WebMind Capture] Metrics collected: {dwellTime: 5234, scrollDepth: 12.5, revisitCount: 1}
[WebMind Capture] Page data sent to background worker
[WebMind Capture] Successfully sent page data: {...}
```

### Step 5: Check Background Worker
Switch to the Service Worker console (from Step 3)

**Expected logs:**
```
[WebMind Background] Received page capture: {url: "https://en.wikipedia.org/wiki/Tom_Holland", title: "Tom Holland - Wikipedia", ...}
[WebMind Background] Sidecar ingestion successful: {memoryId: "1", conceptsExtracted: 10, associationsCreated: 45}
```

### Step 6: Check Sidecar Terminal
Switch to the terminal where `node server.js` is running

**Expected output:**
```
⏳ [WebMind Ingestion] Starting capture...
   📄 Title: Tom Holland - Wikipedia
   🔗 URL: https://en.wikipedia.org/wiki/Tom_Holland
   📏 Content length: 8543 characters

✅ [WebMind Ingestion] Successfully captured webpage:
   📄 Title: Tom Holland - Wikipedia
   🔗 URL: https://en.wikipedia.org/wiki/Tom_Holland
   🆔 Memory ID: 1
   🧠 Concepts extracted: 10
   🔗 Associations created: 45
   📊 Session: session_1738195200_abc123
   💾 Embedding stored: Yes
   🖼️  Images: 3
   🎥 Videos: 0
```

### Step 7: Verify Database
```bash
cd sidecar
sqlite3 webmind.db "SELECT id, title, url FROM memories ORDER BY id DESC LIMIT 1;"
```

**Expected output:**
```
1|Tom Holland - Wikipedia|https://en.wikipedia.org/wiki/Tom_Holland
```

### Step 8: Test Search (Wait ~30s for embedding)
Wait 30 seconds for the embedding to be generated, then:

```powershell
curl -X POST http://localhost:3001/search -H "Content-Type: application/json" -d "{\"query\": \"Tom Holland\"}"
```

**Expected:**
- ✅ No timeout error
- ✅ Completes in 2-5 seconds
- ✅ Returns the Wikipedia article in results

**Sidecar log should show:**
```
Search completed: "Tom Holland" (3245ms)
  - Results: 1
  - Synthesized: true
  - Citations: 1
```

## Troubleshooting

### ❌ Content script logs don't appear
**Cause:** Extension not loaded or not reloaded after code changes  
**Fix:** 
1. Go to `chrome://extensions/`
2. Ensure extension is enabled
3. Click reload button
4. Hard refresh Wikipedia page (Ctrl+Shift+R)

### ❌ "Message send error" in content script
**Cause:** Background worker not running  
**Fix:**
1. Check service worker console shows background log
2. If service worker is "inactive", click the page to wake it up
3. Reload extension

### ❌ Background doesn't receive message
**Cause:** TypeScript compilation error or listener not registered  
**Fix:**
1. Check Plasmo terminal for compilation errors
2. Reload extension
3. Check service worker console for errors

### ❌ Sidecar doesn't receive request
**Cause:** Sidecar not running or wrong port  
**Fix:**
1. Verify sidecar is running: Look for "WebMind sidecar initialized"
2. Check port: Should be 3001
3. Test directly: `curl http://localhost:3001/config`

### ❌ "Embedding stored: No (queued for retry)"
**Cause:** Ollama is unavailable  
**Fix:**
1. Start Ollama: `ollama serve` (or check it's running)
2. Verify: `curl http://localhost:11434/api/tags`
3. Wait for retry (sidecar retries every 60s)

### ❌ Search still times out
**Cause:** Sidecar not restarted after config change  
**Fix:**
1. Stop sidecar (Ctrl+C)
2. Restart: `node server.js`
3. Verify config loaded: Should show in startup logs
4. Check timeout: `curl http://localhost:3001/config | grep query_timeout`

### ❌ No visual emoji logs in sidecar
**Cause:** Terminal doesn't support Unicode  
**Fix:**
- Windows CMD: Should work
- Windows PowerShell: Should work
- Git Bash: May need `winpty`
- WSL: Should work
- If emojis don't render, the text still shows

## Success Criteria

✅ **All of these should be true:**

1. Content script loads on every webpage
2. Timer notification appears immediately
3. After 5 seconds, capture logs appear
4. Background worker receives the message
5. Sidecar shows visual capture confirmation
6. Database contains the new memory
7. Search returns results without timeout
8. Sidecar logs show completion time < 15s

## Complete Flow Summary

```
Wikipedia Page (Console)
  ↓ [WebMind Capture] Content script loaded
  ↓ [WebMind Capture] ⏰ Timer started
  ↓ ... 5 seconds ...
  ↓ [WebMind Capture] Collecting data
  ↓ [WebMind Capture] Sent to background
  ↓
Service Worker (Console)
  ↓ [WebMind Background] Received capture
  ↓ [WebMind Background] Sending to sidecar
  ↓
Sidecar (Terminal)
  ↓ ⏳ Starting capture...
  ↓ ... processing ...
  ↓ ✅ Successfully captured webpage:
  ↓    💾 Embedding stored: Yes
  ↓
Database
  ✅ Memory stored with ID 1
  ↓
Search
  ✅ Returns Tom Holland article
```

## Next Steps After Verification

1. **Capture more pages** - Visit different websites to build your memory
2. **Test search** - Try different queries
3. **Check clustering** - After ~20 pages, run clustering
4. **Monitor logs** - Ensure no errors appear
5. **Tune capture delay** - Adjust the 5-second timer if needed

## Common Questions

**Q: Why does it wait 5 seconds?**  
A: To allow the page to load and give you time to engage (scroll, read). This ensures better engagement metrics.

**Q: Can I change the 5-second delay?**  
A: Yes, edit `contents/webmind.ts` and change `setTimeout(sendPageData, 5000)` to your desired milliseconds.

**Q: Does it capture every page I visit?**  
A: Yes, if the content script loads. It runs on all URLs (`<all_urls>` in manifest).

**Q: How do I know if the embedding is stored?**  
A: Check the sidecar log for "💾 Embedding stored: Yes". If "No", it's queued for retry.

**Q: What if I close the tab before 5 seconds?**  
A: The `beforeunload` event triggers immediate capture. You'll see logs in the console before the tab closes.

**Q: Can I manually trigger capture?**  
A: Currently no, but you could add a keyboard shortcut or extension icon click handler.

**Q: How do I see all captured pages?**  
A: Query the database:
```bash
sqlite3 webmind.db "SELECT id, title, url, timestamp FROM memories ORDER BY timestamp DESC LIMIT 10;"
```

---

**If all steps pass, WebMind is working correctly! 🎉**
