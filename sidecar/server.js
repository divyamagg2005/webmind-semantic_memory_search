require("./load-env")

const express = require("express")
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const sqlite3 = require("sqlite3").verbose()
const lancedb = require("@lancedb/lancedb")
const generateEmbedding = require("./embed")
const { checkOllamaAvailability } = require("./embed")
const {
  withTimeout,
  getQueryTimeout,
  logError,
  isOllamaError,
  deleteMemory,
  embeddingRetryQueue
} = require("./error-handling")
const { getRelatedClusters } = require("./clustering")
const { extractConcepts, calculateCoOccurrence } = require("./concept-extraction")
const { KnowledgeGraph } = require("./knowledge-graph")
const { calculateEngagementScore, calculateMemoryStrength } = require("./engagement-score")
const { shouldCreateNewSession, createSession, getCurrentSession, assignMemoryToSession } = require("./session-detection")
const { OllamaEmbeddingClient, OllamaVisionClient, storeImageEmbedding, storeVideoEmbedding } = require("./multimodal-embeddings")
const { hybridRetrieval } = require("./hybrid-retrieval")
const { reconstructMemory, formatSearchResponse } = require("./memory-reconstruction")
const { performClustering } = require("./clustering")
const { getConfig, updateConfig, resetConfig, getSchema } = require("./config-manager")
const modelProvider = require("./model-provider")
const { cacheManager } = require("./cache")
const { performanceMonitor, IndexOptimizer } = require("./performance")

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

const db = new sqlite3.Database("webmind.db")

// Initialize knowledge graph
const knowledgeGraph = new KnowledgeGraph()

// Initialize Ollama client for embeddings
const ollamaClient = new OllamaEmbeddingClient()

// Image captioning is routed through the model provider (local Ollama LLaVA or
// the AWS LLaVA endpoint, per the cloud_llava_enabled switch).

// Initialize schema on the shared connection
const initSchema = require("./init-schema")
initSchema.initializeSchema(db).catch((err) => {
  console.error("Failed to initialize schema:", err)
})

let table

async function initializeVectorDB() {
  const lanceDb = await lancedb.connect("./lancedb")

  try {
    table = await lanceDb.openTable("webmind_vectors")
    console.log("Opened existing LanceDB table")
  } catch {
    table = await lanceDb.createTable("webmind_vectors", [
      {
        vector: Array(768).fill(0),
        text: "",
        title: "",
        url: "",
        timestamp: "",
        memory_id: 0
      }
    ])

    console.log("Created new LanceDB table")
  }
}

async function initialize() {
  await initializeVectorDB()
  await knowledgeGraph.initialize()

  // Purge graph nodes whose SQLite records no longer exist (prevents stale state after DB wipe)
  try {
    const dbIds = await new Promise((resolve, reject) =>
      db.all("SELECT id FROM memories", [], (err, rows) => err ? reject(err) : resolve(rows.map(r => r.id)))
    )
    const dbIdSet = new Set(dbIds.map(String))
    const staleNodes = []
    knowledgeGraph.graph.forEachNode((nodeId, attrs) => {
      if (attrs.nodeType === 'memory' && attrs.memoryId && !dbIdSet.has(String(attrs.memoryId))) {
        staleNodes.push(nodeId)
      }
    })
    for (const nodeId of staleNodes) {
      try { knowledgeGraph.graph.dropNode(nodeId) } catch {}
    }
    if (staleNodes.length > 0) {
      console.log(`Purged ${staleNodes.length} stale memory nodes from graph`)
      knowledgeGraph.isDirty = true
      await knowledgeGraph.save()
    }
  } catch (err) {
    console.error("Graph reconciliation failed:", err.message)
  }

  // Optimize database indexes
  try {
    await IndexOptimizer.optimizeIndexes(db)
  } catch (err) {
    console.error("Failed to optimize indexes:", err)
  }

  // Check Ollama availability on startup
  const ollamaOk = await checkOllamaAvailability()
  console.log(`Ollama availability: ${ollamaOk ? "available" : "unavailable"}`)

  // Periodically retry queued embeddings
  setInterval(async () => {
    if (embeddingRetryQueue.size === 0) return
    const available = await checkOllamaAvailability()
    if (!available) return

    await embeddingRetryQueue.process(async (item) => {
      if (!item.memoryId || !table) return
      const embedding = await generateEmbedding(item.text, { queueOnFailure: false })
      await table.add([
        {
          vector: embedding,
          text: item.text,
          title: item.title || "",
          url: item.url || "",
          timestamp: item.timestamp || new Date().toISOString(),
          memory_id: item.memoryId
        }
      ])
      console.log(`Retry embedding succeeded for memory ${item.memoryId}`)
    })
  }, 60000)
  
  console.log("WebMind sidecar initialized")
}

initialize()

