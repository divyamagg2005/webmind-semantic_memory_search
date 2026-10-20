/**
 * WebMind — Fake Data Seed Generator
 * ============================================================================
 * Populates the SAME stores the sidecar server uses, WITHOUT running the
 * server or the browser extension:
 *   - SQLite   (webmind.db)            memories, sessions, images, videos
 *   - LanceDB  (./lancedb)            webmind_vectors (real 768-d embeddings)
 *   - Graph    (./lancedb/knowledge-graph.json)  concepts/domains/associations
 *
 * It mirrors the real /ingest pipeline (server.js) by reusing the existing
 * modules, so the generated data is self-consistent with live data.
 *
 * REQUIREMENTS
 *   - Ollama running on localhost:11434 with `nomic-embed-text` pulled
 *     (embeddings are generated for real; no mocking).
 *
 * USAGE
 *   node seed-fake-data.js [--count 50] [--days 30] [--reset]
 *                          [--db webmind.db] [--lancedb ./lancedb]
 *
 *   --reset   Remove ONLY previously seeded rows (session_id prefix "seed-")
 *             and their memories/images/videos + matching vectors before
 *             inserting fresh ones. Real user data is left untouched.
 *
 * NOTE: Clusters are NOT created here. Start the server and call POST /cluster
 *       afterwards to populate the Clusters tab (needs the running server and,
 *       optionally, Python HDBSCAN).
 * ============================================================================
 */

const fs = require("fs")
const sqlite3 = require("sqlite3")
const lancedb = require("@lancedb/lancedb")

const { initializeSchema } = require("./init-schema")
const generateEmbedding = require("./embed")
const { checkOllamaAvailability } = generateEmbedding
const {
  calculateEngagementScore,
  calculateMemoryStrength
} = require("./engagement-score")
const { extractConcepts, calculateCoOccurrence } = require("./concept-extraction")
const { KnowledgeGraph } = require("./knowledge-graph")

const SEED_SESSION_PREFIX = "seed-"

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { count: 50, days: 30, reset: false, db: "webmind.db", lancedb: "./lancedb" }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--reset") args.reset = true
    else if (a === "--count") args.count = parseInt(argv[++i], 10)
    else if (a === "--days") args.days = parseInt(argv[++i], 10)
    else if (a === "--db") args.db = argv[++i]
    else if (a === "--lancedb") args.lancedb = argv[++i]
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0) }
  }
  if (!Number.isFinite(args.count) || args.count < 1) args.count = 50
  if (!Number.isFinite(args.days) || args.days < 1) args.days = 30
  return args
}

function printHelp() {
  console.log(`
WebMind fake data seeder

  node seed-fake-data.js [options]

  --count <n>      Number of memories to create (default 50)
  --days <n>       Spread timestamps over the last n days (default 30)
  --reset          Delete previously seeded data (session "seed-*") first
  --db <path>      SQLite path (default webmind.db)
  --lancedb <dir>  LanceDB directory (default ./lancedb)
  -h, --help       Show this help
`)
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function rand(min, max) { return Math.random() * (max - min) + min }
function randInt(min, max) { return Math.floor(rand(min, max + 1)) }
function pick(arr) { return arr[randInt(0, arr.length - 1)] }
function chance(p) { return Math.random() < p }

// Promise wrappers around sqlite3 callback API
function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this) }))
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))))
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))
}

