const { OllamaEmbeddingClient } = require("./multimodal-embeddings")
const {
  embeddingRetryQueue,
  isOllamaError,
  logError
} = require("./error-handling")

const ollamaClient = new OllamaEmbeddingClient()
let ollamaAvailable = null

async function checkOllamaAvailability() {
  ollamaAvailable = await ollamaClient.checkAvailability()
  return ollamaAvailable
}

async function generateEmbedding(text, options = {}) {
  const { queueOnFailure = true, memoryId = null } = options

  try {
    if (ollamaAvailable === false) {
      const available = await checkOllamaAvailability()
      if (!available) {
        throw new Error("Ollama is unavailable")
      }
    }

    const embedding = await ollamaClient.generateTextEmbedding(text)
    ollamaAvailable = true
    return embedding
  } catch (error) {
    if (isOllamaError(error)) {
      ollamaAvailable = false
      logError("ollama_embedding_failure", error, { memoryId })

      if (queueOnFailure && text) {
        embeddingRetryQueue.enqueue({ text, memoryId })
      }
    }
    throw error
  }
}

module.exports = generateEmbedding
module.exports.checkOllamaAvailability = checkOllamaAvailability
module.exports.isOllamaAvailable = () => ollamaAvailable
module.exports.embeddingRetryQueue = embeddingRetryQueue
module.exports.ollamaClient = ollamaClient
