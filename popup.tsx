import { useEffect, useState } from "react"

const API = "http://localhost:3001"

type Tab = "search" | "clusters" | "graph" | "settings"

interface GraphStats {
  concepts: number
  memories: number
  clusters: number
  conceptAssociations: number
  memoryConceptLinks: number
  totalNodes: number
  totalEdges: number
}

interface Citation {
  memoryId: string | number
  title: string
  url: string
  relevanceScore: number
  excerpt?: string
}

interface AssociationPath {
  memoryId: string | number
  concepts: string[]
  hops: number
}

interface SearchResult {
  memoryId?: number
  memory_id?: number
  id?: number
  title: string
  url: string
  text?: string
  content?: string
  _distance?: number
  is_pinned?: boolean
  isPinned?: boolean
  is_bookmarked?: boolean
  isBookmarked?: boolean
  decayed_strength?: number
  decayedStrength?: number
  engagementScore?: number
  engagement_score?: number
  memoryStrength?: number
  memory_strength?: number
  scores?: { combined?: number; semantic?: number; associative?: number }
}

interface SearchResponse {
  answer?: string | null
  synthesized?: boolean
  citations?: Citation[]
  results?: SearchResult[]
  associationPaths?: AssociationPath[]
  warnings?: string[]
  timedOut?: boolean
  searchMode?: string
  detectedTimeRange?: { label: string; dateFrom: string; dateTo: string }
  metadata?: { fallbackReason?: string }
}

interface Cluster {
  id: string
  label: string
  size: number
}

interface ConfigValues {
  decay_rate?: number
  engagement_weight_dwell?: number
  engagement_weight_scroll?: number
  engagement_weight_revisit?: number
  session_timeout?: number
  min_cluster_size?: number
  query_timeout?: number
  cloud_llama_enabled?: boolean
  cloud_llava_enabled?: boolean
  [key: string]: number | boolean | undefined
}

interface ProviderStatus {
  llama: { cloudEnabled: boolean; cloudConfigured: boolean; activeProvider: string }
  llava: { cloudEnabled: boolean; cloudConfigured: boolean; activeProvider: string }
  embeddings: { activeProvider: string }
}

const BLUE = "#2563eb"
const BLUE_DARK = "#1d4ed8"
const BLUE_SOFT = "#eff6ff"
const BLUE_BORDER = "#bfdbfe"
const NEON = "0 0 0 2px rgba(37,99,235,0.25), 0 0 14px 2px rgba(37,99,235,0.55)"