// ---------------------------------------------------------------------------
// Fake content library — prose-rich so concept extraction yields real topics
// ---------------------------------------------------------------------------
const THEMES = [
  {
    key: "ai",
    label: "Machine Learning Research",
    pages: [
      {
        title: "Attention Is All You Need — Transformer Architecture",
        url: "https://arxiv.org/abs/1706.03762",
        content: `The Transformer architecture replaced recurrent networks with a mechanism built entirely on self-attention. Instead of processing tokens sequentially, the model attends to every position at once, computing weighted relationships between words regardless of distance. Multi-head attention lets the network learn several relationship patterns in parallel, while positional encodings inject word order back into an otherwise order-agnostic model. This design made training dramatically more parallel and became the foundation for large language models such as GPT and BERT.`,
        images: [
          { url: "https://arxiv.org/img/transformer-diagram.png", width: 1200, height: 800, alt: "Transformer encoder decoder diagram", caption: "A block diagram of the Transformer showing stacked encoder and decoder layers connected by multi-head attention." }
        ]
      },
      {
        title: "Neural Networks and Deep Learning",
        url: "https://en.wikipedia.org/wiki/Deep_learning",
        content: `Deep learning uses neural networks with many layers to learn hierarchical representations of data. Early layers capture simple features such as edges or phonemes, while deeper layers combine them into complex concepts like faces or sentences. Training relies on backpropagation and gradient descent to adjust millions of weights so that predictions match labelled examples. Convolutional networks excel at images, recurrent and transformer networks handle sequences, and the same optimisation principles underpin all of them.`
      },
      {
        title: "Understanding Gradient Descent and Backpropagation",
        url: "https://en.wikipedia.org/wiki/Backpropagation",
        content: `Backpropagation computes how much each weight in a neural network contributes to the overall error by applying the chain rule backward through the network. Gradient descent then nudges every weight in the direction that reduces loss. Learning rate controls how large each step is, and techniques like momentum, Adam, and learning-rate schedules stabilise and speed up convergence. Without efficient gradient computation, training deep models with millions of parameters would be intractable.`
      },
      {
        title: "A Gentle Introduction to Reinforcement Learning",
        url: "https://arxiv.org/abs/1811.12560",
        content: `Reinforcement learning trains an agent to make decisions by interacting with an environment and receiving rewards. The agent learns a policy that maps states to actions in order to maximise cumulative reward over time. Core ideas include the value function, the exploration versus exploitation tradeoff, and temporal-difference learning. Deep reinforcement learning combines these ideas with neural networks, enabling agents to master games, robotics control, and recommendation systems.`
      }
    ]
  },
  {
    key: "webdev",
    label: "Web Development",
    pages: [
      {
        title: "JavaScript Promises and async/await — MDN",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises",
        content: `A Promise represents the eventual result of an asynchronous operation. It can be pending, fulfilled, or rejected, and you chain handlers with then and catch to react to each outcome. The async and await keywords let you write asynchronous code that reads like synchronous code, pausing execution until a promise settles. Proper error handling with try/catch and awareness of the event loop are essential to avoid race conditions and unhandled rejections in JavaScript applications.`
      },
      {
        title: "CSS Flexbox Layout — A Complete Guide",
        url: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Flexible_Box_Layout",
        content: `Flexbox is a one-dimensional layout system for distributing space among items in a container. The main axis and cross axis determine how items flow, and properties such as justify-content, align-items, and flex-grow control alignment and sizing. Flexbox shines for navigation bars, card rows, and centring content both vertically and horizontally. Understanding the difference between the flex container and flex items is the key to predictable responsive layouts.`,
        images: [
          { url: "https://developer.mozilla.org/img/flexbox-axes.png", width: 900, height: 600, alt: "Flexbox main and cross axis diagram", caption: "An illustration of a flex container showing the main axis running horizontally and the cross axis running vertically." }
        ]
      },
      {
        title: "How do I center a div? — Stack Overflow",
        url: "https://stackoverflow.com/questions/114543/how-to-center-a-div",
        content: `Centring an element is a classic CSS question with several answers depending on context. For modern layouts, a flex container with justify-content and align-items set to center places a child in the middle. CSS Grid offers place-items center as an even shorter alternative. For absolute positioning, combining top and left at fifty percent with a translate transform keeps the element centred regardless of its size. Each approach has tradeoffs around browser support and surrounding layout.`
      },
      {
        title: "React Hooks: useState and useEffect explained",
        url: "https://react.dev/reference/react/useEffect",
        content: `React hooks let function components manage state and side effects without classes. useState stores local component state and triggers re-renders when updated. useEffect runs side effects such as data fetching or subscriptions after render, and its dependency array controls when it re-runs. Forgetting dependencies causes stale closures, while over-broad dependencies cause unnecessary work. Custom hooks compose these primitives into reusable logic shared across components.`
      }
    ]
  },
  {
    key: "cooking",
    label: "Cooking & Recipes",
    pages: [
      {
        title: "The Food Lab: How to Sear a Perfect Steak",
        url: "https://www.seriouseats.com/how-to-pan-sear-steaks",
        content: `A great seared steak starts with a dry surface and a screaming hot pan. Pat the meat dry, season generously with salt, and let it come toward room temperature before cooking. A heavy cast-iron skillet retains heat for the deep brown crust produced by the Maillard reaction. Baste with butter, garlic, and thyme near the end, then rest the steak so the juices redistribute. Use a thermometer rather than guesswork to hit your target doneness.`,
        images: [
          { url: "https://www.seriouseats.com/img/seared-steak.jpg", width: 1000, height: 667, alt: "Cast iron seared ribeye steak", caption: "A ribeye steak with a deep brown crust resting on a wooden board beside sprigs of thyme and a pat of butter." }
        ]
      },
      {
        title: "No-Knead Bread Recipe",
        url: "https://www.seriouseats.com/no-knead-bread-recipe",
        content: `No-knead bread relies on time instead of effort to develop gluten. Mix flour, water, salt, and a pinch of yeast into a shaggy dough, then let it ferment slowly for twelve to eighteen hours. The long rise builds flavour and structure without kneading. Baking the dough in a preheated covered pot traps steam, giving a crisp crust and an open, airy crumb. The technique turns four simple ingredients into bakery-quality bread at home.`
      },
      {
        title: "Essential Knife Skills for Home Cooks",
        url: "https://www.seriouseats.com/knife-skills-basics",
        content: `Good knife skills make cooking faster, safer, and more enjoyable. Hold the knife with a pinch grip on the blade and curl the fingers of your guiding hand into a claw to protect your fingertips. A sharp knife is safer than a dull one because it requires less force. Practising basic cuts such as the dice, julienne, and chiffonade builds muscle memory and produces evenly cooked food.`
      }
    ]
  },
  {
    key: "travel",
    label: "Travel Planning",
    pages: [
      {
        title: "Kyoto Travel Guide — Temples and Gardens",
        url: "https://www.lonelyplanet.com/japan/kyoto",
        content: `Kyoto served as Japan's imperial capital for over a thousand years and remains its cultural heart. Visitors come for the vermilion gates of Fushimi Inari, the golden pavilion of Kinkaku-ji, and the serene moss gardens of the eastern hills. Spring brings cherry blossoms and autumn paints the maples crimson, so those seasons draw the largest crowds. Renting a bicycle or using the efficient bus network makes the temple districts easy to explore.`,
        images: [
          { url: "https://www.lonelyplanet.com/img/fushimi-inari.jpg", width: 1200, height: 800, alt: "Fushimi Inari torii gates", caption: "A tunnel of thousands of closely spaced vermilion torii gates winding up a forested hillside at Fushimi Inari shrine." }
        ]
      },
      {
        title: "Backpacking Patagonia: The W Trek",
        url: "https://www.lonelyplanet.com/chile/patagonia",
        content: `The W Trek in Torres del Paine is one of Patagonia's most famous multi-day hikes. The route links granite towers, turquoise glacial lakes, and the hanging ice of Grey Glacier over roughly four to five days. Weather is notoriously fickle, with sun, wind, and rain possible in a single afternoon, so layered clothing and a windproof shell are essential. Booking refugios or campsites well in advance is necessary during the busy southern-hemisphere summer.`
      },
      {
        title: "48 Hours in Lisbon",
        url: "https://www.lonelyplanet.com/portugal/lisbon",
        content: `Lisbon rewards wandering through its steep, tiled streets and sunlit miradouros. Ride the vintage tram twenty-eight up to the Alfama district, sample custard tarts near the monastery in Belem, and watch the sunset over the river from a hilltop viewpoint. The city blends faded grandeur with a lively food and music scene, and fado performances in tiny taverns offer a window into Portuguese melancholy and soul.`
      }
    ]
  },
  {
    key: "finance",
    label: "Personal Finance",
    pages: [
      {
        title: "Index Funds vs Actively Managed Funds — Investopedia",
        url: "https://www.investopedia.com/terms/i/indexfund.asp",
        content: `An index fund passively tracks a market benchmark such as the S&P 500, holding every constituent in proportion to its weight. Because it requires little trading or research, its fees are far lower than an actively managed fund that pays analysts to pick winners. Decades of data show that after fees, most active managers fail to beat their benchmark. Low costs, broad diversification, and tax efficiency make index funds a cornerstone of long-term investing.`
      },
      {
        title: "Understanding Compound Interest",
        url: "https://www.investopedia.com/terms/c/compoundinterest.asp",
        content: `Compound interest is interest earned on both the original principal and the interest already accumulated. Over long horizons this snowball effect dominates returns, which is why starting to invest early matters so much. The frequency of compounding, the rate of return, and the time horizon together determine how large a balance grows. The same mechanism works against borrowers, making high-interest debt expensive to carry.`
      },
      {
        title: "How to Build an Emergency Fund",
        url: "https://www.investopedia.com/terms/e/emergency_fund.asp",
        content: `An emergency fund is cash set aside to cover unexpected expenses such as medical bills, car repairs, or a sudden loss of income. Financial planners typically recommend saving three to six months of essential living costs in a liquid, low-risk account. Building the fund gradually through automatic transfers removes the temptation to spend. Having this buffer prevents small emergencies from becoming debt spirals and provides peace of mind.`
      }
    ]
  },
  {
    key: "health",
    label: "Health & Fitness",
    pages: [
      {
        title: "The Science of Sleep and Recovery",
        url: "https://www.healthline.com/health/sleep-and-recovery",
        content: `Sleep is when the body repairs tissue, consolidates memory, and regulates hormones. During deep slow-wave sleep the body releases growth hormone and clears metabolic waste from the brain, while REM sleep supports learning and emotional processing. Most adults need seven to nine hours, and consistent sleep and wake times reinforce the circadian rhythm. Poor sleep impairs concentration, mood, immune function, and athletic recovery.`
      },
      {
        title: "Beginner's Guide to Strength Training",
        url: "https://www.healthline.com/health/strength-training-beginners",
        content: `Strength training builds muscle, bone density, and metabolic health through progressive resistance. Compound movements such as squats, deadlifts, presses, and rows recruit many muscles at once and deliver the most benefit for the time invested. Beginners should prioritise good form over heavy weight, add load gradually, and allow muscles time to recover between sessions. Consistency over months, not intensity in a single workout, drives lasting results.`
      },
      {
        title: "How Much Protein Do You Really Need?",
        url: "https://www.healthline.com/nutrition/how-much-protein-per-day",
        content: `Protein supplies the amino acids the body uses to repair tissue and build muscle. Active people and those trying to preserve muscle while losing fat generally benefit from more protein than the minimum recommended allowance. Spreading intake across meals and including a source after exercise supports recovery. Whole foods such as eggs, legumes, dairy, fish, and lean meat cover most needs without supplements.`
      }
    ]
  }
]

