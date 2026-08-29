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
  [key: string]: number | undefined
}

const styles = {
  container: {
    padding: 16,
    width: 480,
    fontFamily: "system-ui, Arial, sans-serif",
    maxHeight: 600,
    overflow: "auto" as const,
    fontSize: 13
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 16,
    borderBottom: "1px solid #dee2e6"
  },
  tab: (active: boolean) => ({
    flex: 1,
    padding: "8px 4px",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontWeight: active ? 600 : 400,
    color: active ? "#007bff" : "#666",
    borderBottom: active ? "2px solid #007bff" : "2px solid transparent",
    marginBottom: -1
  }),
  input: {
    width: "100%",
    padding: 10,
    marginBottom: 8,
    border: "1px solid #ccc",
    borderRadius: 4,
    fontSize: 14,
    boxSizing: "border-box" as const
  },
  btn: (color = "#007bff", disabled = false) => ({
    padding: "10px 12px",
    width: "100%",
    cursor: disabled ? "wait" : "pointer",
    backgroundColor: color,
    color: "white",
    border: "none",
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 600,
    opacity: disabled ? 0.6 : 1,
    marginBottom: 8
  }),
  card: (highlight = false) => ({
    border: `1px solid ${highlight ? "#ffc107" : "#dee2e6"}`,
    padding: 12,
    marginBottom: 10,
    borderRadius: 6,
    backgroundColor: highlight ? "#fffbf0" : "#fff",
    position: "relative" as const
  }),
  error: {
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#f8d7da",
    color: "#721c24",
    border: "1px solid #f5c6cb",
    borderRadius: 4,
    fontSize: 12
  },
  warning: {
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#fff3cd",
    color: "#856404",
    border: "1px solid #ffeeba",
    borderRadius: 4,
    fontSize: 12
  },
  synthesis: {
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#e8f4fd",
    border: "1px solid #b8daff",
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1.5
  },
  label: { display: "block", marginBottom: 4, fontWeight: 500, fontSize: 12 },
  fieldRow: { marginBottom: 10 }
}

function IndexPopup() {
  const [tab, setTab] = useState<Tab>("search")
  const [query, setQuery] = useState("")
  const [searchData, setSearchData] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null)

  const [clusters, setClusters] = useState<Cluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null)
  const [clusterMemories, setClusterMemories] = useState<SearchResult[]>([])
  const [relatedClusters, setRelatedClusters] = useState<Cluster[]>([])

  const [config, setConfig] = useState<ConfigValues>({})
  const [configDraft, setConfigDraft] = useState<ConfigValues>({})
  const [configErrors, setConfigErrors] = useState<string[]>([])

  const [graphStats, setGraphStats] = useState<GraphStats | null>(null)
  const [topConcepts, setTopConcepts] = useState<{ label: string; id: string }[]>([])

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((d) => setOllamaAvailable(d.ollamaAvailable ?? null))
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
    if (d.query_timeout !== undefined && (d.query_timeout < 1000 || d.query_timeout > 30000)) {
      errs.push("Query timeout must be between 1000 and 30000 ms")
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
      const concepts = (data.nodes || [])
        .filter((n: { group: string }) => n.group === "concept")
        .slice(0, 15)
        .map((n: { label: string; id: string }) => ({ label: n.label, id: n.id }))
      setTopConcepts(concepts)
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
      <h1 style={{ margin: "0 0 12px 0", fontSize: 18 }}>WebMind</h1>

      {ollamaAvailable === false && (
        <div style={styles.warning}>
          Ollama is unavailable. Search will run in search-only mode without answer synthesis.
        </div>
      )}

      <div style={styles.tabs}>
        {(["search", "clusters", "graph", "settings"] as Tab[]).map((t) => (
          <button key={t} style={styles.tab(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {tab === "search" && (
        <>
          <textarea
            placeholder="What are you trying to recall? Describe it naturally — include timing if you remember (e.g. 'that article about React hooks I read yesterday')"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), searchMemories())}
            style={{
              ...styles.input,
              height: 72,
              resize: "none" as const,
              lineHeight: 1.5,
              fontFamily: "inherit"
            }}
          />
          <button
            onClick={searchMemories}
            disabled={loading || !query.trim()}
            style={styles.btn("#007bff", loading || !query.trim())}>
            {loading ? "Searching memories…" : "Recall"}
          </button>

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

          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
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
              <div style={{ flex: 1.2 }}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{selectedCluster.label}</h3>

                {relatedClusters.length > 0 && (
                  <div style={{ marginBottom: 10, fontSize: 12 }}>
                    <strong>Related clusters</strong>
                    {relatedClusters.map((rc) => (
                      <div
                        key={rc.id}
                        style={{ color: "#007bff", cursor: "pointer", marginTop: 4 }}
                        onClick={() => selectCluster(rc)}>
                        {rc.label} ({rc.size})
                      </div>
                    ))}
                  </div>
                )}

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
            style={styles.btn("#3182ce", false)}>
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

          {topConcepts.length > 0 ? (
            <div>
              <strong style={{ fontSize: 12 }}>Top concepts</strong>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {topConcepts.map((c) => (
                  <span
                    key={c.id}
                    style={{
                      padding: "4px 8px",
                      backgroundColor: "#e8f4fd",
                      borderRadius: 12,
                      fontSize: 11,
                      color: "#2c5282"
                    }}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            !loading && (
              <p style={{ color: "#666", fontSize: 12, textAlign: "center", marginTop: 12 }}>
                No concepts yet. Browse pages with the extension to build the graph.
              </p>
            )
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
                value={configDraft[key] ?? ""}
                onChange={(e) =>
                  setConfigDraft({ ...configDraft, [key]: parseFloat(e.target.value) })
                }
                style={styles.input}
              />
            </div>
          ))}

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