app.post("/ingest", async (req, res) => {
  const { pageData } = req.body

  if (!pageData) {
    return res.status(400).json({ 
      success: false, 
      error: "Missing pageData in request body" 
    })
  }

  const {
    title,
    url,
    content,
    timestamp,
    engagement = {},
    context = {},
    media = { images: [], videos: [] }
  } = pageData

  console.log(`\n⏳ [WebMind Ingestion] Starting capture...`)
  console.log(`   📄 Title: ${title}`)
  console.log(`   🔗 URL: ${url}`)
  console.log(`   📏 Content length: ${content?.length || 0} characters`)

  let memoryId = null

  try {
    // Calculate engagement score
    const engagementScore = calculateEngagementScore({
      dwellTime: engagement.dwellTime || 0,
      scrollDepth: engagement.scrollDepth || 0,
      revisitCount: engagement.revisitCount || 0
    })

    // Calculate memory strength
    const memoryStrength = calculateMemoryStrength({
      engagementScore,
      isBookmarked: engagement.isBookmarked || false,
      uniqueVisitDates: engagement.revisitCount || 0,
      associationBoost: 0
    })

    // Session detection
    let sessionId = context.sessionId
    let sequentialPosition = 1

    if (!sessionId) {
      // Get last page for session detection
      const lastPage = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id, timestamp FROM memories ORDER BY timestamp DESC LIMIT 1`,
          (err, row) => {
            if (err) reject(err)
            else resolve(row)
          }
        )
      })

      // Get last page embedding if exists
      let lastPageEmbedding = null
      if (lastPage) {
        const lastEmbedding = await table
          .search(Array(768).fill(0))
          .where(`memory_id = ${lastPage.id}`)
          .limit(1)
          .toArray()
        
        if (lastEmbedding.length > 0) {
          lastPageEmbedding = lastEmbedding[0].vector
        }
      }

      // Generate current page embedding for session detection
      const currentEmbedding = await generateEmbedding(content)

      // Check if new session needed
      const needsNewSession = shouldCreateNewSession({
        lastPageTimestamp: lastPage?.timestamp,
        currentPageTimestamp: timestamp,
        lastPageEmbedding,
        currentPageEmbedding
      })

      if (needsNewSession || !lastPage) {
        // Create new session
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO sessions (id, start_time, end_time, page_count, dominant_concepts, label)
             VALUES (?, ?, NULL, 0, '[]', NULL)`,
            [sessionId, timestamp],
            (err) => {
              if (err) reject(err)
              else resolve()
            }
          )
        })
      } else {
        // Use existing session
        const currentSession = await new Promise((resolve, reject) => {
          db.get(
            `SELECT id, page_count FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
            (err, row) => {
              if (err) reject(err)
              else resolve(row)
            }
          )
        })
        
        if (currentSession) {
          sessionId = currentSession.id
          sequentialPosition = (currentSession.page_count || 0) + 1
        } else {
          // Fallback: create new session
          sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO sessions (id, start_time, end_time, page_count, dominant_concepts, label)
               VALUES (?, ?, NULL, 0, '[]', NULL)`,
              [sessionId, timestamp],
              (err) => {
                if (err) reject(err)
                else resolve()
              }
            )
          })
        }
      }
    }

    // Upsert: one memory row per URL, update on revisit
    const existingMemory = await new Promise((resolve, reject) => {
      db.get(
        `SELECT id, dwell_time, scroll_depth, revisit_count FROM memories WHERE url = ? ORDER BY timestamp DESC LIMIT 1`,
        [url],
        (err, row) => (err ? reject(err) : resolve(row))
      )
    })

    let isRevisit = false

    if (existingMemory) {
      // Merge metrics: accumulate dwell, keep max scroll, use incoming revisit count
      isRevisit = true
      const mergedDwell    = (existingMemory.dwell_time   || 0) + (engagement.dwellTime  || 0)
      const mergedScroll   = Math.max(existingMemory.scroll_depth || 0, engagement.scrollDepth || 0)
      const mergedRevisits = Math.max(existingMemory.revisit_count || 0, engagement.revisitCount || 0)

      const mergedEngagement = calculateEngagementScore({
        dwellTime:    mergedDwell,
        scrollDepth:  mergedScroll,
        revisitCount: mergedRevisits
      })
      const mergedStrength = calculateMemoryStrength({
        engagementScore:  mergedEngagement,
        isBookmarked:     engagement.isBookmarked || false,
        uniqueVisitDates: mergedRevisits,
        associationBoost: 0
      })

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE memories SET
             title = ?, content = ?, timestamp = ?,
             dwell_time = ?, scroll_depth = ?, revisit_count = ?,
             last_accessed = ?, is_bookmarked = ?,
             engagement_score = ?, memory_strength = ?, updated_at = ?
           WHERE id = ?`,
          [
            title, content, timestamp,
            mergedDwell, mergedScroll, mergedRevisits,
            timestamp, engagement.isBookmarked ? 1 : 0,
            mergedEngagement, mergedStrength, timestamp,
            existingMemory.id
          ],
          (err) => (err ? reject(err) : resolve())
        )
      })
      memoryId = existingMemory.id

    } else {
      // First visit — insert new row
      memoryId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO memories (
            title, url, content, timestamp,
            dwell_time, scroll_depth, revisit_count, last_accessed,
            session_id, tab_group_id, sequence_number, previous_url,
            is_bookmarked, is_pinned,
            engagement_score, memory_strength,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            title, url, content, timestamp,
            engagement.dwellTime  || 0,
            engagement.scrollDepth || 0,
            engagement.revisitCount || 0,
            timestamp,
            sessionId, context.tabGroupId || null, sequentialPosition, context.previousUrl || null,
            engagement.isBookmarked ? 1 : 0,
            0,
            engagementScore, memoryStrength,
            timestamp, timestamp
          ],
          function(err) { if (err) reject(err); else resolve(this.lastID) }
        )
      })
    }

    // Update session page count
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE sessions SET page_count = page_count + 1, end_time = ? WHERE id = ?`,
        [timestamp, sessionId],
        (err) => {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    // Generate text embedding — skip on revisit (existing vector still valid)
    let embeddingStored = isRevisit
    if (!isRevisit) {
      try {
        const embedding = await generateEmbedding(content, {
          memoryId,
          queueOnFailure: true
        })
        await table.add([{
          vector: embedding,
          text: content,
          title,
          url,
          timestamp,
          memory_id: memoryId
        }])
        embeddingStored = true
      } catch (embedErr) {
        logError("ingest_embedding_failure", embedErr, { memoryId, url })
        embeddingRetryQueue.enqueue({ text: content, memoryId, title, url, timestamp })
      }
    }

    // Extract concepts from content
    const concepts = extractConcepts(content, {
      maxTopics: 10,
      minConfidence: 0.6
    })

    // Add concepts to knowledge graph
    const conceptIds = []
    for (const concept of concepts) {
      const conceptId = knowledgeGraph.addConcept({
        id: concept.id,
        name: concept.name,
        type: concept.type,
        confidence: concept.confidence
      })
      conceptIds.push(conceptId)
    }

    // Add memory node to knowledge graph (with domain + session context)
    let pageDomain = null
    try { pageDomain = new URL(url).hostname } catch {}

    const memoryNodeId = `memory_${memoryId}`
    knowledgeGraph.addMemory({
      id:        memoryNodeId,
      memoryId:  memoryId.toString(),
      timestamp,
      sessionId: sessionId || null,
      domain:    pageDomain
    })

    // Add domain hub node and link memory to it
    if (pageDomain) {
      const domainNodeId = knowledgeGraph.addDomain(pageDomain)
      knowledgeGraph.linkMemoryToDomain(memoryNodeId, domainNodeId)
    }

    // Link to previous memory in the same session (journey path)
    if (!isRevisit && sessionId) {
      const prevMemNodeId = knowledgeGraph.getPreviousMemoryInSession(sessionId, memoryNodeId)
      if (prevMemNodeId) {
        knowledgeGraph.linkMemoriesInSession(prevMemNodeId, memoryNodeId, sessionId)
      }
    }

    // Link memory to concepts
    for (const conceptId of conceptIds) {
      knowledgeGraph.linkMemoryToConcept(memoryNodeId, conceptId, 1.0)
    }

    // Create concept associations (co-occurrence)
    const coOccurrenceMatrix = calculateCoOccurrence(concepts)
    let associationsCreated = 0

    for (let i = 0; i < conceptIds.length; i++) {
      for (let j = i + 1; j < conceptIds.length; j++) {
        const success = knowledgeGraph.addConceptAssociation(
          conceptIds[i],
          conceptIds[j]
        )
        if (success) {
          associationsCreated++
        }
      }
    }

    // Process images / videos — only on first visit to avoid duplicates
    let imagesCaptioned = 0
    if (!isRevisit) {
      if (media.images && media.images.length > 0) {
        const cfg = getConfig()
        const captionEnabled = cfg.image_caption_enabled !== false
        const maxImages = Number.isFinite(cfg.max_images_per_page) ? cfg.max_images_per_page : 6
        let processed = 0
        let consecutiveVisionFailures = 0

        // Only bother captioning real remote raster images
        const isCaptionable = (u) =>
          typeof u === 'string' &&
          /^https?:\/\//i.test(u) &&
          !/\.svgz?(\?|#|$)/i.test(u)

        const seenUrls = new Set()

        for (const image of media.images) {
          const imgUrl = typeof image.url === 'string' ? image.url : ''

          // Skip duplicate image URLs within the same page capture
          if (imgUrl && seenUrls.has(imgUrl)) continue
          if (imgUrl) seenUrls.add(imgUrl)

          // Always store the image row (metadata), even if captioning is off or fails
          const imageRowId = await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO images (memory_id, url, width, height, alt) VALUES (?, ?, ?, ?, ?)`,
              [memoryId, imgUrl, image.width, image.height, image.alt || ''],
              function (err) { if (err) reject(err); else resolve(this.lastID) }
            )
          })

          if (!captionEnabled || processed >= maxImages) continue
          if (!isCaptionable(imgUrl)) continue
          if (consecutiveVisionFailures >= 3) continue // vision runner looks unstable; stop hammering it

          try {
            // Reuse a caption already generated for this exact image on an
            // earlier page — skips the expensive vision inference call while
            // still embedding + linking the image against THIS memory.
            const priorCaption = await new Promise((resolve, reject) => {
              db.get(
                `SELECT caption FROM images
                   WHERE url = ? AND caption IS NOT NULL AND caption != '' AND id != ?
                   LIMIT 1`,
                [imgUrl, imageRowId],
                (err, row) => (err ? reject(err) : resolve(row ? row.caption : null))
              )
            })

            // Vision model → caption → text embedding, stored against the parent
            // memory. This is what makes the image "memorised" like page text.
            // Provider decides local Ollama LLaVA vs AWS LLaVA per the switch.
            let caption = priorCaption
            if (!caption) {
              processed++
              caption = await modelProvider.generateImageCaption({
                imageUrl: imgUrl,
                altText: image.alt || ''
              })
              if (!caption) { consecutiveVisionFailures++; continue }
              consecutiveVisionFailures = 0
            }

            const imgText = [image.alt, caption].filter(Boolean).join('. ')
            const imgEmbedding = await generateEmbedding(imgText, { queueOnFailure: false })
            await table.add([{
              vector: imgEmbedding,
              text: caption,
              title: `🖼 ${image.alt || 'image'}`,
              url: imgUrl,
              timestamp,
              memory_id: memoryId
            }])

            await new Promise((resolve, reject) => {
              db.run(
                `UPDATE images SET caption = ?, embedding_stored = 1 WHERE id = ?`,
                [caption, imageRowId],
                (err) => (err ? reject(err) : resolve())
              )
            })

            const imgNodeId = knowledgeGraph.addImage({
              id: `image_${imageRowId}`,
              imageId: imageRowId,
              url: imgUrl,
              alt: image.alt || '',
              caption,
              width: image.width,
              height: image.height,
              memoryNodeId,
              timestamp
            })
            knowledgeGraph.linkMemoryToImage(memoryNodeId, imgNodeId)
            imagesCaptioned++
          } catch (imgErr) {
            if (imgErr && imgErr.code === "CLOUD_CONFIG_MISSING") {
              // Cloud LLaVA switch is on but AWS config is missing — stop here
              // instead of hammering a call that cannot succeed.
              logError("image_caption_cloud_config", imgErr, { memoryId })
              break
            }
            consecutiveVisionFailures++
            logError("image_caption_failure", imgErr, { memoryId, imageUrl: imgUrl })
          }
        }
      }
      if (media.videos && media.videos.length > 0) {
        for (const video of media.videos) {
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT INTO videos (memory_id, url, duration, thumbnail_url) VALUES (?, ?, ?, ?)`,
              [memoryId, video.url, video.duration, video.thumbnailUrl],
              (err) => (err ? reject(err) : resolve())
            )
          })
        }
      }
    }

    console.log(`\n✅ [WebMind Ingestion] ${isRevisit ? "Updated existing memory" : "New memory captured"}:`)
    console.log(`   📄 Title: ${title}`)
    console.log(`   🔗 URL: ${url}`)
    console.log(`   🆔 Memory ID: ${memoryId}`)
    console.log(`   🧠 Concepts extracted: ${concepts.length}`)
    console.log(`   🔗 Associations created: ${associationsCreated}`)
    console.log(`   📊 Session: ${sessionId}`)
    console.log(`   💾 Embedding stored: ${embeddingStored ? 'Yes' : 'No (queued for retry)'}`)
    console.log(`   🖼️  Images: ${media.images?.length || 0} (captioned + embedded: ${imagesCaptioned})`)
    console.log(`   🎥 Videos: ${media.videos?.length || 0}\n`)

    res.json({
      success: true,
      memoryId: memoryId.toString(),
      conceptsExtracted: concepts.length,
      associationsCreated,
      embeddingStored
    })

  } catch (err) {
    logError("ingestion_failure", err)
    // Rollback SQLite insert if memory was created but later steps failed critically
    if (typeof memoryId !== "undefined" && memoryId) {
      try {
        await deleteMemory(db, memoryId)
      } catch (rollbackErr) {
        logError("ingest_rollback_failure", rollbackErr, { memoryId })
      }
    }
    res.status(500).json({
      success: false,
      error: err.message || "Ingestion failed"
    })
  }
})

