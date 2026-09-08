/**
 * Model Provider Abstraction
 * =========================================================================
 * The rest of the sidecar asks this module for two things:
 *
 *     generateText({ prompt, ... })            -> string   (LLaMA)
 *     generateImageCaption({ imageUrl, ... })  -> string   (LLaVA)
 *
 * The provider decides, per call, whether to run the request against the
 * LOCAL Ollama runtime or an AWS-hosted endpoint, based on two independent
 * switches persisted in sidecar/config.json:
 *
 *     cloud_llama_enabled   ->  LLaMA text inference  (local Ollama | AWS)
 *     cloud_llava_enabled   ->  LLaVA image captions  (local Ollama | AWS)
 *
 * Nomic text embeddings are NOT handled here — they always stay local
 * (see embed.js / multimodal-embeddings.js).
 *
 * AWS contract: OpenAI-compatible Chat Completions. One shared API key
 * (AWS_API_KEY) sent as the `x-api-key` header (override with
 * AWS_API_KEY_HEADER). Two different endpoints: LLAMA_API_URL, LLAVA_API_URL.
 * Nothing about the key is ever logged or returned to callers.
 */

const { Ollama } = require("ollama")
const { getConfig } = require("./config-manager")

// ---------------------------------------------------------------------------
// Config / env helpers
// ---------------------------------------------------------------------------

const DEFAULT_LOCAL_LLM = "llama3.2:3b"
const DEFAULT_LOCAL_VISION = "llava"
const DEFAULT_CLOUD_TIMEOUT_MS = 30000

/** Raster formats we are willing to send to a vision model. */
const CAPTIONABLE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp"
])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function envKey() {
  return process.env.AWS_API_KEY || ""
}
function llamaUrl() {
  return process.env.LLAMA_API_URL || ""
}
function llavaUrl() {
  return process.env.LLAVA_API_URL || ""
}
function apiKeyHeader() {
  return process.env.AWS_API_KEY_HEADER || "x-api-key"
}
function cloudTimeoutMs() {
  const n = parseInt(process.env.AWS_TIMEOUT_MS || "", 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CLOUD_TIMEOUT_MS
}

function isLlamaCloudConfigured() {
  return Boolean(envKey() && llamaUrl())
}
function isLlavaCloudConfigured() {
  return Boolean(envKey() && llavaUrl())
}
function cloudLlamaEnabled() {
  try {
    return getConfig().cloud_llama_enabled === true
  } catch {
    return false
  }
}
function cloudLlavaEnabled() {
  try {
    return getConfig().cloud_llava_enabled === true
  } catch {
    return false
  }
}

/**
 * Snapshot for /health — booleans only, never the key or URLs.
 */
function getProviderStatus() {
  return {
    llama: {
      cloudEnabled: cloudLlamaEnabled(),
      cloudConfigured: isLlamaCloudConfigured(),
      activeProvider:
        cloudLlamaEnabled() && isLlamaCloudConfigured() ? "aws" : "local"
    },
    llava: {
      cloudEnabled: cloudLlavaEnabled(),
      cloudConfigured: isLlavaCloudConfigured(),
      activeProvider:
        cloudLlavaEnabled() && isLlavaCloudConfigured() ? "aws" : "local"
    },
    embeddings: { activeProvider: "local" }
  }
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Cloud switch is ON but the required env vars are missing. */
class CloudConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = "CloudConfigError"
    this.code = "CLOUD_CONFIG_MISSING"
  }
}

/** The AWS request itself failed (network, auth, throttle, bad body, empty). */
class CloudInferenceError extends Error {
  constructor(message, { status } = {}) {
    super(message)
    this.name = "CloudInferenceError"
    this.code = "CLOUD_INFERENCE_FAILED"
    if (status) this.status = status
  }
}

// ---------------------------------------------------------------------------
// Shared Ollama clients (local path)
// ---------------------------------------------------------------------------

let _ollama = null
function ollama() {
  if (!_ollama) _ollama = new Ollama()
  return _ollama
}

// ---------------------------------------------------------------------------
// AWS transport (OpenAI-compatible Chat Completions)
// ---------------------------------------------------------------------------

async function postChatCompletion(url, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cloudTimeoutMs())

  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [apiKeyHeader()]: envKey()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    if (err.name === "AbortError") {
      throw new CloudInferenceError(
        `AWS endpoint timed out after ${cloudTimeoutMs()}ms`
      )
    }
    throw new CloudInferenceError("Could not reach AWS endpoint")
  }
  clearTimeout(timer)

  if (!res.ok) {
    // Read a short slice of the body for logs only — never surfaced to clients.
    let detail = ""
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {}
    console.error(
      `[model-provider] AWS endpoint HTTP ${res.status}${
        detail ? ` — ${detail}` : ""
      }`
    )

    if (res.status === 401 || res.status === 403) {
      throw new CloudInferenceError(
        "AWS endpoint rejected the request — check that AWS_API_KEY is valid",
        { status: res.status }
      )
    }
    if (res.status === 429) {
      throw new CloudInferenceError(
        "AWS endpoint is rate-limiting requests (429) — retry shortly",
        { status: res.status }
      )
    }
    if (res.status === 413) {
      throw new CloudInferenceError(
        "AWS endpoint rejected the payload as too large (413)",
        { status: res.status }
      )
    }
    throw new CloudInferenceError(
      `AWS endpoint returned an error (HTTP ${res.status})`,
      { status: res.status }
    )
  }

  let data
  try {
    data = await res.json()
  } catch {
    throw new CloudInferenceError("AWS endpoint returned a malformed response")
  }

  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    (typeof data?.output_text === "string" ? data.output_text : null)

  if (typeof content !== "string" || content.trim() === "") {
    throw new CloudInferenceError("AWS endpoint returned an empty response")
  }
  return content.trim()
}

