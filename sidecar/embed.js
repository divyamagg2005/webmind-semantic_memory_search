const { Ollama } = require("ollama")

const ollama = new Ollama()

async function generateEmbedding(text) {
  const response = await ollama.embed({
    model: "nomic-embed-text",
    input: text
  })

  return response.embeddings[0]
}

module.exports = generateEmbedding