function extractTimeReference(query) {
  query = query.toLowerCase()

  if (query.includes("last week")) {
    return 7
  }

  if (query.includes("last month")) {
    return 30
  }

  if (query.includes("yesterday")) {
    return 1
  }

  if (query.includes("today")) {
    return 0
  }

  return null
}

function parseTemporalContext(query) {
  const now = new Date()
  const q = query.toLowerCase()

  if (/\btoday\b/.test(q)) {
    const from = new Date(now); from.setHours(0,0,0,0)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: "today" }
  }
  if (/\byesterday\b/.test(q)) {
    const from = new Date(now); from.setDate(from.getDate()-1); from.setHours(0,0,0,0)
    const to = new Date(from); to.setHours(23,59,59,999)
    return { dateFrom: from.toISOString(), dateTo: to.toISOString(), label: "yesterday" }
  }
  if (/this morning/.test(q)) {
    const from = new Date(now); from.setHours(5,0,0,0)
    const to = new Date(now); to.setHours(12,0,0,0)
    return { dateFrom: from.toISOString(), dateTo: to.toISOString(), label: "this morning" }
  }
  if (/this afternoon/.test(q)) {
    const from = new Date(now); from.setHours(12,0,0,0)
    const to = new Date(now); to.setHours(18,0,0,0)
    return { dateFrom: from.toISOString(), dateTo: to.toISOString(), label: "this afternoon" }
  }
  if (/this evening|tonight/.test(q)) {
    const from = new Date(now); from.setHours(18,0,0,0)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: "this evening" }
  }
  if (/last week|past week|this week/.test(q)) {
    const from = new Date(now); from.setDate(from.getDate()-7)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: "last week" }
  }
  if (/last month|past month|this month/.test(q)) {
    const from = new Date(now); from.setMonth(from.getMonth()-1)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: "last month" }
  }
  if (/last hour|an hour ago/.test(q)) {
    const from = new Date(now.getTime() - 3600000)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: "last hour" }
  }
  const hoursAgo = q.match(/(\d+)\s+hours?\s+ago/)
  if (hoursAgo) {
    const n = parseInt(hoursAgo[1])
    const from = new Date(now.getTime() - n * 3600000)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: `${n} hours ago` }
  }
  const daysAgo = q.match(/(\d+)\s+days?\s+ago/)
  if (daysAgo) {
    const n = parseInt(daysAgo[1])
    const from = new Date(now); from.setDate(from.getDate()-n)
    return { dateFrom: from.toISOString(), dateTo: now.toISOString(), label: `${n} days ago` }
  }
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  const dayMatch = q.match(/(?:on|last)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/)
  if (dayMatch) {
    const target = dayNames.indexOf(dayMatch[1])
    const diff = (now.getDay() - target + 7) % 7 || 7
    const from = new Date(now); from.setDate(from.getDate()-diff); from.setHours(0,0,0,0)
    const to = new Date(from); to.setHours(23,59,59,999)
    return { dateFrom: from.toISOString(), dateTo: to.toISOString(), label: dayMatch[1] }
  }
  return null
}

