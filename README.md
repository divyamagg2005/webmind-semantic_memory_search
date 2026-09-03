# WebMind

A Plasmo browser extension that builds a human-like memory of the pages you
visit — capturing text **and images** — with a local sidecar server for
embeddings, a knowledge graph, and hybrid retrieval. All inference runs locally
through Ollama.

## Setup

Run the setup script for your OS (installs tools, pulls Ollama models, installs
dependencies, initializes the database):

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

```bash
# macOS
chmod +x scripts/setup.sh && ./scripts/setup.sh
```

See [`scripts/README.md`](scripts/README.md) for flags, Linux notes, and the full
requirement list.

### Manual setup

```bash
# system: Node.js >= 18, Python 3, Ollama
ollama pull nomic-embed-text
ollama pull llava
ollama pull llama3.2:3b

# root extension deps (yarn if yarn.lock present, else npm)
yarn install

# sidecar deps + optional Python clustering deps + database
cd sidecar
npm install
python -m pip install -r requirements.txt   # optional (clustering only)
node init-schema.js
```

## Run

```bash
# terminal 1 — sidecar server (port 3001)
cd sidecar && node server.js

# terminal 2 — extension dev build
yarn dev
```

Then load the extension in Chrome: `chrome://extensions` → **Developer mode** →
**Load unpacked** → select `build/chrome-mv3-dev`.

Browse a few pages, then open <http://localhost:3001/graph> to see the knowledge
graph. Image nodes (pink thumbnails) appear under the **Images** toggle.

## Models

| Model | Used for |
|---|---|
| `nomic-embed-text` | text + image-caption embeddings |
| `llava` | captioning page images |
| `llama3.2:3b` | memory reconstruction (`sidecar/config.json` → `llm_model`) |
