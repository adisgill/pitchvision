import { Link } from "react-router-dom";
import { useManifest } from "../db";
import { fmt } from "../lib/format";
import { Card, PageHead } from "../ui/kit";

export default function About() {
  const m = useManifest();
  const total = m ? Object.values(m.rows).reduce((a, b) => a + b, 0) : null;
  return (
    <>
      <PageHead eyebrow="About & data" title="What's inside, where it comes from, and what it can't do"
        lead={<>pitchvision is open source (<a href="https://github.com/adisgill/pitchvision">github.com/adisgill/pitchvision</a>): every number here is
          rebuilt from free public data by a pipeline you can run yourself, and every model is scored out of sample.</>} />
      <div className="grid">
        <div className="c6">
          <Card title="What we measure">
            <ul className="small ink2" style={{ paddingLeft: "1.1rem", margin: 0, lineHeight: 1.7 }}>
              <li><b>Teams:</b> Dixon-Coles attack/defence, Elo and market-implied strength; xPoints; playing style; goal timing; managers.</li>
              <li><b>Forecasts:</b> weekly walk-forward match odds, 10,000-run season simulations, in-game win probability, a live match predictor.</li>
              <li><b>Players:</b> box-score ratings for every top-league season since 2012-13; event-data ratings (xG, xA, xT, VAEP, progression, defending, duels, goalkeeping) for the free event seasons; RAPM; roles and similar players; age curves; market-value model.</li>
              <li><b>The pitch:</b> 12 × 8 zone maps of what every team and player does, and concedes, everywhere on the pitch; matchup overlays.</li>
              <li><b>Research:</b> 26 hidden matchup factors tested against our model and the closing line, with replication.</li>
            </ul>
          </Card>
        </div>
        <div className="c6">
          <Card title="What we can't do (yet)">
            <ul className="small ink2" style={{ paddingLeft: "1.1rem", margin: 0, lineHeight: 1.7 }}>
              <li>Our match forecasts trail the closing betting line (<Link to="/accuracy">see Accuracy</Link>). Nothing we've tested beats it (<Link to="/factors">see Hidden factors</Link>).</li>
              <li>Free event data covers StatsBomb 2015-16 (big five), StatsBomb women's seasons and Wyscout 2017-18. Pitch maps and deep player ratings describe those seasons only.</li>
              <li>No tracking data, so no off-ball positioning, pressing intensity in metres, or physical output.</li>
              <li>Transfermarkt data is frozen at July 2026: line-ups, events, minutes and values stop there; results and odds keep updating daily.</li>
              <li>No fixture list yet, so the simulator infers the unplayed half of the season; no live in-play data.</li>
              <li>RAPM barely beats its box-score prior; per-referee penalty and home-bias rates are mostly noise. Both are labelled as such.</li>
            </ul>
          </Card>
        </div>
        <div className="c6">
          <Card title="Data and credits">
            <ul className="small ink2" style={{ paddingLeft: "1.1rem", margin: 0, lineHeight: 1.7 }}>
              {m && Object.entries(m.attribution).map(([k, v]) => <li key={k}>{v}</li>)}
            </ul>
            <p className="xs muted" style={{ marginTop: 10 }}>StatsBomb per-event data is not redistributed: only aggregates derived from it (per player-season, team-season, team-match or pitch zone).
              Raw football-data.co.uk and Transfermarkt files are not re-hosted. Non-commercial project.</p>
          </Card>
        </div>
        <div className="c6">
          <Card title="This build">
            {m && (
              <table className="data"><tbody>
                <tr><td>Data version</td><td className="r num">{m.version}</td></tr>
                <tr><td>Built</td><td className="r">{fmt.dayYear(m.built_at)}</td></tr>
                <tr><td>Results through</td><td className="r">{fmt.dayYear(m.data_through)}</td></tr>
                <tr><td>Tables</td><td className="r">{Object.keys(m.files).length}</td></tr>
                <tr><td>Rows</td><td className="r">{fmt.n(total)}</td></tr>
              </tbody></table>
            )}
            <p className="xs muted" style={{ marginTop: 10 }}>The site queries these tables in your browser with DuckDB-WASM, fetching only the parts each page needs. New data arrives daily; an open page tells you when to refresh.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