app.post("/search", async (req, res) => {
  const { query, options = {} } = req.body

  if (!query) {
    return res.status(400).json({
      success: false,
      error: "Missing query in request body"
    })
  }

  const startTime = Date.now()
  const warnings = []
  let timedOut = false

  // Per-stage timeouts — embedding is slow on CPU, synthesis gets its own budget
  const EMBED_TIMEOUT     = 55000
  const RETRIEVAL_TIMEOUT = 10000
  const SYNTHESIS_TIMEOUT = 10000

  const timeRemaining = () => Math.max(0, EMBED_TIMEOUT - (Date.now() - startTime))

  try {
    // Warn early if the Cloud LLaMA switch is on but its AWS config is missing —
    // synthesis will fall back to raw results otherwise, with no obvious reason.
    if (modelProvider.cloudLlamaEnabled() && !modelProvider.isLlamaCloudConfigured()) {
      warnings.push(
        "Cloud LLaMA is enabled but AWS_API_KEY/LLAMA_API_URL are not set — answer synthesis is unavailable until configured."
      )
    }

    let queryEmbedding = cacheManager.getQueryEmbedding(query)
    let ollamaUnavailable = false

    if (!queryEmbedding) {
      try {
        queryEmbedding = await withTimeout(
          generateEmbedding(query, { queueOnFailure: false }),
          timeRemaining(),
          "embedding"
        )
        cacheManager.putQueryEmbedding(query, queryEmbedding)
      } catch (embedErr) {
        if (embedErr.code === "QUERY_TIMEOUT") {
          timedOut = true
          warnings.push(`Query exceeded ${queryTimeout}ms during embedding.`)
        } else if (isOllamaError(embedErr)) {
          ollamaUnavailable = true
          warnings.push("Ollama unavailable — semantic search disabled.")
        } else {
          throw embedErr
        }
      }
    }

    let memories = []
    if (queryEmbedding) {
      memories = await withTimeout(
        hybridRetrieval({
          lanceTable: table,
          knowledgeGraph,
          db,
          queryEmbedding,
          options: {
            semanticLimit: options.maxResults || 20,
            maxHops: options.maxHops || 2,
            minAssociationStrength: options.minAssociationStrength || 0.3,
            topNForExpansion: options.topNForExpansion || 5,
            weights: options.weights
          }
        }),
        RETRIEVAL_TIMEOUT,
        "retrieval"
      )

      if (memories._metadata?.graphExpansionFailed) {
        warnings.push("Graph traversal failed — results use semantic search only.")
      }
    } else if (!queryEmbedding && !ollamaUnavailable) {
      timedOut = true
    }

    const temporalCtx = parseTemporalContext(query)

    let enrichedMemories = (memories || []).map(memory => ({
      ...memory,
      is_pinned: memory.isPinned || memory.is_pinned || false,
      is_bookmarked: memory.isBookmarked || memory.is_bookmarked || false,
      decayed_strength: memory.decayedStrength || memory.decayed_strength || memory.memory_strength
    }))

    if (temporalCtx) {
      const fromTs = new Date(temporalCtx.dateFrom).getTime()
      const toTs = new Date(temporalCtx.dateTo).getTime()
      const timeFiltered = enrichedMemories.filter(m => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0
        return ts >= fromTs && ts <= toTs
      })
      if (timeFiltered.length > 0) {
        enrichedMemories = timeFiltered
      } else {
        warnings.push(`No memories found for "${temporalCtx.label}" — showing all time results.`)
      }
    }

    let reconstruction
    if (ollamaUnavailable) {
      reconstruction = {
        synthesizedAnswer: null,
        citations: [],
        rawResults: enrichedMemories,
        associationPaths: [],
        metadata: {
          memoriesRetrieved: enrichedMemories.length,
          memoriesUsed: 0,
          synthesized: false,
          fallbackReason: "Ollama unavailable — search-only mode"
        }
      }
      warnings.push("Answer synthesis skipped because Ollama is unavailable.")
    } else if (enrichedMemories.length > 0) {
      try {
        reconstruction = await withTimeout(
          reconstructMemory({
            query,
            memories: enrichedMemories,
            options: {
              maxMemories: options.maxMemories || 5,
              model: options.model || "llama3.2:3b",
              temperature: options.temperature || 0.3
            }
          }),
          SYNTHESIS_TIMEOUT,
          "synthesis"
        )
      } catch (synthErr) {
        if (synthErr.code === "QUERY_TIMEOUT") {
          timedOut = true
          warnings.push(`Showing ${enrichedMemories.length} matched results (LLM synthesis skipped — Ollama too slow on CPU).`)
          logError("query_timeout", synthErr, { query, timeoutMs: SYNTHESIS_TIMEOUT, stage: "synthesis" })
        }
        reconstruction = {
          synthesizedAnswer: null,
          citations: [],
          rawResults: enrichedMemories,
          associationPaths: [],
          metadata: {
            memoriesRetrieved: enrichedMemories.length,
            memoriesUsed: 0,
            synthesized: false,
            fallbackReason: timedOut ? "Query timeout — synthesis skipped" : synthErr.message
          }
        }
      }
    } else {
      reconstruction = {
        synthesizedAnswer: null,
        citations: [],
        rawResults: enrichedMemories,
        associationPaths: [],
        metadata: {
          memoriesRetrieved: enrichedMemories.length,
          memoriesUsed: 0,
          synthesized: false,
          fallbackReason: timedOut ? "Query timeout" : "No memories found"
        }
      }
    }

    const response = formatSearchResponse(reconstruction)
    response.warnings = warnings
    response.timedOut = timedOut
    response.searchMode = ollamaUnavailable ? "search-only" : "hybrid"
    if (temporalCtx) response.detectedTimeRange = temporalCtx

    const latency = Date.now() - startTime
    performanceMonitor.recordQuery(latency)

    if (latency > 500) {
      logError("slow_query", new Error("Slow query detected"), { query, latencyMs: latency })
    }

    console.log(`Search completed: "${query}" (${latency}ms)`)
    console.log(`  - Results: ${response.results.length}`)
    console.log(`  - Synthesized: ${response.synthesized}`)
    console.log(`  - Citations: ${response.citations.length}`)

    res.json(response)
  } catch (err) {
    logError("search_failure", err, { query })
    res.status(500).json({
      success: false,
      error: err.message || "Search failed",
      warnings
    })
  }
})

