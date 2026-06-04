# Windows startup: Chroma (Docker), Ollama, embedding model, then MCP server.
# On macOS/Linux use start.sh instead.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ChromaHost = if ($env:CHROMA_HOST) { $env:CHROMA_HOST } else { "localhost" }
$ChromaPort = if ($env:CHROMA_PORT) { [int]$env:CHROMA_PORT } else { 8000 }
$OllamaHost = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { "localhost" }
$OllamaPort = if ($env:OLLAMA_PORT) { [int]$env:OLLAMA_PORT } else { 11434 }
$EmbedModel = if ($env:OLLAMA_EMBED_MODEL) { $env:OLLAMA_EMBED_MODEL } else { "nomic-embed-text" }
$ChromaContainer = if ($env:CHROMA_CONTAINER) { $env:CHROMA_CONTAINER } else { "chroma" }
$WaitSeconds = if ($env:WAIT_SECONDS) { [int]$env:WAIT_SECONDS } else { 90 }

if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

function Write-Log {
    param([string]$Level, [string]$Message)
    $levelNum = switch ($Level) {
        "debug" { 20 }
        "warn"  { 40 }
        "error" { 50 }
        default { 30 }
    }
    $entry = [ordered]@{
        level    = $levelNum
        time     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        pid      = $PID
        hostname = $env:COMPUTERNAME
        name     = "github-pr-agent-startup"
        msg      = $Message
    } | ConvertTo-Json -Compress
    [Console]::Error.WriteLine($entry)
}

function Test-TcpPort {
    param([string]$HostName, [int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(2000, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-HttpReady {
    param([string[]]$Urls, [string]$Label)
    for ($i = 1; $i -le $WaitSeconds; $i++) {
        foreach ($url in $Urls) {
            try {
                Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
                Write-Log "info" "$Label is ready ($url)"
                return
            }
            catch {
                # try next URL
            }
        }
        Start-Sleep -Seconds 1
    }
    Write-Log "error" "$Label did not become ready within ${WaitSeconds}s"
    exit 1
}

# --- ChromaDB ---
Write-Log "info" "Checking ChromaDB on ${ChromaHost}:${ChromaPort}"

if (Test-TcpPort $ChromaHost $ChromaPort) {
    Write-Log "info" "ChromaDB already reachable, skipping Docker start"
}
else {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Log "error" "docker not found; install Docker Desktop or start Chroma manually"
        exit 1
    }

    $running = docker ps --format "{{.Names}}" 2>$null | Where-Object { $_ -eq $ChromaContainer }
    if ($running) {
        Write-Log "info" "Chroma container already running"
    }
    else {
        $exists = docker ps -a --format "{{.Names}}" 2>$null | Where-Object { $_ -eq $ChromaContainer }
        if ($exists) {
            Write-Log "info" "Starting existing Chroma container"
            docker start $ChromaContainer | Out-Null
        }
        else {
            Write-Log "info" "Creating Chroma container ($ChromaContainer)"
            docker run -d --name $ChromaContainer -p "${ChromaPort}:8000" chromadb/chroma | Out-Null
        }
    }

    $chromaBase = "http://${ChromaHost}:${ChromaPort}"
    Wait-HttpReady @(
        "$chromaBase/api/v2/heartbeat",
        "$chromaBase/api/v1/heartbeat",
        "$chromaBase/"
    ) "ChromaDB"
}

# --- Ollama ---
Write-Log "info" "Checking Ollama on ${OllamaHost}:${OllamaPort}"

if (Test-TcpPort $OllamaHost $OllamaPort) {
    Write-Log "info" "Ollama already reachable (desktop app or existing serve)"
}
else {
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Log "error" "ollama not found; install from https://ollama.com and open the Ollama app"
        exit 1
    }
    Write-Log "info" "Starting ollama serve"
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Wait-HttpReady @("http://${OllamaHost}:${OllamaPort}/") "Ollama"
}

# --- Embedding model ---
Write-Log "info" "Checking Ollama model $EmbedModel"

$listOutput = ollama list 2>$null
$hasModel = $false
if ($listOutput) {
    $hasModel = $listOutput | Select-Object -Skip 1 | ForEach-Object {
        ($_ -split '\s+', 2)[0]
    } | Where-Object { $_ -eq $EmbedModel } | Select-Object -First 1
}

if ($hasModel) {
    Write-Log "info" "Model $EmbedModel already present"
}
else {
    Write-Log "info" "Pulling $EmbedModel"
    ollama pull $EmbedModel
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Log "info" "Model $EmbedModel pull complete"
}

# --- MCP server ---
Write-Log "info" "Starting MCP server"
& npx tsx src/index.ts
exit $LASTEXITCODE
