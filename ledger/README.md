# Forecast ledger

`predictions.csv` is pitchvision's public, append-only record of match forecasts. Every
morning, before kickoff, the daily job appends one row per upcoming fixture, then commits
and pushes. A row is never edited or deleted, and the commit step refuses any change that
isn't a pure append. So git history proves when each forecast was made.

Columns:
- `logged_at`: when the forecast was made (UTC).
- `fm_match_id`: the FotMob match id.
- `competition_id`.
- `kickoff_utc`.
- `home_club` and `away_club`: pitchvision club ids.
- `home_name` and `away_name`.
- `p_home`, `p_draw`, `p_away`: home win, draw and away win probabilities.
- `lh` and `la`: expected goals for each side.
- `model`: the model version.

A fixture can collect several rows, one per day until kickoff. The scorecard on the site's
Accuracy page grades each match on its last row logged before kickoff.