app.post("/cluster", async (req, res) => {
  const { options = {} } = req.body

  try {
    console.log("Starting clustering analysis...")

    const result = await performClustering({
      lanceTable: table,
      knowledgeGraph,
      db,
      options: {
        minClusterSize: options.minClusterSize || 3,
        similarityThreshold: options.similarityThreshold || 0.7,
        crossClusterThreshold: options.crossClusterThreshold || 0.5,
        limit: options.limit || 1000
      }
    })

    console.log("Clustering completed:")
    console.log(`  - Clusters created: ${result.clustersCreated}`)
    console.log(`  - Memories clustered: ${result.memoriesClustered}`)
    console.log(`  - Cross-cluster links: ${result.crossClusterLinks}`)

    res.json({
      success: true,
      ...result
    })

  } catch (err) {
    console.error("Clustering error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Clustering failed"
    })
  }
})

// ============================================================================
// CONFIGURATION MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * Get current configuration
 * Requirement 30.6: GET /config endpoint
 */
app.get("/config", (req, res) => {
  try {
    const config = getConfig()
    
    res.json({
      success: true,
      config
    })
  } catch (err) {
    console.error("Get config error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get configuration"
    })
  }
})

/**
 * Update configuration
 * Requirement 30.6: PUT /config endpoint for updates
 * Requirement 30.7: Apply configuration changes without restart
 */
