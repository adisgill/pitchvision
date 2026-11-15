# Daily refresh: new results and odds from football-data.co.uk, the stages they change,
# then publish the site. Run by Windows Task Scheduler (see docs/operations.md); safe to run
# by hand. Each step stops the run if it fails, so a bad day never publishes.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force "data\logs" | Out-Null
$log = Join-Path $root ("data\logs\daily-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

function Step($name, [scriptblock]$cmd) {
    "[$(Get-Date -Format s)] $name" | Out-File -Append -Encoding utf8 $log
    & $cmd *>&1 | Out-File -Append -Encoding utf8 $log
    if ($LASTEXITCODE -ne 0) {
        "[$(Get-Date -Format s)] FAILED: $name (exit $LASTEXITCODE)" | Out-File -Append -Encoding utf8 $log
        exit $LASTEXITCODE
    }
}

Step "fetch football-data.co.uk (current season only)" { uv run pitchvision ingest footballdata --fetch }
Step "fetch FotMob (fixtures and newly finished matches)" { uv run pitchvision ingest fotmob --fetch --full }
Step "build (daily stages)" { uv run pitchvision build --daily }
Step "export and publish" { uv run pitchvision demo --publish }
"[$(Get-Date -Format s)] done" | Out-File -Append -Encoding utf8 $log