// Pre-written fake video metadata, attached to a few memories
const FAKE_VIDEOS = [
  { url: "https://www.youtube.com/watch?v=aircAruvnKk", duration: 1140, thumbnailUrl: "https://i.ytimg.com/vi/aircAruvnKk/hqdefault.jpg" },
  { url: "https://www.youtube.com/watch?v=steak-sear-demo", duration: 420, thumbnailUrl: "https://i.ytimg.com/vi/steak/hqdefault.jpg" },
  { url: "https://www.youtube.com/watch?v=kyoto-walk-4k", duration: 3600, thumbnailUrl: "https://i.ytimg.com/vi/kyoto/hqdefault.jpg" }
]

// ---------------------------------------------------------------------------
// Build the plan: group memories into sessions, assign timestamps
// ---------------------------------------------------------------------------
function buildSessionPlan(count, days) {
  const sessions = []
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  let remaining = count
  let idx = 0

  while (remaining > 0) {
    const size = Math.min(remaining, randInt(3, 8))
    const theme = pick(THEMES)
    // Session start somewhere in the last `days`, biased so some are old
    const daysAgo = rand(0, days)
    const start = now - Math.floor(daysAgo * dayMs) - randInt(0, 12) * 60 * 60 * 1000
    const sessionId = `${SEED_SESSION_PREFIX}${Date.now().toString(36)}-${idx}`

    const pages = []
    let t = start
    let prevUrl = null
    // Pool of theme pages; allow repeats (as revisits) when session is long
    for (let i = 0; i < size; i++) {
      const page = pick(theme.pages)
      t += randInt(1, 15) * 60 * 1000 // 1-15 min between pages
      pages.push({
        page,
        theme,
        timestamp: new Date(t).toISOString(),
        sequenceNumber: i,
        previousUrl: prevUrl,
        sessionId
      })
      prevUrl = page.url
    }

    sessions.push({ sessionId, theme, start, pages })
    idx++
    remaining -= size
  }
  return sessions
}