app.put("/config", (req, res) => {
  const { updates } = req.body

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({
      success: false,
      error: "Missing or invalid updates in request body"
    })
  }

  // Cloud switches require their AWS config to be present in the environment.
  // Refuse to turn them on otherwise — with a clear message, never the secret.
  const cloudConfigErrors = []
  if (updates.cloud_llama_enabled === true && !modelProvider.isLlamaCloudConfigured()) {
    cloudConfigErrors.push(
      "Cloud LLaMA needs AWS_API_KEY and LLAMA_API_URL set in the sidecar environment (.env)"
    )
  }
  if (updates.cloud_llava_enabled === true && !modelProvider.isLlavaCloudConfigured()) {
    cloudConfigErrors.push(
      "Cloud LLaVA needs AWS_API_KEY and LLAVA_API_URL set in the sidecar environment (.env)"
    )
  }
  if (cloudConfigErrors.length > 0) {
    return res.status(400).json({ success: false, errors: cloudConfigErrors })
  }

  try {
    const result = updateConfig(updates)
    
    if (result.success) {
      console.log("Configuration updated:", Object.keys(updates).join(", "))
      
      res.json({
        success: true,
        config: result.config
      })
    } else {
      res.status(400).json({
        success: false,
        errors: result.errors
      })
    }
  } catch (err) {
    console.error("Update config error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to update configuration"
    })
  }
})

/**
 * Reset configuration to defaults
 */
app.post("/config/reset", (req, res) => {
  try {
    const config = resetConfig()
    
    console.log("Configuration reset to defaults")
    
    res.json({
      success: true,
      config
    })
  } catch (err) {
    console.error("Reset config error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to reset configuration"
    })
  }
})

/**
 * Get configuration schema
 */
app.get("/config/schema", (req, res) => {
  try {
    const schema = getSchema()
    
    res.json({
      success: true,
      schema
    })
  } catch (err) {
    console.error("Get schema error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get schema"
    })
  }
})

// ============================================================================
// PERFORMANCE MONITORING ENDPOINTS
// ============================================================================

/**
 * Get performance statistics
 */
app.get("/stats", (req, res) => {
  try {
    const performanceStats = performanceMonitor.getStats()
    const cacheStats = cacheManager.getStats()
    
    res.json({
      success: true,
      performance: performanceStats,
      cache: cacheStats
    })
  } catch (err) {
    console.error("Get stats error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get statistics"
    })
  }
})

/**
 * Reset performance statistics
 */
app.post("/stats/reset", (req, res) => {
  try {
    performanceMonitor.reset()
    
    res.json({
      success: true,
      message: "Performance statistics reset"
    })
  } catch (err) {
    console.error("Reset stats error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to reset statistics"
    })
  }
})

/**
 * Clear all caches
 */
app.post("/cache/clear", (req, res) => {
  try {
    cacheManager.clearAll()
    
    res.json({
      success: true,
      message: "All caches cleared"
    })
  } catch (err) {
    console.error("Clear cache error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Failed to clear cache"
    })
  }
})

// ============================================================================
// DATA MIGRATION ENDPOINT
// ============================================================================

const { performMigration, verifyMigration } = require("./data-migration")

/**
 * Perform data migration from old WebMind schema
 * Requirement 29.1-29.6: Complete migration workflow
 */
