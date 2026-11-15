import { Link } from "react-router-dom";
import { fmt } from "../components";
import { useManifest } from "../db";

export default function About() {
  const m = useManifest();
  return (
    <div style={{ maxWidth: 780 }}>
      <h1>About</h1>
      <p>pitchvision is an open-source football analytics project: ratings, forecasts and season odds built entirely from
        free, public data, with every model scored out of sample. Code: <a href="https://github.com/adisgill/pitchvision">github.com/adisgill/pitchvision</a>.</p>
      <h2>What's here</h2>
      <ul>
        <li><b>Team ratings</b> from goals (Dixon-Coles), results (Elo) and the closing betting market, side by side.</li>
        <li><b>Season odds</b> from 10,000 simulations of the remaining fixtures, with the league's tiebreak rules.</li>
        <li><b>Player ratings</b>: box-score ratings for every top-league player since 2012-13, and deeper event-data ratings
          (xG, xA, VAEP, progression, defending) for the seasons covered by the free StatsBomb and Wyscout datasets.</li>
        <li><b>RAPM</b>: on-pitch impact adjusted for team-mates and opponents, honestly labelled as mostly prior.</li>
        <li><b>In-game win probability</b>, <b>xPoints</b>, <b>market-value model</b>, <b>league strength</b> and <b>referee rates</b>.</li>
      </ul>
      <h2>What doesn't work (yet)</h2>
      <ul>
        <li>Our match forecasts trail the closing betting line. See <Link to="/accuracy">Accuracy</Link>.</li>
        <li>RAPM barely improves on its box-score prior; per-referee penalty and home-bias rates are mostly noise.</li>
        <li>Event data stops in 2023: the deep ratings describe those seasons only. Transfermarkt data is frozen at
          July 2026, so player tables end with 2025-26 while results and odds keep updating.</li>
      </ul>
      <h2>Data and credits</h2>
      <ul>
        {m && Object.entries(m.attribution).map(([k, v]) => <li key={k}>{v}</li>)}
      </ul>
      <p className="small muted">StatsBomb per-event data is not redistributed here; only aggregates derived from it. Raw
        football-data.co.uk and Transfermarkt files are not re-hosted. Non-commercial project.</p>
      {m && <p className="small muted">Data version {m.version} · built {fmt.date(m.built_at)} · results through {fmt.date(m.data_through)}</p>}
    </div>
  );
}
