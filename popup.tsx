import { useState } from "react"

function IndexPopup() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])

  async function searchMemories() {
    try {
      const response = await fetch("http://localhost:3001/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query
        })
      })

      const data = await response.json()

      setResults(data)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div
      style={{
        padding: 20,
        width: 400,
        fontFamily: "Arial"
      }}>
      <h1>WebMind</h1>

      <input
        type="text"
        placeholder="Search your memory..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          padding: 10,
          marginBottom: 10
        }}
      />

      <button
        onClick={searchMemories}
        style={{
          padding: 10,
          width: "100%",
          cursor: "pointer"
        }}>
        Search
      </button>

      <div style={{ marginTop: 20 }}>
        {results.map((item: any, index: number) => (
          <div
            key={index}
            style={{
              border: "1px solid #ccc",
              padding: 10,
              marginBottom: 10
            }}>
            <h3>{item.title}</h3>

            <a href={item.url} target="_blank">
              {item.url}
            </a>

            <p>
              {item.text?.slice(0, 200)}
            </p>

            <small>
              Distance: {item._distance}
            </small>
          </div>
        ))}
      </div>
    </div>
  )
}

export default IndexPopup