// ---------------------------------------------------------------------------
// Reset: remove only previously-seeded data
// ---------------------------------------------------------------------------
async function resetSeedData(db, table) {
  console.log("↺ Removing previously seeded data (session_id LIKE 'seed-%') ...")

  const memRows = await all(
    db,
    "SELECT id FROM memories WHERE session_id LIKE ?",
    [`${SEED_SESSION_PREFIX}%`]
  )
  const memIds = memRows.map(r => r.id)

  if (memIds.length) {
    const placeholders = memIds.map(() => "?").join(",")
    await run(db, `DELETE FROM images WHERE memory_id IN (${placeholders})`, memIds)
    await run(db, `DELETE FROM videos WHERE memory_id IN (${placeholders})`, memIds)
    await run(db, `DELETE FROM memories WHERE id IN (${placeholders})`, memIds)

    // Remove matching vectors from LanceDB
    if (table) {
      try {
        await table.delete(`memory_id IN (${memIds.join(",")})`)
      } catch (e) {
        console.warn("  (could not delete seeded vectors:", e.message, ")")
      }
    }
  }
  await run(db, "DELETE FROM sessions WHERE id LIKE ?", [`${SEED_SESSION_PREFIX}%`])
  console.log(`  removed ${memIds.length} memories and their media/vectors.`)
}

