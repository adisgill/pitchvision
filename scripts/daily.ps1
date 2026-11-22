# Daily refresh: new results and odds from football-data.co.uk, the stages they change,
# then publish the site. Run by Windows Task Scheduler (see docs/operations.md); safe to run
# by hand. Each step stops the run if it fails, so a bad day never publishes.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force "data\logs" | Out-Null
$log = Join-Path $root ("data\logs\daily-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

# Anything unexpected still leaves a FAILED line in the log instead of a silent stop.
trap {
    "[$(Get-Date -Format s)] FAILED: $_" | Out-File -Append -Encoding utf8 $log
    exit 1
}

function Step($name, [scriptblock]$cmd) {
    "[$(Get-Date -Format s)] $name" | Out-File -Append -Encoding utf8 $log
    # Windows PowerShell turns each stderr line of a redirected native command into an error
    # record, and with "Stop" the first one (the build's progress logging) ends the script.
    # Steps are judged by their exit code alone; stderr lines are logged as plain text.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $cmd *>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 $log
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) {
        "[$(Get-Date -Format s)] FAILED: $name (exit $code)" | Out-File -Append -Encoding utf8 $log
        exit $code
    }
}

Step "fetch football-data.co.uk (current season only)" { uv run pitchvision ingest footballdata --fetch }
Step "fetch FotMob (fixtures and newly finished matches)" { uv run pitchvision ingest fotmob --fetch --full }
Step "build (daily stages)" { uv run pitchvision build --daily }
Step "append forecasts to the ledger" { uv run pitchvision ledger }
Step "commit and push the ledger (append-only)" { powershell -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\commit_ledger.ps1" }
Step "export and publish" { uv run pitchvision demo --publish }
"[$(Get-Date -Format s)] done" | Out-File -Append -Encoding utf8 $log