// ---------------------------------------------------------------------------
// Image fetch (cloud vision path needs base64 + mime for a data: URI)
// ---------------------------------------------------------------------------

async function fetchImageAsDataUri(url) {
  if (!url || typeof url !== "string") return null

  if (url.startsWith("data:")) {
    const comma = url.indexOf(",")
    if (comma === -1) return null
    const mime = url.slice(5, comma).toLowerCase().split(";")[0]
    if (!CAPTIONABLE_IMAGE_TYPES.has(mime)) return null
    return url // already a usable data: URI
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cloudTimeoutMs())
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const mime = (res.headers.get("content-type") || "")
      .toLowerCase()
      .split(";")[0]
      .trim()
    if (!CAPTIONABLE_IMAGE_TYPES.has(mime)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null
    return `data:${mime};base64,${buf.toString("base64")}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate text with LLaMA — local Ollama or AWS depending on the switch.
 *
 * @param {Object}  opts
 * @param {string}  opts.prompt
 * @param {string} [opts.system]       system / role instruction (both providers)
 * @param {string} [opts.model]        local Ollama model tag / cloud model name
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.numCtx]       local only
 * @returns {Promise<string>}
 */
async function generateText({
  prompt,
  system,
  model,
  temperature = 0.3,
  maxTokens = 200,
  numCtx = 2048
} = {}) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("generateText: prompt is required")
  }

  if (cloudLlamaEnabled()) {
    if (!isLlamaCloudConfigured()) {
      throw new CloudConfigError(
        "Cloud LLaMA is enabled but AWS_API_KEY and/or LLAMA_API_URL are not set"
      )
    }
    const messages = []
    if (system) messages.push({ role: "system", content: system })
    messages.push({ role: "user", content: prompt })
    return postChatCompletion(llamaUrl(), {
      model: process.env.AWS_LLAMA_MODEL || model || "llama-3.2-3b",
      messages,
      temperature,
      max_tokens: maxTokens
    })
  }

  // Local Ollama
  const response = await ollama().generate({
    model: model || getConfigModel("llm_model", DEFAULT_LOCAL_LLM),
    prompt,
    system: system || undefined,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
      num_ctx: numCtx
    }
  })
  const text = (response && response.response ? response.response : "").trim()
  if (!text) throw new Error("Local LLaMA returned an empty response")
  return text
}

/**
 * Caption an image with LLaVA — local Ollama or AWS depending on the switch.
 * Returns null when the image can't be fetched / decoded (caller skips it).
 *
 * @param {Object}  opts
 * @param {string}  opts.imageUrl
 * @param {string} [opts.altText]
 * @param {string} [opts.prompt]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<string|null>}
 */
async function generateImageCaption({
  imageUrl,
  altText = "",
  prompt,
  maxTokens = 150
} = {}) {
  if (!imageUrl || typeof imageUrl !== "string") return null

  const hint = altText ? ` The page's alt text for it is: "${altText}".` : ""
  const instruction =
    prompt ||
    "Describe this image concisely for search indexing. " +
      "One or two sentences. Focus on the visible subject, any readable text, " +
      "and the image type (photo, diagram, screenshot, chart, logo, illustration)." +
      hint

  if (cloudLlavaEnabled()) {
    if (!isLlavaCloudConfigured()) {
      throw new CloudConfigError(
        "Cloud LLaVA is enabled but AWS_API_KEY and/or LLAVA_API_URL are not set"
      )
    }
    const dataUri = await fetchImageAsDataUri(imageUrl)
    if (!dataUri) return null

    return postChatCompletion(llavaUrl(), {
      model: process.env.AWS_LLAVA_MODEL || "llava",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            { type: "image_url", image_url: { url: dataUri } }
          ]
        }
      ],
      max_tokens: maxTokens
    })
  }

  // Local Ollama vision
  const b64 = await fetchImageBase64(imageUrl)
  if (!b64) return null
  try {
    const response = await ollama().generate({
      model: getConfigModel("vision_model", DEFAULT_LOCAL_VISION),
      prompt: instruction,
      images: [b64],
      stream: false
    })
    const caption = (
      response && response.response ? response.response : ""
    ).trim()
    return caption || null
  } catch (err) {
    console.error(
      `[model-provider] local LLaVA captioning failed for ${imageUrl}:`,
      err.message
    )
    return null
  }
}

// Local vision helper: raw base64 (no data: prefix), mime-validated.
async function fetchImageBase64(url) {
  if (!url || typeof url !== "string") return null
  try {
    if (url.startsWith("data:")) {
      const comma = url.indexOf(",")
      if (comma === -1) return null
      const meta = url.slice(5, comma).toLowerCase()
      const mime = meta.split(";")[0]
      if (!CAPTIONABLE_IMAGE_TYPES.has(mime)) return null
      return meta.includes("base64")
        ? url.slice(comma + 1)
        : Buffer.from(decodeURIComponent(url.slice(comma + 1))).toString("base64")
    }
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType = (res.headers.get("content-type") || "")
      .toLowerCase()
      .split(";")[0]
      .trim()
    if (!CAPTIONABLE_IMAGE_TYPES.has(contentType)) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null
    return buf.toString("base64")
  } catch (error) {
    console.error(`[model-provider] failed to fetch image ${url}:`, error.message)
    return null
  }
}

function getConfigModel(key, fallback) {
  try {
    return getConfig()[key] || fallback
  } catch {
    return fallback
  }
}

module.exports = {
  generateText,
  generateImageCaption,
  isLlamaCloudConfigured,
  isLlavaCloudConfigured,
  cloudLlamaEnabled,
  cloudLlavaEnabled,
  getProviderStatus,
  CloudConfigError,
  CloudInferenceError
}
