/**
 * Minimal zero-dependency .env loader.
 *
 * Populates process.env from (in order of precedence, highest first):
 *   1. the real process environment (never overwritten)
 *   2. sidecar/.env            (local override, optional)
 *   3. <repo root>/.env        (shared project config)
 *
 * Only KEY=VALUE lines are parsed. Blank lines and lines starting with `#`
 * are ignored. Surrounding single/double quotes are stripped. Values are
 * never logged — this file deliberately prints nothing about what it loaded.
 */

const fs = require("fs")
const path = require("path")

function parseEnvFile(filePath) {
  const out = {}
  let raw
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch {
    return out
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eq = trimmed.indexOf("=")
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    if (!key) continue

    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function loadEnv() {
  const candidates = [
    path.join(__dirname, ".env"), // sidecar/.env  (local override)
    path.join(__dirname, "..", ".env") // repo root .env (shared)
  ]

  for (const file of candidates) {
    const parsed = parseEnvFile(file)
    for (const [key, value] of Object.entries(parsed)) {
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  }
}

loadEnv()

module.exports = { loadEnv, parseEnvFile }
