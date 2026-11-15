import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, useQuery } from "../../db";
import { css, fmt, LEAGUES, seasonLabel } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, Legend, MatchLink, SeasonSelect, useParam, useTip } from "../../ui/kit";
import { resultLetter, teamGamesSql } from "../match/shared";

export default function Overview({ id, name }: { id: string; name: string }) {
  const games = useQuery(`select * from (${teamGamesSql(`m.home_club = ${lit(id)} or m.away_club = ${lit(id)}`)}) where club_id = ${lit(id)} order by match_date`);
  const tr = useQuery(`select * from team_ratings where club_id = ${lit(id)} order by as_of`);
  const xp = useQuery(`select * from xpoints where club_id = ${lit(id)} order by season`);
  const seasons = useMemo(() => [...new Set(games.rows.map((g) => g.season))].sort((a, b) => b - a), [games.rows]);
  const [sP, setS] = useParam("season", "");
  const season = Number(sP || seasons[0] || 2026);

  const eloRows = useMemo(() => games.rows.filter((g) => g.elo != null), [games.rows]);
  const eloPlot = useMemo(() => {
    if (eloRows.length < 5) return undefined;
    const peak = eloRows.reduce((a, r) => (r.elo > a.elo ? r : a), eloRows[0]);
    const low = eloRows.reduce((a, r) => (r.elo < a.elo ? r : a), eloRows[0]);
    return (width: number) => ({
      width, height: 260, marginLeft: 46, x: { label: null }, y: { label: "↑ Elo before the match", grid: true },
      marks: [
        Plot.line(eloRows, { x: "match_date", y: "elo", z: "season", stroke: css("--s1"), strokeWidth: 2 }),
        Plot.dot([peak, low], { x: "match_date", y: "elo", r: 4, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text([peak], { x: "match_date", y: "elo", text: (d: any) => `peak ${fmt.n(d.elo)}`, dy: -10, fill: css("--text-2"), fontSize: 10.5 }),
        Plot.text([low], { x: "match_date", y: "elo", text: (d: any) => `low ${fmt.n(d.elo)}`, dy: 12, fill: css("--text-2"), fontSize: 10.5 }),
        Plot.ruleX(eloRows, Plot.pointerX({ x: "match_date", stroke: css("--axis") })),
        Plot.tip(eloRows, Plot.pointerX({ x: "match_date", y: "elo", title: (d: any) => `${fmt.dayYear(d.match_date)}\nElo ${fmt.n(d.elo)}\n${d.side === "h" ? "v" : "at"} ${d.opp} ${d.gf}–${d.ga}` })),
      ],
    });
  }, [eloRows]);

  const strPlot = useMemo(() => {
    if (tr.rows.length < 2) return undefined;
    const long = tr.rows.flatMap((r) => [{ as_of: r.as_of, v: r.dc_gd, k: "Goals model (Dixon-Coles)" }, { as_of: r.as_of, v: r.mkt_gd, k: "Closing market" }])
      .filter((d) => d.v != null);
    return (width: number) => ({
      width, height: 260, marginLeft: 46, x: { label: null }, y: { label: "↑ Expected GD per match vs average", grid: true },
      color: { domain: ["Goals model (Dixon-Coles)", "Closing market"], range: [css("--s1"), css("--s2")] },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.line(long, { x: "as_of", y: "v", stroke: "k", strokeWidth: 2 }),
        Plot.dot(long, { x: "as_of", y: "v", fill: "k", r: 4, stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(long, Plot.pointer({ x: "as_of", y: "v", title: (d: any) => `${d.k}\n${fmt.dayYear(d.as_of)}: ${fmt.signed(d.v)} per match` })),
      ],
    });
  }, [tr.rows]);

  const xpPlot = useMemo(() => {
    if (!xp.rows.length) return undefined;
    const rows = xp.rows.map((r) => ({ ...r, ppg: r.points / r.played, xppg: r.xpoints / r.played }));
    return (width: number) => ({
      width, height: 270, marginLeft: 46, marginBottom: 40, x: { label: null, tickFormat: (d: number) => `${String(d % 100).padStart(2, "0")}/${String((d + 1) % 100).padStart(2, "0")}`, type: "point" as const, tickRotate: -40 },
      y: { label: "↑ Points per match", grid: true },
      marks: [
        Plot.link(rows, { x: "season", y1: "xppg", y2: "ppg", stroke: css("--axis"), strokeWidth: 2 }),
        Plot.dot(rows, { x: "season", y: "xppg", r: 4.5, fill: css("--surface"), stroke: css("--muted"), strokeWidth: 2 }),
        Plot.dot(rows, { x: "season", y: "ppg", r: 5, fill: (d: any) => (d.ppg >= d.xppg ? css("--pos") : css("--neg")), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(rows, Plot.pointerX({ x: "season", y: "ppg", title: (d: any) => `${seasonLabel(d.season, d.competition_id)} · ${LEAGUES[d.competition_id] ?? d.competition_id}\n${d.points} pts vs ${fmt.n(d.xpoints, 1)} expected (${fmt.signed(d.points - d.xpoints, 1)})\nfinished ${fmt.n(d.position)}, expected ${fmt.n(d.xposition, 1)}` })),
      ],
    });
  }, [xp.rows]);

  const seasonGames = games.rows.filter((g) => g.season === season);
  return (
    <div className="grid">
      <div className="c12">
        {eloPlot ? (
          <Figure title={`${name}'s Elo, match by match`} subtitle={`Rating before each league match since 2017-18 (${eloRows.length} matches). Higher = stronger; about 100 points ≈ a 64% expected score.`}
                  source="football-data.co.uk results" plot={eloPlot} alt="Elo rating over time"
                  table={{ rows: eloRows.slice(-60), cols: [["match_date", "Date", (v) => fmt.date(v)], ["opp", "Opponent"], ["elo", "Elo", (v) => fmt.n(v)]] }} />
        ) : <Card title="Elo history"><p className="muted small">No Elo history (our ratings start in 2017-18 for the leagues with odds).</p></Card>}
      </div>
      <div className="c6">
        {strPlot && (
          <Figure title="Strength by the goals model and by the market" subtitle="Expected goal difference per match against an average team in the league, at each season's end (and now)."
                  right={<Legend items={[{ label: "Goals model", color: "var(--s1)", kind: "line" }, { label: "Market", color: "var(--s2)", kind: "line" }]} />}
                  source="football-data.co.uk" plot={strPlot} alt="Team strength over time"
                  table={{ rows: tr.rows, cols: [["as_of", "As of", (v) => fmt.date(v)], ["dc_gd", "Goals model", (v) => fmt.signed(v)], ["mkt_gd", "Market", (v) => fmt.signed(v)], ["elo", "Elo", (v) => fmt.n(v)]] }} />
        )}
      </div>
      <div className="c6">
        {xpPlot && (
          <Figure title="Points against expected points, season by season" subtitle="Filled: actual points per match (blue above expectation, red below). Hollow: expected from the chances created and conceded."
                  source="football-data.co.uk, Transfermarkt" plot={xpPlot} alt="Points vs expected points by season"
                  table={{ rows: xp.rows, cols: [["season", "Season", (v) => seasonLabel(v)], ["points", "Pts"], ["xpoints", "xPts", (v) => fmt.n(v, 1)], ["position", "Pos", (v) => fmt.n(v)], ["xposition", "xPos", (v) => fmt.n(v, 1)]] }} />
        )}
      </div>
      <div className="c12">
        <Card title={`Every match of ${seasonLabel(season)}`} sub="One square per league match in date order: W / D / L. The bar under each square is the market's pre-match win chance. Hover for details, click to open."
              right={seasons.length > 0 ? <SeasonSelect value={season} onChange={(v) => setS(String(v))} seasons={seasons} /> : undefined}>
          <ResultsGrid games={seasonGames} />
        </Card>
      </div>
    </div>
  );
}

function ResultsGrid({ games }: { games: any[] }) {
  const tip = useTip();
  if (!games.length) return <p className="muted small">No matches.</p>;
  const pts = games.reduce((a, g) => a + (g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0), 0);
  const xp = games.reduce((a, g) => a + (g.p_win != null ? 3 * g.p_win + g.p_draw : 0), 0);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {games.map((g) => {
          const r = resultLetter(g.gf, g.ga);
          return (
            <MatchLink key={g.match_id} id={g.match_id}>
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, width: 30 }}
                    onPointerMove={(e) => tip.show(e, <><b>{g.gf}–{g.ga}</b> {g.side === "h" ? "v" : "at"} {g.opp}
                      <div className="muted">{fmt.dayYear(g.match_date)}{g.p_win != null ? ` · market win chance ${fmt.pct(g.p_win)}` : ""}</div></>)}
                    onPointerLeave={tip.hide}>
                <span className="form"><i className={r} style={{ width: 30, height: 30, fontSize: "0.72rem" }}>{g.side === "h" ? "H" : "A"}</i></span>
                <span className="bar" style={{ minWidth: 0, width: 30, height: 4 }}><span style={{ width: `${100 * (g.p_win ?? 0)}%` }} /></span>
              </span>
            </MatchLink>
          );
        })}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>{pts} points from {games.length} matches{xp ? `; the closing odds expected ${fmt.n(xp, 1)} (${fmt.signed(pts - xp, 1)})` : ""}. Letters: H home, A away; colour: green win, grey draw, red loss.</p>
      {tip.node}
    </>
  );
}
