# Commit and push the day's new ledger rows. Refuses anything that isn't a pure append:
# if a single existing line was removed or changed, nothing is committed and the run fails.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$file = "ledger/predictions.csv"

git add -- $file
$stat = git diff --cached --numstat -- $file
if (-not $stat) {
    "ledger: nothing new to commit"
    exit 0
}
$parts = $stat -split "\s+"
$added = [int]$parts[0]
$removed = [int]$parts[1]
if ($removed -ne 0) {
    git reset -q -- $file
    "ledger: refusing to commit, $removed existing line(s) removed or changed"
    exit 1
}
git commit -q -m "Ledger: $added forecasts logged $(Get-Date -Format yyyy-MM-dd)" -- $file
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git push -q origin HEAD
if ($LASTEXITCODE -ne 0) {
    # someone else pushed first: replay our commit on top and try once more
    git pull -q --rebase --autostash origin HEAD
    git push -q origin HEAD
}
"ledger: committed $added new forecasts"
exit $LASTEXITCODE
