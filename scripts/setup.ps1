<#
.SYNOPSIS
  One-shot setup for the WebMind repository on Windows.

.DESCRIPTION
  Installs and verifies every prerequisite, then installs project dependencies:

    - Git, Node.js LTS, Python 3            (via winget)
    - Ollama + models (local mode: nomic-embed-text, llava, llama3.2:3b;
                       cloud mode: nomic-embed-text only)
    - Root extension dependencies           (yarn or npm)
    - sidecar/ Node dependencies            (npm)
    - sidecar/ Python dependencies          (pip, optional - clustering only)
    - Initializes sidecar/webmind.db

  This script does NOT deploy anything to AWS. Cloud mode only records the
  endpoint URLs + shared API key you already have into a local .env file.

.USAGE
  Right-click > Run with PowerShell, or:
      powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

  Optional flags:
      -Local         use local Ollama for everything (skip the prompt)
      -Cloud         use AWS endpoints for LLaMA + LLaVA (skip the prompt)
      -SkipModels    do not pull Ollama models (large downloads)
      -SkipPython    do not install the Python clustering dependencies
#>

[CmdletBinding()]
param(
  [switch]$SkipModels,
  [switch]$SkipPython,
  [switch]$Local,
  [switch]$Cloud
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Sidecar  = Join-Path $RepoRoot "sidecar"
$EnvFile  = Join-Path $RepoRoot ".env"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
function Info  ($m) { Write-Host "==> $m"      -ForegroundColor Cyan }
function Ok    ($m) { Write-Host "    $m"       -ForegroundColor Green }
function Warn  ($m) { Write-Host "    $m"       -ForegroundColor Yellow }
function Die   ($m) { Write-Host "!!! $m"       -ForegroundColor Red; exit 1 }

function Have ($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Set KEY=VALUE in $EnvFile. Never overwrites a key that already has a
# non-empty value (re-running setup won't clobber your secrets).
function Upsert-Env ($key, $value) {
  if (-not (Test-Path $EnvFile)) { New-Item -ItemType File -Path $EnvFile | Out-Null }
  $lines = @(Get-Content $EnvFile -ErrorAction SilentlyContinue)
  $match = $lines | Where-Object { $_ -match "^$([regex]::Escape($key))=" } | Select-Object -First 1
  if ($match) {
    $current = $match.Substring($key.Length + 1)
    if ($current.Trim().Length -gt 0) { Warn "$key already set in .env - keeping existing value"; return }
    $lines = $lines | Where-Object { $_ -notmatch "^$([regex]::Escape($key))=" }
  }
  $lines += "$key=$value"
  Set-Content -Path $EnvFile -Value $lines -Encoding utf8
  Ok "$key written to .env"
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user    = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Winget-Install ($id) {
  if (-not (Have winget)) {
    Die "winget is not available. Install 'App Installer' from the Microsoft Store, then re-run this script."
  }
  Info "Installing $id via winget"
  winget install --id $id --exact --silent --accept-source-agreements --accept-package-agreements
  Refresh-Path
}

# ---------------------------------------------------------------------------
# 0. inference mode
# ---------------------------------------------------------------------------
$Mode = ""
if ($Local) { $Mode = "local" }
elseif ($Cloud) { $Mode = "cloud" }
else {
  Write-Host ""
  Write-Host "How would you like to run AI inference?"
  Write-Host "  1) Local only  - LLaMA + LLaVA + Nomic all via local Ollama"
  Write-Host "  2) Cloud       - LLaMA + LLaVA via your AWS endpoints, Nomic stays local"
  $choice = Read-Host "Choose [1/2] (default 1)"
  if ($choice -eq "2") { $Mode = "cloud" } else { $Mode = "local" }
}
Info "Inference mode: $Mode"

if ($Mode -eq "cloud") {
  $OllamaModels = @("nomic-embed-text")
  Info "Configuring AWS endpoints in $EnvFile (nothing is deployed to AWS)"
  if (-not (Test-Path $EnvFile)) {
    $example = Join-Path $RepoRoot ".env.example"
    if (Test-Path $example) { Copy-Item $example $EnvFile }
  }
  $vKey   = Read-Host "  AWS_API_KEY (shared, blank = keep current)"
  $vLlama = Read-Host "  LLAMA_API_URL"
  $vLlava = Read-Host "  LLAVA_API_URL"
  if ($vKey)   { Upsert-Env "AWS_API_KEY"   $vKey }
  if ($vLlama) { Upsert-Env "LLAMA_API_URL" $vLlama }
  if ($vLlava) { Upsert-Env "LLAVA_API_URL" $vLlava }
  Warn "Enable the 'Cloud LLaMA' / 'Cloud LLaVA' switches in the extension settings to use them."
} else {
  $OllamaModels = @("nomic-embed-text", "llava", "llama3.2:3b")
}

# ---------------------------------------------------------------------------
# 1. system tools
# ---------------------------------------------------------------------------
Info "Checking system tools"

if (Have git)  { Ok ("git    " + (git --version)) }      else { Winget-Install "Git.Git" }
if (Have node) { Ok ("node   " + (node --version)) }     else { Winget-Install "OpenJS.NodeJS.LTS" }
if (Have npm)  { Ok ("npm    " + (npm --version)) }      else { Die "npm missing after Node install - reopen PowerShell and re-run." }

if (Have python) {
  Ok ("python " + (python --version 2>&1))
} else {
  Winget-Install "Python.Python.3.12"
  if (-not (Have python)) { Warn "python still not on PATH - reopen PowerShell if the Python steps fail." }
}

if (Have ollama) { Ok ("ollama " + (ollama --version 2>&1 | Select-Object -First 1)) }
else             { Winget-Install "Ollama.Ollama" }

# node version guard (need >= 18 for global fetch)
try {
  $nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
  if ($nodeMajor -lt 18) { Die "Node.js $nodeMajor detected; WebMind needs Node 18 or newer (20 LTS recommended)." }
} catch { Warn "Could not parse Node version - continuing." }

# ---------------------------------------------------------------------------
# 2. ollama service + models
# ---------------------------------------------------------------------------
Info "Ensuring the Ollama service is running"
$ollamaUp = $false
try { ollama list *> $null; $ollamaUp = $true } catch { $ollamaUp = $false }

if (-not $ollamaUp) {
  Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
  for ($i = 0; $i -lt 20 -and -not $ollamaUp; $i++) {
    Start-Sleep -Seconds 1
    try { ollama list *> $null; $ollamaUp = $true } catch { }
  }
}
if ($ollamaUp) { Ok "Ollama is responding" } else { Warn "Ollama service did not come up - start it manually with 'ollama serve'." }

if ($SkipModels) {
  Warn "-SkipModels set: not pulling $($OllamaModels -join ', ')"
} elseif ($ollamaUp) {
  $installed = (ollama list) 2>$null
  foreach ($m in $OllamaModels) {
    if ($installed -match [regex]::Escape($m)) {
      Ok "model present: $m"
    } else {
      Info "Pulling model: $m  (this can be several GB)"
      ollama pull $m
    }
  }
}

# ---------------------------------------------------------------------------
# 3. JavaScript dependencies
# ---------------------------------------------------------------------------
Info "Installing root extension dependencies"
Push-Location $RepoRoot
if (Have yarn) {
  yarn install --frozen-lockfile
} elseif (Test-Path (Join-Path $RepoRoot "yarn.lock")) {
  Info "yarn.lock present but yarn missing - enabling via corepack"
  try { corepack enable; yarn install --frozen-lockfile }
  catch { Warn "corepack/yarn unavailable - falling back to npm install"; npm install }
} else {
  npm install
}
Pop-Location
Ok "root dependencies installed"

Info "Installing sidecar dependencies"
Push-Location $Sidecar
if (Test-Path (Join-Path $Sidecar "package-lock.json")) { npm ci } else { npm install }
Pop-Location
Ok "sidecar dependencies installed"

# ---------------------------------------------------------------------------
# 4. Python dependencies (optional - HDBSCAN clustering only)
# ---------------------------------------------------------------------------
if ($SkipPython) {
  Warn "-SkipPython set: skipping clustering dependencies"
} elseif (Have python) {
  Info "Installing Python clustering dependencies"
  try {
    python -m pip install --upgrade pip
    python -m pip install -r (Join-Path $Sidecar "requirements.txt")
    Ok "Python dependencies installed"
  } catch {
    Warn "Python dependency install failed. Clustering will be unavailable; the rest of WebMind still runs."
    Warn "Retry manually:  python -m pip install -r sidecar\requirements.txt"
  }
} else {
  Warn "python not found - skipping clustering dependencies."
}

# ---------------------------------------------------------------------------
# 5. database
# ---------------------------------------------------------------------------
Info "Initializing sidecar database (sidecar/webmind.db)"
Push-Location $Sidecar
node init-schema.js
Pop-Location
Ok "database ready"

# ---------------------------------------------------------------------------
# done
# ---------------------------------------------------------------------------
Write-Host ""
Info "Setup complete. Next steps:"
Write-Host @"
    1. Start the sidecar server:
         cd sidecar
         node server.js

    2. In a second terminal, build the extension:
         yarn dev            (or: npm run dev)

    3. Load it in Chrome:
         chrome://extensions  ->  Developer mode  ->  Load unpacked
         select:  $RepoRoot\build\chrome-mv3-dev

    4. Browse an image-heavy page, then open  http://localhost:3001/graph
"@ -ForegroundColor Gray