app.post("/migrate", async (req, res) => {
  const { options = {} } = req.body

  try {
    console.log("Starting data migration...")

    const result = await performMigration({
      dbPath: "./webmind.db",
      batchSize: options.batchSize || 100,
      skipEmbeddings: options.skipEmbeddings || false,
      skipConcepts: options.skipConcepts || false
    })

    if (result.success) {
      // Verify migration
      const verification = await verifyMigration()
      
      res.json({
        success: true,
        ...result,
        verification
      })
    } else {
      res.status(500).json({
        success: false,
        ...result
      })
    }

  } catch (err) {
    console.error("Migration error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Migration failed"
    })
  }
})

// ============================================================================
// PRIORITY WEIGHTING ENDPOINTS
// ============================================================================

/**
 * Pin a memory to prevent decay
 * Requirement 19.1: Set decay coefficient to 0 for pinned memories
 */
app.post("/pin", async (req, res) => {
  const { memoryId } = req.body

  if (!memoryId) {
    return res.status(400).json({
      success: false,
      error: "Missing memoryId in request body"
    })
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE memories SET is_pinned = 1, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), memoryId],
        function(err) {
          if (err) reject(err)
          else if (this.changes === 0) reject(new Error("Memory not found"))
          else resolve()
        }
      )
    })

    console.log(`Pinned memory ${memoryId}`)

    res.json({
      success: true,
      memoryId
    })

  } catch (err) {
    console.error("Pin error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Pin failed"
    })
  }
})

/**
 * Unpin a memory to allow normal decay
 * Requirement 19.2: Remove pin status
 */
app.post("/unpin", async (req, res) => {
  const { memoryId } = req.body

  if (!memoryId) {
    return res.status(400).json({
      success: false,
      error: "Missing memoryId in request body"
    })
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE memories SET is_pinned = 0, updated_at = ? WHERE id = ?`,
        [new Date().toISOString(), memoryId],
        function(err) {
          if (err) reject(err)
          else if (this.changes === 0) reject(new Error("Memory not found"))
          else resolve()
        }
      )
    })

    console.log(`Unpinned memory ${memoryId}`)

    res.json({
      success: true,
      memoryId
    })

  } catch (err) {
    console.error("Unpin error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Unpin failed"
    })
  }
})

/**
 * Update bookmark status for a memory
 * Requirement 18.3: Handle bookmark removal
 */
app.post("/bookmark", async (req, res) => {
  const { url, isBookmarked } = req.body

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "Missing url in request body"
    })
  }

  try {
    // Update all memories with this URL
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE memories SET is_bookmarked = ?, updated_at = ? WHERE url = ?`,
        [isBookmarked ? 1 : 0, new Date().toISOString(), url],
        function(err) {
          if (err) reject(err)
          else resolve()
        }
      )
    })

    // Recalculate memory strength for affected memories
    const memories = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, engagement_score, revisit_count FROM memories WHERE url = ?`,
        [url],
        (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        }
      )
    })

    for (const memory of memories) {
      const memoryStrength = calculateMemoryStrength({
        engagementScore: memory.engagement_score,
        isBookmarked,
        uniqueVisitDates: memory.revisit_count,
        associationBoost: 0
      })

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE memories SET memory_strength = ? WHERE id = ?`,
          [memoryStrength, memory.id],
          (err) => {
            if (err) reject(err)
            else resolve()
          }
        )
      })
    }

    console.log(`Updated bookmark status for ${url}: ${isBookmarked}`)

    res.json({
      success: true,
      url,
      isBookmarked,
      memoriesUpdated: memories.length
    })

  } catch (err) {
    console.error("Bookmark update error:", err)
    res.status(500).json({
      success: false,
      error: err.message || "Bookmark update failed"
    })
  }
})

// ============================================================================
// HEALTH & STATUS
// ============================================================================

