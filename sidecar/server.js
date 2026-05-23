const express = require("express")
const cors = require("cors")
const sqlite3 = require("sqlite3").verbose()
const lancedb = require("@lancedb/lancedb")
const generateEmbedding = require("./embed")

const app = express()

app.use(cors())
app.use(express.json())

const db = new sqlite3.Database("webmind.db")

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      url TEXT,
      content TEXT,
      timestamp TEXT
    )
  `)
})


let table

async function initializeVectorDB() {
  const db = await lancedb.connect("./lancedb")

  try {
    table = await db.openTable("webmind_vectors")
    console.log("Opened existing LanceDB table")
  } catch {
    table = await db.createTable("webmind_vectors", [
      {
        vector: Array(768).fill(0),
        text: "",
        title: "",
        url: ""
      }
    ])

    console.log("Created new LanceDB table")
  }
}

initializeVectorDB()

app.post("/ingest", async (req, res) => {
  const { title, url, text, timestamp } = req.body

  try {
    db.run(
      `
      INSERT INTO pages (title, url, content, timestamp)
      VALUES (?, ?, ?, ?)
      `,
      [title, url, text, timestamp]
    )

    const embedding = await generateEmbedding(text)

    await table.add([
  {
    vector: embedding,
    text,
    title,
    url,
    timestamp
  }
])

    console.log("Stored embedding:", title)

    res.send("Success")
  } catch (err) {
    console.error(err)
    res.status(500).send("Error")
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

app.post("/search", async (req, res) => {
  const { query } = req.body

  try {
    const queryEmbedding = await generateEmbedding(query)

    let results = await table.search(queryEmbedding).limit(10).toArray()

    const daysFilter = extractTimeReference(query)

    if (daysFilter !== null) {
      const now = Date.now()

      results = results.filter((item) => {
        if (!item.timestamp) return false

        const itemTime = new Date(item.timestamp).getTime()

        const diffDays = (now - itemTime) / (1000 * 60 * 60 * 24)

        // "today" means within the last 24 hours (diffDays < 1)
        return daysFilter === 0 ? diffDays < 1 : diffDays <= daysFilter
      })
    }

    results.sort((a, b) => a._distance - b._distance)

    res.json(results)
  } catch (err) {
    console.error(err)
    res.status(500).send("Search failed")
  }
})

app.listen(3001, () => {
  console.log("WebMind sidecar running on port 3001")
})