// ---------------------------------------------------------------------------
// Vector table open/create (same shape as server.js)
// ---------------------------------------------------------------------------
async function openVectorTable(dir) {
  const conn = await lancedb.connect(dir)
  try {
    return await conn.openTable("webmind_vectors")
  } catch {
    return await conn.createTable("webmind_vectors", [
      { vector: Array(768).fill(0), text: "", title: "", url: "", timestamp: "", memory_id: 0 }
    ])
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv)
  console.log(`\nWebMind seeder → ${args.count} memories over ${args.days} days`)
  console.log(`  db=${args.db}  lancedb=${args.lancedb}  reset=${args.reset}\n`)

  // Verify Ollama up-front (embeddings are real)
  const ok = await checkOllamaAvailability()
  if (!ok) {
    console.error("✖ Ollama is not reachable on localhost:11434.")
    console.error("  Start Ollama and ensure `nomic-embed-text` is pulled, then retry.")
    process.exit(1)
  }
  console.log("✓ Ollama reachable — generating real embeddings.\n")

  const db = new sqlite3.Database(args.db)
  await initializeSchema(db)
  await run(db, "PRAGMA foreign_keys = ON")

  const table = await openVectorTable(args.lancedb)

  // On --reset, start from an EMPTY knowledge graph. The graph has no notion of
  // "seeded" vs "real" nodes, so re-running without this would pile concepts,
  // associations and clusters on top of the previous run (node/edge explosion).
  const graphPath = `${args.lancedb}/knowledge-graph.json`
  if (args.reset) {
    try {
      fs.unlinkSync(graphPath)
      console.log("↺ Cleared knowledge graph for a fresh rebuild.")
    } catch (e) {
      if (e.code !== "ENOENT") console.warn("  (could not remove graph file:", e.message, ")")
    }
  }

  const graph = new KnowledgeGraph(graphPath)
  await graph.initialize()

  if (args.reset) await resetSeedData(db, table)

  const plan = buildSessionPlan(args.count, args.days)

  const stats = {
    sessions: 0, memories: 0, vectors: 0,
    concepts: 0, associations: 0, images: 0, videos: 0
  }
  const seenConcepts = new Set()

  let done = 0
  for (const session of plan) {
    // Insert session row (dominant_concepts/label backfilled after memories)
    await run(
      db,
      `INSERT INTO sessions (id, start_time, end_time, page_count, dominant_concepts, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.sessionId,
        new Date(session.start).toISOString(),
        session.pages[session.pages.length - 1].timestamp,
        session.pages.length,
        JSON.stringify([]),
        `[seed] ${session.theme.label}`
      ]
    )
    stats.sessions++

    const sessionConceptNames = new Set()

    for (const p of session.pages) {
      const { page, timestamp, sequenceNumber, previousUrl, sessionId } = p
      const title = page.title
      const url = page.url
      const content = page.content

      // --- engagement + strength (same formulas as the real pipeline) ---
      const dwellTime = randInt(5000, 480000)      // 5s - 8min
      const scrollDepth = randInt(10, 100)
      const revisitCount = randInt(0, 5)
      const isBookmarked = chance(0.15)
      const isPinned = chance(0.08)

      const engagementScore = calculateEngagementScore({ dwellTime, scrollDepth, revisitCount })
      const memoryStrength = calculateMemoryStrength({
        engagementScore,
        isBookmarked,
        uniqueVisitDates: revisitCount,
        associationBoost: 0
      })

      // --- insert memory (18-col shape from server.js:410) ---
      const res = await run(
        db,
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
          dwellTime, scrollDepth, revisitCount, timestamp,
          sessionId, null, sequenceNumber, previousUrl,
          isBookmarked ? 1 : 0, isPinned ? 1 : 0,
          engagementScore, memoryStrength,
          timestamp, timestamp
        ]
      )
      const memoryId = res.lastID
      stats.memories++

      // --- real text embedding → LanceDB ---
      const embedding = await generateEmbedding(content, { queueOnFailure: false })
      await table.add([{ vector: embedding, text: content, title, url, timestamp, memory_id: memoryId }])
      stats.vectors++

      // --- concepts + graph (mirror server.js:471-535) ---
      const concepts = extractConcepts(content, { maxTopics: 10, minConfidence: 0.6 })
      const conceptIds = []
      for (const concept of concepts) {
        graph.addConcept({ id: concept.id, name: concept.name, type: concept.type, confidence: concept.confidence })
        conceptIds.push(concept.id)
        sessionConceptNames.add(concept.name)
        if (!seenConcepts.has(concept.id)) { seenConcepts.add(concept.id); stats.concepts++ }
      }

      let pageDomain = null
      try { pageDomain = new URL(url).hostname } catch {}

      const memoryNodeId = `memory_${memoryId}`
      graph.addMemory({ id: memoryNodeId, memoryId: memoryId.toString(), timestamp, sessionId, domain: pageDomain })

      if (pageDomain) {
        const domainNodeId = graph.addDomain(pageDomain)
        graph.linkMemoryToDomain(memoryNodeId, domainNodeId)
      }

      // Chain to previous memory in the same session (journey path)
      const prevMemNodeId = graph.getPreviousMemoryInSession(sessionId, memoryNodeId)
      if (prevMemNodeId) graph.linkMemoriesInSession(prevMemNodeId, memoryNodeId, sessionId)

      for (const cid of conceptIds) graph.linkMemoryToConcept(memoryNodeId, cid, 1.0)

      calculateCoOccurrence(concepts) // keep parity with pipeline call
      for (let i = 0; i < conceptIds.length; i++) {
        for (let j = i + 1; j < conceptIds.length; j++) {
          if (graph.addConceptAssociation(conceptIds[i], conceptIds[j])) stats.associations++
        }
      }

      // --- images: store row + embed fake caption + graph node ---
      if (page.images && page.images.length) {
        for (const image of page.images) {
          const imgRes = await run(
            db,
            `INSERT INTO images (memory_id, url, width, height, alt, caption, embedding_stored)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [memoryId, image.url, image.width, image.height, image.alt || "", image.caption || ""]
          )
          const imageRowId = imgRes.lastID
          stats.images++

          const imgText = [image.alt, image.caption].filter(Boolean).join(". ")
          const imgEmbedding = await generateEmbedding(imgText, { queueOnFailure: false })
          await table.add([{
            vector: imgEmbedding,
            text: image.caption || "",
            title: `🖼 ${image.alt || "image"}`,
            url: image.url,
            timestamp,
            memory_id: memoryId
          }])
          stats.vectors++

          const imgNodeId = graph.addImage({
            id: `image_${imageRowId}`, imageId: imageRowId, url: image.url,
            alt: image.alt || "", caption: image.caption || "",
            width: image.width, height: image.height, memoryNodeId, timestamp
          })
          graph.linkMemoryToImage(memoryNodeId, imgNodeId)
        }
      }

      // --- occasionally attach a fake video ---
      if (chance(0.12)) {
        const v = pick(FAKE_VIDEOS)
        await run(
          db,
          `INSERT INTO videos (memory_id, url, duration, thumbnail_url) VALUES (?, ?, ?, ?)`,
          [memoryId, v.url, v.duration, v.thumbnailUrl]
        )
        stats.videos++
      }

      done++
      if (done % 10 === 0 || done === args.count) {
        process.stdout.write(`  …embedded ${done}/${args.count} memories\r`)
      }
    }

    // Backfill the session's dominant concepts for a nicer graph/journey view
    const dominant = Array.from(sessionConceptNames).slice(0, 5)
    await run(db, "UPDATE sessions SET dominant_concepts = ? WHERE id = ?",
      [JSON.stringify(dominant), session.sessionId])
  }

  // Persist graph and clean up (shutdown clears the auto-save timer + saves)
  await graph.save()
  await graph.shutdown()

  await new Promise((resolve) => db.close(() => resolve()))

  console.log("\n\n✓ Seed complete:")
  console.log(`   memories:      ${stats.memories}`)
  console.log(`   sessions:      ${stats.sessions}`)
  console.log(`   vectors:       ${stats.vectors}`)
  console.log(`   concepts:      ${stats.concepts} (unique)`)
  console.log(`   associations:  ${stats.associations}`)
  console.log(`   images:        ${stats.images}`)
  console.log(`   videos:        ${stats.videos}`)
  console.log(`\n   graph → ${args.lancedb}/knowledge-graph.json (${graph.graph.order} nodes, ${graph.graph.size} edges)`)
  console.log(`\nNext: start the server (node server.js), then POST /cluster to build clusters.\n`)
}

main().catch((err) => {
  console.error("\n✖ Seeding failed:", err)
  process.exit(1)
})
