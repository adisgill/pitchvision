import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt, seasonLabel } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, DataTable, FormStrip, MatchLink, SeasonSelect, Tile, useParam } from "../../ui/kit";
import { pts, resultLetter, teamGamesSql } from "../match/shared";

const BINS = ["1–15", "16–30", "31–45", "46–60", "61–75", "76–90"];

export default function Results({ id, name }: { id: string; name: string }) {
  const seasonsQ = useQuery(`select distinct season from matches where played and (home_club = ${lit(id)} or away_club = ${lit(id)}) order by season desc`);
  const seasons = seasonsQ.rows.map((r) => r.season as number);
  const [sP, setS] = useParam("rs", "");
  const season = Number(sP || seasons[0] || 2026);
  const games = useQuery(`select * from (${teamGamesSql(`(m.home_club = ${lit(id)} or m.away_club = ${lit(id)}) and m.season = ${season}`)})
                          where club_id = ${lit(id)} order by match_date`);
  const goals = useQuery(`select e.match_id, e.minute, e.club_id from match_events e join matches m using (match_id)
    where e.type = 'goals' and m.season = ${season} and (m.home_club = ${lit(id)} or m.away_club = ${lit(id)})`);

  const g = games.rows;
  const split = useMemo(() => (["h", "a", "all"] as const).map((s) => {
    const r = g.filter((x) => s === "all" || x.side === s);
    const w = r.filter((x) => x.gf > x.ga).length, d = r.filter((x) => x.gf === x.ga).length;
    const p = r.reduce((a, x) => a + pts(x.gf, x.ga), 0);
    const xp = r.reduce((a, x) => a + (x.p_win != null ? 3 * x.p_win + x.p_draw : 0), 0);
    return { where: s === "h" ? "Home" : s === "a" ? "Away" : "Total", p: r.length, w, d, l: r.length - w - d,
             gf: r.reduce((a, x) => a + x.gf, 0), ga: r.reduce((a, x) => a + x.ga, 0), pts: p, ppg: r.length ? p / r.length : null,
             vs: r.every((x) => x.p_win != null) && r.length ? p - xp : null };
  }), [g]);

  const timing = useMemo(() => {
    const out = BINS.map((b) => ({ bin: b, For: 0, Against: 0 }));
    goals.rows.forEach((e: Row) => {
      const i = Math.min(5, Math.floor((Math.max(1, e.minute) - 1) / 15));
      if (e.club_id === id) out[i].For++; else out[i].Against++;
    });
    return out;
  }, [goals.rows, id]);

  const htft = useMemo(() => {
    const k = ["W", "D", "L"];
    const m = Object.fromEntries(k.map((h) => [h, Object.fromEntries(k.map((f) => [f, 0]))])) as Record<string, Record<string, number>>;
    let n = 0;
    g.forEach((x) => { if (x.gf_ht == null) return; m[resultLetter(x.gf_ht, x.ga_ht)][resultLetter(x.gf, x.ga)]++; n++; });
    return { m, n };
  }, [g]);

  const groupedPlot = useMemo(() => {
    if (!goals.rows.length) return undefined;
    const long = timing.flatMap((t) => [{ bin: t.bin, k: "Scored", v: t.For }, { bin: t.bin, k: "Conceded", v: t.Against }]);
    return (width: number) => ({
      width, height: 250, marginLeft: 36, marginBottom: 36,
      fx: { domain: BINS, label: "Minutes", padding: 0.12 }, x: { domain: ["Scored", "Conceded"], axis: null, padding: 0.1 },
      y: { label: "↑ Goals", grid: true },
      color: { domain: ["Scored", "Conceded"], range: [css("--s1"), css("--s2")], legend: true },
      marks: [
        Plot.barY(long, { fx: "bin", x: "k", y: "v", fill: "k", rx: 3 }),
        Plot.tip(long, Plot.pointer({ fx: "bin", x: "k", y: "v", title: (d: any) => `${d.k} ${d.v} in minutes ${d.bin}` })),
      ],
    });
  }, [timing, goals.rows.length]);

  const comeback = g.filter((x) => x.gf_ht != null && x.gf_ht < x.ga_ht);
  const blown = g.filter((x) => x.gf_ht != null && x.gf_ht > x.ga_ht);
  const cbPts = comeback.reduce((a, x) => a + pts(x.gf, x.ga), 0);
  const blownPts = blown.reduce((a, x) => a + (3 - pts(x.gf, x.ga)), 0);
  const late = timing[5];
  return (
    <div className="grid">
      <div className="c12 row between">
        <div className="tiles" style={{ flex: 1 }}>
          <Tile label="Record" value={`${split[2].w}-${split[2].d}-${split[2].l}`} delta={`${split[2].pts} pts${split[2].vs != null ? `, ${fmt.signed(split[2].vs, 1)} vs odds` : ""}`} tone={split[2].vs != null ? (split[2].vs >= 0 ? "up" : "down") : undefined} />
          <Tile label="Points won from losing at half-time" value={cbPts} delta={`${comeback.length} matches trailing at HT`} />
          <Tile label="Points dropped from leading at half-time" value={blownPts} delta={`${blown.length} matches leading at HT`} tone={blownPts > 0 ? "down" : undefined} />
          <Tile label="Goals in the last 15 minutes" value={`${late.For}–${late.Against}`} delta="scored – conceded" />
        </div>
      </div>
      <div className="c12"><div className="filters" style={{ margin: 0 }}>{seasons.length > 0 && <SeasonSelect value={season} onChange={(v) => setS(String(v))} seasons={seasons} />}</div></div>
      <div className="c7">
        <Card title={`${name} in ${seasonLabel(season)}`} sub="League matches. Market: the closing odds' win chance before kickoff.">
          <DataTable rows={g} maxHeight={620} cols={[
            { key: "match_date", label: "Date", fmt: (v) => fmt.day(v) },
            { key: "side", label: "", fmt: (v) => <span className="muted">{v === "h" ? "H" : "A"}</span> },
            { key: "opp", label: "Opponent", fmt: (v, r) => <ClubLink id={r.opp_id} name={v} /> },
            { key: "gf", label: "Score", center: true, fmt: (_v, r) => <MatchLink id={r.match_id}><b className="num">{r.gf}–{r.ga}</b></MatchLink> },
            { key: "res", label: "", sortable: false, fmt: (_v, r) => <FormStrip results={[resultLetter(r.gf, r.ga)]} /> },
            { key: "gf_ht", label: "HT", center: true, fmt: (v, r) => v == null ? "–" : <span className="muted num">{v}–{r.ga_ht}</span> },
            { key: "xgf", label: "xG", num: true, fmt: (v, r) => v == null ? "–" : `${fmt.n(v, 1)}–${fmt.n(r.xga, 1)}` },
            { key: "p_win", label: "Market win %", num: true, fmt: (v) => fmt.pct(v) },
          ]} />
        </Card>
      </div>
      <div className="c5 stack" style={{ gap: 16 }}>
        {groupedPlot && (
          <Figure title={late.For - late.Against > 0 ? `${name} win the last quarter-hour (${late.For}–${late.Against})` : "When the goals come"}
                  subtitle="League goals by 15-minute window (added time folded into the 45th and 90th minutes)." source="Transfermarkt events" plot={groupedPlot}
                  alt="Goals scored and conceded by 15-minute window"
                  table={{ rows: timing, cols: [["bin", "Minutes"], ["For", "Scored"], ["Against", "Conceded"]] }} />
        )}
        <Card title="Home and away">
          <table className="data">
            <thead><tr><th></th><th className="r">P</th><th className="r">W</th><th className="r">D</th><th className="r">L</th><th className="r">GF</th><th className="r">GA</th><th className="r">Pts</th><th className="r">PPG</th><th className="r">vs odds</th></tr></thead>
            <tbody>{split.map((s) => (
              <tr key={s.where}><td>{s.where}</td><td className="r">{s.p}</td><td className="r">{s.w}</td><td className="r">{s.d}</td><td className="r">{s.l}</td>
                <td className="r">{s.gf}</td><td className="r">{s.ga}</td><td className="r"><b>{s.pts}</b></td><td className="r">{fmt.n(s.ppg, 2)}</td>
                <td className="r">{s.vs == null ? "–" : <span style={{ color: s.vs >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(s.vs, 1)}</span>}</td></tr>))}
            </tbody>
          </table>
        </Card>
        {htft.n > 0 && (
          <Card title="Half-time / full-time" sub={`Rows: state at half-time. Columns: final result. ${htft.n} matches.`}>
            <table className="data">
              <thead><tr><th>HT \ FT</th><th className="r">Won</th><th className="r">Drew</th><th className="r">Lost</th></tr></thead>
              <tbody>{(["W", "D", "L"] as const).map((h) => (
                <tr key={h}><td>{h === "W" ? "Leading" : h === "D" ? "Level" : "Trailing"}</td>
                  {(["W", "D", "L"] as const).map((f) => {
                    const v = htft.m[h][f];
                    const tot = htft.m[h].W + htft.m[h].D + htft.m[h].L;
                    return <td key={f} className="r"><span className="heatcell" style={{ background: `color-mix(in srgb, var(--accent) ${tot ? Math.round((v / tot) * 45) : 0}%, transparent)` }}>{v}</span></td>;
                  })}</tr>))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