const styles = {
  container: {
    padding: 18,
    width: 480,
    boxSizing: "border-box" as const,
    fontFamily: "system-ui, Arial, sans-serif",
    maxHeight: 600,
    overflow: "auto" as const,
    fontSize: 13,
    color: "#1e3a5f",
    background: "linear-gradient(180deg, #ffffff 0%, #f5f9ff 100%)"
  },
  header: {
    position: "relative" as const,
    textAlign: "center" as const,
    marginBottom: 14
  },
  brand: {
    margin: 0,
    fontFamily: '"Sankofa Display", system-ui, sans-serif',
    fontWeight: 400,
    fontSize: 34,
    letterSpacing: 1,
    color: BLUE,
    lineHeight: 1.1
  },
  gear: (active: boolean) => ({
    position: "absolute" as const,
    top: 2,
    right: 0,
    width: 34,
    height: 34,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${active ? BLUE : BLUE_BORDER}`,
    borderRadius: "50%",
    background: active ? BLUE : "#fff",
    color: active ? "#fff" : BLUE,
    cursor: "pointer",
    boxShadow: active ? NEON : "none",
    transition: "all 0.18s ease"
  }),
  pills: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
    marginBottom: 18
  },
  pill: (active: boolean) => ({
    flex: 1,
    padding: "9px 4px",
    borderRadius: 999,
    border: `1px solid ${active ? BLUE : BLUE_BORDER}`,
    background: active ? BLUE : "#fff",
    color: active ? "#fff" : BLUE,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    boxShadow: active ? NEON : "none",
    transition: "all 0.18s ease"
  }),
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 8,
    border: `1px solid ${BLUE_BORDER}`,
    borderRadius: 14,
    fontSize: 14,
    boxSizing: "border-box" as const,
    outline: "none",
    background: "#fff"
  },
  btn: (color = BLUE, disabled = false) => ({
    padding: "11px 12px",
    width: "100%",
    cursor: disabled ? "wait" : "pointer",
    backgroundColor: color,
    color: "white",
    border: "none",
    borderRadius: 14,
    fontSize: 13,
    fontWeight: 600,
    opacity: disabled ? 0.6 : 1,
    marginBottom: 8,
    boxShadow: disabled ? "none" : "0 2px 8px rgba(37,99,235,0.25)"
  }),
  card: (highlight = false) => ({
    border: `1px solid ${highlight ? BLUE : BLUE_BORDER}`,
    padding: 12,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: highlight ? BLUE_SOFT : "#fff",
    boxShadow: "0 1px 6px rgba(37,99,235,0.08)",
    position: "relative" as const
  }),
  error: {
    padding: 11,
    marginBottom: 10,
    backgroundColor: "#fdecee",
    color: "#a12a3a",
    border: "1px solid #f5c6cb",
    borderRadius: 14,
    fontSize: 12
  },
  warning: {
    padding: 11,
    marginBottom: 10,
    backgroundColor: "#fff8e6",
    color: "#8a6d1a",
    border: "1px solid #ffeeba",
    borderRadius: 14,
    fontSize: 12
  },
  synthesis: {
    padding: 14,
    marginBottom: 12,
    backgroundColor: BLUE_SOFT,
    border: `1px solid ${BLUE_BORDER}`,
    borderRadius: 16,
    fontSize: 13,
    lineHeight: 1.5
  },
  label: { display: "block", marginBottom: 4, fontWeight: 500, fontSize: 12 },
  fieldRow: { marginBottom: 10 }
}

const ArrowIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

const GearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

function IndexPopup() {
  const [tab, setTab] = useState<Tab>("search")
  const [query, setQuery] = useState("")
  const [searchData, setSearchData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)

  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [clusterMemories, setClusterMemories] = useState<SearchResult[]>([])
  const [relatedClusters, setRelatedClusters] = useState<Cluster[]>([])

  const [config, setConfig] = useState<ConfigValues>({})
  const [configDraft, setConfigDraft] = useState<ConfigValues>({})
  const [configErrors, setConfigErrors] = useState<string[]>([])

  const [graphStats, setGraphStats] = useState<GraphStats | null>(null)

  useEffect(() => {
    const defs: Partial<HTMLLinkElement>[] = [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bowlby+One&family=Sankofa+Display&display=swap"
      }
    ]
    const els = defs.map((d) => {
      const el = document.createElement("link")
      Object.assign(el, d)
      document.head.appendChild(el)
      return el
    })

    const style = document.createElement("style")
    style.textContent = `
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      @keyframes wm-spin { to { transform: rotate(360deg); } }
    `
    document.head.appendChild(style)
    els.push(style as unknown as HTMLLinkElement)

    return () => els.forEach((el) => el.remove())
  }, [])

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((d) => {
        setOllamaAvailable(d.ollamaAvailable ?? null)
        setProviderStatus(d.provider ?? null)
      })
      .catch(() => setOllamaAvailable(false))
  }, [])

  async function searchMemories() {
    if (!query.trim()) return
    setLoading(true)
    setError("")
    setSearchData(null)

    try {
      const response = await fetch(`${API}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Search failed")
      setSearchData(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed")
    } finally {
      setLoading(false)
    }
  }

  async function togglePin(memoryId: number, currentlyPinned: boolean) {
    try {
      const endpoint = currentlyPinned ? "unpin" : "pin"
      const response = await fetch(`${API}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryId })
      })
      if (!response.ok) throw new Error(`Failed to ${endpoint}`)

      if (searchData?.results) {
        setSearchData({
          ...searchData,
          results: searchData.results.map((r) => {
            const id = r.memoryId ?? r.memory_id ?? r.id
            if (id === memoryId) {
              return { ...r, is_pinned: !currentlyPinned, isPinned: !currentlyPinned }
            }
            return r
          })
        })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Pin update failed")
    }
  }

  async function loadClusters() {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API}/clusters`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load clusters")
      setClusters(data.clusters || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load clusters")
    } finally {
      setLoading(false)
    }
  }

  async function selectCluster(cluster: Cluster) {
    setSelectedCluster(cluster)
    setLoading(true)
    setError("")
    try {
      const [detailRes, memRes] = await Promise.all([
        fetch(`${API}/clusters/${encodeURIComponent(cluster.id)}`),
        fetch(`${API}/clusters/${encodeURIComponent(cluster.id)}/memories`)
      ])
      const detail = await detailRes.json()
      const memData = await memRes.json()
      if (!detailRes.ok) throw new Error(detail.error)
      if (!memRes.ok) throw new Error(memData.error)
      setRelatedClusters(detail.related || [])
      setClusterMemories(memData.memories || [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load cluster")
    } finally {
      setLoading(false)
    }
  }

  async function loadConfig() {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API}/config`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setConfig(data.config || {})
      setConfigDraft(data.config || {})
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load config")
    } finally {
      setLoading(false)
    }
  }

  function validateConfig(): string[] {
    const errs: string[] = []
    const d = configDraft
    if (d.decay_rate !== undefined && (d.decay_rate < 0.001 || d.decay_rate > 0.1)) {
      errs.push("Decay rate must be between 0.001 and 0.1")
    }
    if (d.session_timeout !== undefined && (d.session_timeout < 300 || d.session_timeout > 7200)) {
      errs.push("Session timeout must be between 300 and 7200 seconds")
    }
    if (d.query_timeout !== undefined && (d.query_timeout < 5000 || d.query_timeout > 60000)) {
      errs.push("Query timeout must be between 5000 and 60000 ms")
    }
    const weights = [
      d.engagement_weight_dwell,
      d.engagement_weight_scroll,
      d.engagement_weight_revisit
    ].filter((w) => w !== undefined) as number[]
    if (weights.length === 3) {
      const sum = weights.reduce((a, b) => a + b, 0)
      if (Math.abs(sum - 1) > 0.01) {
        errs.push("Engagement weights should sum to 1.0")
      }
    }
    return errs
  }

  async function saveConfig() {
    const errs = validateConfig()
    setConfigErrors(errs)
    if (errs.length > 0) return

    setLoading(true)
    try {
      const updates: ConfigValues = {}
      for (const key of Object.keys(configDraft)) {
        if (configDraft[key] !== config[key]) {
          updates[key] = configDraft[key]
        }
      }
      if (Object.keys(updates).length === 0) {
        setConfigErrors(["No changes to save"])
        return
      }

      const response = await fetch(`${API}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates })
      })
      const data = await response.json()
      if (!response.ok) {
        setConfigErrors(data.errors || [data.error || "Save failed"])
        return
      }
      setConfig(data.config)
      setConfigDraft(data.config)
      setConfigErrors([])
      // Refresh provider status so the Local/AWS labels reflect the save
      fetch(`${API}/health`)
        .then((r) => r.json())
        .then((d) => setProviderStatus(d.provider ?? null))
        .catch(() => {})
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed")
    } finally {
      setLoading(false)
    }
  }

  async function loadGraphSummary() {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API}/graph/data?limit=200&memories=false`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load graph")
      setGraphStats(data.stats)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load graph")
    } finally {
      setLoading(false)
    }
  }

  function openGraphViewer() {
    chrome.tabs.create({ url: `${API}/graph` })
  }

  useEffect(() => {
    if (tab === "clusters") loadClusters()
    if (tab === "graph") loadGraphSummary()
    if (tab === "settings") loadConfig()
  }, [tab])

  const results = searchData?.results || []

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.brand}>WEBMIND</h1>
        <button
          style={styles.gear(tab === "settings")}
          onClick={() => setTab("settings")}
          title="Settings"
          aria-label="Settings">
          <GearIcon />
        </button>
      </div>

      {ollamaAvailable === false && (
        <div style={styles.warning}>
          Ollama is unavailable. Search will run in search-only mode without answer synthesis.
        </div>
      )}

      <div style={styles.pills}>
        {(["search", "clusters", "graph"] as Tab[]).map((t) => (
          <button key={t} style={styles.pill(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {tab === "search" && (
        <>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <textarea
              placeholder="What are you trying to recall? Describe it naturally — include timing if you remember (e.g. 'that article about React hooks I read yesterday')"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), searchMemories())}
              style={{
                ...styles.input,
                height: 84,
                marginBottom: 0,
                paddingRight: 58,
                resize: "none" as const,
                lineHeight: 1.5,
                fontFamily: "inherit"
              }}
            />
            <button
              onClick={searchMemories}
              disabled={loading || !query.trim()}
              title="Recall"
              aria-label="Recall"
              style={{
                position: "absolute",
                right: 10,
                bottom: 10,
                width: 38,
                height: 38,
                borderRadius: "50%",
                border: "none",
                background: BLUE,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: loading || !query.trim() ? "not-allowed" : "pointer",
                opacity: loading || !query.trim() ? 0.5 : 1,
                boxShadow: loading || !query.trim() ? "none" : NEON,
                transition: "all 0.18s ease"
              }}>
              {loading ? (
                <span style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: "2.5px solid rgba(255,255,255,0.4)",
                  borderTopColor: "#fff", display: "inline-block",
                  animation: "wm-spin 0.7s linear infinite"
                }} />
              ) : (
                <ArrowIcon />
              )}
            </button>
          </div>

          {searchData?.detectedTimeRange && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "#e8f4fd", border: "1px solid #b8daff",
              borderRadius: 20, padding: "3px 10px", fontSize: 11,
              color: "#2c5282", marginBottom: 10
            }}>
              <span>🕐</span>
              <span>Filtering by: <strong>{searchData.detectedTimeRange.label}</strong></span>
            </div>
          )}

          {searchData?.warnings?.filter(w => !w.includes("LLM synthesis skipped")).map((w, i) => (
            <div key={i} style={styles.warning}>{w}</div>
          ))}

          {searchData?.answer && (
            <div style={styles.synthesis}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12, color: "#2c5282" }}>
                Memory synthesis
                {searchData.synthesized === false && (
                  <span style={{ color: "#856404", marginLeft: 8, fontWeight: 400 }}>(fallback)</span>
                )}
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#1a365d" }}>
                {searchData.answer.split("**Sources:**")[0].trim()}
              </p>
            </div>
          )}

          {results.length === 0 && !loading && query && searchData && (
            <p style={{ textAlign: "center", color: "#666", marginTop: 16 }}>No matching memories found</p>
          )}

          {results.length > 0 && (
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
              {results.length} matching {results.length === 1 ? "page" : "pages"} found
              {searchData?.searchMode === "search-only" && " · semantic mode"}
            </div>
          )}

          {results.map((item, index) => {
            const memoryId = item.memoryId ?? item.memory_id ?? item.id
            const isPinned = item.isPinned ?? item.is_pinned ?? false
            const isBookmarked = item.isBookmarked ?? item.is_bookmarked ?? false
            const text = item.content || item.text || ""
            const ts = (item as any).timestamp
            const domain = (() => { try { return new URL(item.url).hostname } catch { return "" } })()
            const timeStr = ts ? (() => {
              const d = new Date(ts)
              const now = new Date()
              const diffMs = now.getTime() - d.getTime()
              const diffH = diffMs / 3600000
              if (diffH < 1) return `${Math.round(diffMs/60000)}m ago`
              if (diffH < 24) return `${Math.round(diffH)}h ago`
              if (diffH < 48) return `Yesterday ${d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`
              return d.toLocaleDateString([], {month:"short",day:"numeric"}) + " " + d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})
            })() : ""
            const score = item.scores?.combined
            const relevancePct = score !== undefined ? Math.round(Math.min(score, 1) * 100) : null

            return (
              <div key={index} style={{
                ...styles.card(isPinned),
                borderLeft: `3px solid ${isPinned ? "#ffc107" : "#007bff"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, flex: 1, paddingRight: 8, lineHeight: 1.4 }}>
                    {item.title || domain}
                  </h3>
                  {relevancePct !== null && (
                    <span style={{
                      fontSize: 10, background: relevancePct > 70 ? "#d4edda" : "#e2e8f0",
                      color: relevancePct > 70 ? "#155724" : "#555",
                      borderRadius: 10, padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0
                    }}>
                      {relevancePct}% match
                    </span>
                  )}
                </div>

                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 11, color: "#007bff", display: "block",
                    marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                  }}>
                  {item.url}
                </a>

                {text && (
                  <p style={{ margin: "0 0 6px 0", fontSize: 11, color: "#444", lineHeight: 1.4 }}>
                    {text.slice(0, 160)}{text.length > 160 ? "…" : ""}
                  </p>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "#888" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    {timeStr && <span>🕐 {timeStr}</span>}
                    {domain && <span>🌐 {domain}</span>}
                    {isBookmarked && <span>🔖</span>}
                  </div>
                  {memoryId && (
                    <button
                      onClick={() => togglePin(Number(memoryId), isPinned)}
                      style={{
                        padding: "2px 7px", fontSize: 10, cursor: "pointer",
                        backgroundColor: isPinned ? "#ffc107" : "#e9ecef",
                        color: isPinned ? "#fff" : "#555",
                        border: "none", borderRadius: 3
                      }}>
                      {isPinned ? "Unpin" : "Pin"}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}

      {tab === "clusters" && (
        <>
          <button onClick={loadClusters} disabled={loading} style={styles.btn("#6c757d", loading)}>
            Refresh clusters
          </button>

          {clusters.length === 0 && !loading && (
            <p style={{ color: "#666", textAlign: "center" }}>
              No clusters yet. Run clustering from the sidecar API.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
              {clusters.map((c) => (
                <div
                  key={c.id}
                  onClick={() => selectCluster(c)}
                  style={{
                    ...styles.card(selectedCluster?.id === c.id),
                    cursor: "pointer"
                  }}>
                  <strong>{c.label}</strong>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                    {c.size} memories
                  </div>
                </div>
              ))}
            </div>

            {selectedCluster && (
              <div style={{ flex: 1.2, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{selectedCluster.label}</h3>

                {clusterMemories.map((m, i) => (
                  <div key={i} style={styles.card()}>
                    <a href={m.url} target="_blank" rel="noreferrer" style={{ color: "#007bff", fontSize: 12 }}>
                      {m.title}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "graph" && (
        <>
          <button
            onClick={openGraphViewer}
            style={{
              ...styles.btn("#22c55e", false),
              boxShadow: "0 0 12px rgba(34,197,94,0.65), 0 2px 8px rgba(34,197,94,0.35)"
            }}>
            Open interactive graph viewer
          </button>
          <button
            onClick={loadGraphSummary}
            disabled={loading}
            style={styles.btn("#6c757d", loading)}>
            {loading ? "Loading…" : "Refresh summary"}
          </button>

          {graphStats && (
            <div style={{ fontSize: 12, marginBottom: 12, color: "#444" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <span>Concepts: {graphStats.concepts}</span>
                <span>Memories: {graphStats.memories}</span>
                <span>Clusters: {graphStats.clusters}</span>
                <span>Links: {graphStats.memoryConceptLinks}</span>
                <span>Associations: {graphStats.conceptAssociations}</span>
                <span>Nodes: {graphStats.totalNodes}</span>
              </div>
            </div>
          )}

          {!graphStats && !loading && (
            <p style={{ color: "#666", fontSize: 12, textAlign: "center", marginTop: 12 }}>
              No graph data yet. Browse pages with the extension to build the graph.
            </p>
          )}
        </>
      )}

      {tab === "settings" && (
        <>
          {[
            { key: "decay_rate", label: "Decay rate (per day)", step: 0.001 },
            { key: "session_timeout", label: "Session timeout (seconds)", step: 60 },
            { key: "query_timeout", label: "Query timeout (ms)", step: 500 },
            { key: "min_cluster_size", label: "Min cluster size", step: 1 },
            { key: "engagement_weight_dwell", label: "Dwell weight", step: 0.05 },
            { key: "engagement_weight_scroll", label: "Scroll weight", step: 0.05 },
            { key: "engagement_weight_revisit", label: "Revisit weight", step: 0.05 }
          ].map(({ key, label, step }) => (
            <div key={key} style={styles.fieldRow}>
              <label style={styles.label}>{label}</label>
              <input
                type="number"
                step={step}
                value={(configDraft[key] as number | undefined) ?? ""}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, [key]: parseFloat(e.target.value) })
                }
                style={styles.input}
              />
            </div>
          ))}

          <div style={{ borderTop: "1px solid #dee2e6", margin: "6px 0 12px", paddingTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
              Inference providers
            </div>
            <p style={{ fontSize: 11, color: "#666", margin: "0 0 10px" }}>
              Nomic text embeddings always run locally. LLaMA and LLaVA can each be
              switched to the configured AWS endpoint independently.
            </p>

            {[
              {
                key: "cloud_llama_enabled" as const,
                label: "Cloud LLaMA",
                sub: "Text synthesis + cluster labels via AWS",
                status: providerStatus?.llama
              },
              {
                key: "cloud_llava_enabled" as const,
                label: "Cloud LLaVA",
                sub: "Image captioning via AWS",
                status: providerStatus?.llava
              }
            ].map(({ key, label, sub, status }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={configDraft[key] === true}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, [key]: e.target.checked })
                    }
                  />
                  <span style={{ fontWeight: 500, fontSize: 12 }}>{label}</span>
                  <span style={{ fontSize: 10, color: "#888" }}>
                    {(configDraft[key] === true ? "AWS" : "Local Ollama")}
                  </span>
                </label>
                <div style={{ fontSize: 10, color: "#999", marginLeft: 24 }}>{sub}</div>
                {configDraft[key] === true && status && !status.cloudConfigured && (
                  <div style={{ ...styles.warning, marginTop: 4, marginLeft: 24 }}>
                    AWS config missing on the sidecar (.env). This provider will fail
                    until AWS_API_KEY and the endpoint URL are set.
                  </div>
                )}
              </div>
            ))}
          </div>

          {configErrors.map((e, i) => (
            <div key={i} style={styles.error}>
              {e}
            </div>
          ))}

          <button onClick={saveConfig} disabled={loading} style={styles.btn("#28a745", loading)}>
            Save configuration
          </button>
        </>
      )}
    </div>
  )
}

export default IndexPopup