app.get("/health", async (req, res) => {
  try {
    const ollamaAvailable = await checkOllamaAvailability()
    res.json({
      success: true,
      status: "ok",
      ollamaAvailable,
      embeddingQueueSize: embeddingRetryQueue.size,
      graphStats: knowledgeGraph.getStats(),
      provider: modelProvider.getProviderStatus()
    })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// ============================================================================
// CLUSTER BROWSING
// ============================================================================

app.get("/clusters", (req, res) => {
  try {
    const clusters = knowledgeGraph.getAllClusters()
    res.json({ success: true, clusters })
  } catch (err) {
    logError("list_clusters_failure", err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get("/clusters/:clusterId", (req, res) => {
  try {
    const cluster = knowledgeGraph.getCluster(req.params.clusterId)
    if (!cluster) {
      return res.status(404).json({ success: false, error: "Cluster not found" })
    }
    const related = getRelatedClusters(knowledgeGraph, req.params.clusterId)
    res.json({ success: true, cluster, related })
  } catch (err) {
    logError("get_cluster_failure", err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get("/clusters/:clusterId/memories", async (req, res) => {
  try {
    const members = knowledgeGraph.getClusterMembers(req.params.clusterId)
    const memories = []

    for (const member of members) {
      const memoryId = parseInt(member.memoryId, 10)
      const row = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM memories WHERE id = ?", [memoryId], (err, r) => {
          if (err) reject(err)
          else resolve(r)
        })
      })
      if (row) {
        memories.push({
          memoryId: row.id,
          title: row.title,
          url: row.url,
          timestamp: row.timestamp,
          engagementScore: row.engagement_score,
          memoryStrength: row.memory_strength,
          isPinned: row.is_pinned === 1,
          isBookmarked: row.is_bookmarked === 1
        })
      }
    }

    res.json({ success: true, memories })
  } catch (err) {
    logError("cluster_memories_failure", err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ============================================================================
// KNOWLEDGE GRAPH VISUALIZATION
// ============================================================================

app.use("/static/vis-network.min.js", (req, res) => {
  res.sendFile(path.join(__dirname, "node_modules/vis-network/standalone/umd/vis-network.min.js"))
})

app.get("/graph", (req, res) => {
  const htmlPath = path.join(__dirname, "graph-viewer.html")
  res.sendFile(htmlPath)
})

app.get("/graph/data", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 400, 1000)
    const includeMemories = req.query.memories !== "false"
    const mode = ["full", "journey", "domains", "topics"].includes(req.query.mode) ? req.query.mode : "full"
    const minConceptFreq = Math.max(1, parseInt(req.query.minConceptFreq, 10) || 1)
    const dateFrom = req.query.dateFrom || null
    const dateTo   = req.query.dateTo   || null
    const domain   = req.query.domain   || null

    // Build memory ID filter when date/domain params present
    let memoryFilter = null
    if (dateFrom || dateTo || domain) {
      const conds = [], params = []
      if (dateFrom) { conds.push("timestamp >= ?"); params.push(dateFrom) }
      if (dateTo)   { conds.push("timestamp <= ?"); params.push(dateTo.replace(/T.*/, "") + "T23:59:59.999Z") }
      if (domain)   { conds.push("url LIKE ?");     params.push(`%${domain}%`) }
      const rows = await new Promise((resolve, reject) =>
        db.all(`SELECT id FROM memories${conds.length ? " WHERE " + conds.join(" AND ") : ""}`,
          params, (err, r) => (err ? reject(err) : resolve(r)))
      )
      memoryFilter = new Set(rows.map(r => r.id))
    }

    // Top domains for filter UI
    const domainRows = await new Promise((resolve, reject) =>
      db.all("SELECT url FROM memories ORDER BY engagement_score DESC, timestamp DESC LIMIT 300",
        [], (err, r) => (err ? reject(err) : resolve(r)))
    )
    const domainMap = new Map()
    for (const r of domainRows) {
      try {
        const host = new URL(r.url).hostname
        domainMap.set(host, (domainMap.get(host) || 0) + 1)
      } catch {}
    }
    const domains = [...domainMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([host, count]) => ({ host, count }))

    const viz = knowledgeGraph.getVisualizationData({
      maxNodes:        limit,
      includeMemories: mode !== "topics",
      memoryFilter,
      mode,
      minConceptFreq
    })
    const stats = knowledgeGraph.getStats()

    // Enrich memory nodes with full SQLite data
    for (const node of viz.nodes) {
      if (node.group !== "memory" || !node.memoryId) continue
      const row = await new Promise((resolve, reject) =>
        db.get(
          "SELECT title, url, engagement_score, session_id, sequence_number, timestamp FROM memories WHERE id = ?",
          [parseInt(node.memoryId, 10)], (err, r) => (err ? reject(err) : resolve(r)))
      )
      if (row) {
        const short = row.title.length > 24 ? row.title.slice(0, 22) + "…" : row.title
        node.label           = short
        node.title           = `${row.title}\n${row.url}\nEngagement: ${((row.engagement_score || 0) * 100).toFixed(0)}%`
        node.url             = row.url
        node.engagementScore = row.engagement_score
        node.sessionId       = row.session_id
        node.sequenceNumber  = row.sequence_number
        node.timestamp       = row.timestamp
        try { node.domain = new URL(row.url).hostname } catch {}
        node.size = 14 + Math.min(Math.round((row.engagement_score || 0) * 20), 18)
      }
    }

    res.json({ success: true, stats, domains, ...viz })
  } catch (err) {
    logError("graph_data_failure", err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ── Sessions summary (used by Journey view stats) ─────────────────────────────
app.get("/graph/sessions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100)
    const rows = await new Promise((resolve, reject) =>
      db.all(
        `SELECT s.id, s.start_time, s.end_time, s.page_count,
                COUNT(m.id) AS memory_count,
                GROUP_CONCAT(m.url, '|||') AS urls
         FROM sessions s
         LEFT JOIN memories m ON m.session_id = s.id
         GROUP BY s.id
         ORDER BY s.start_time DESC
         LIMIT ?`,
        [limit], (err, r) => (err ? reject(err) : resolve(r))
      )
    )
    const sessions = rows.map(r => ({
      id:          r.id,
      startTime:   r.start_time,
      endTime:     r.end_time,
      pageCount:   r.page_count,
      memoryCount: r.memory_count,
      domains:     [...new Set((r.urls || "").split("|||").map(u => {
        try { return new URL(u).hostname } catch { return null }
      }).filter(Boolean))].slice(0, 5)
    }))
    res.json({ success: true, sessions })
  } catch (err) {
    logError("sessions_summary_failure", err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// ============================================================================
// DATA EXPORT (Privacy Requirement 26.5)
// ============================================================================

app.get("/export", async (req, res) => {
  try {
    const memories = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM memories ORDER BY timestamp DESC", (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

    const sessions = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM sessions", (err, rows) => {
        if (err) reject(err)
        else resolve(rows)
      })
    })

    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      storage: "local",
      externalApis: [
        "http://localhost:11434 (Ollama — local inference + embeddings)",
        ...(modelProvider.cloudLlamaEnabled() ? ["AWS LLaMA endpoint (Cloud LLaMA switch on)"] : []),
        ...(modelProvider.cloudLlavaEnabled() ? ["AWS LLaVA endpoint (Cloud LLaVA switch on)"] : [])
      ],
      data: {
        memories,
        sessions,
        clusters: knowledgeGraph.getAllClusters(),
        graphStats: knowledgeGraph.getStats()
      }
    })
  } catch (err) {
    logError("export_failure", err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.listen(3001, () => {
  console.log("WebMind sidecar running on port 3001")
})