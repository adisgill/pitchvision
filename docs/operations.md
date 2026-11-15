# Operations

## Daily refresh

`scripts/daily.ps1` runs three steps, stopping at the first failure so a bad day never
publishes:

1. `uv run pitchvision ingest footballdata --fetch`: downloads the current season's
   results and odds from football-data.co.uk. Past seasons stay cached.
2. `uv run pitchvision build --daily`: re-runs only the stages new results change.
3. `uv run pitchvision demo --publish`: exports the app data, builds the site and pushes it
   to the `gh-pages` branch.

Each run appends to `data/logs/daily-YYYY-MM-DD.log` (gitignored).

### Schedule it (Windows Task Scheduler)

Run once, from the project folder, in PowerShell:

```powershell
schtasks /Create /TN "pitchvision daily" /SC DAILY /ST 09:00 /F /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PWD\scripts\daily.ps1`""
```

football-data.co.uk usually posts the weekend's results by Monday morning UK time, and
midweek results the next morning, so a morning run catches both.

Check and remove it:

```powershell
schtasks /Query /TN "pitchvision daily"
schtasks /Run /TN "pitchvision daily"      # run now
schtasks /Delete /TN "pitchvision daily" /F
```

The task runs as your user, so it uses your git credentials for the push. The computer
must be on (or wake) at the scheduled time; Task Scheduler's "run as soon as possible after
a missed start" setting covers mornings when it was asleep.

## Full rebuild

`uv run pitchvision build` rebuilds every table from the raw caches, offline. It is needed
after code changes to the event-data models, ratings or research modules, which the daily
mode skips.
