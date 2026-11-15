import * as Plot from "@observablehq/plot";
import { useEffect, useMemo, useState } from "react";
import { lit, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Field, Legend, Loading, Seg } from "../../ui/kit";
import { computeTable, HighlightPicker, MATCH_COLS } from "./shared";

type Pt = { club: string; name: string; n: number; pts: number; gd: number; gf: number; pos?: number; res: string; opp: string; score: string };

/** Each team's running totals after its n-th match. */
function series(matches: any[]): Pt[] {
  const ms = matches.filter((m) => m.played && m.home_goals != null)
    .sort((a, b) => new Date(a.kickoff_utc ?? a.match_date).getTime() - new Date(b.kickoff_utc ?? b.match_date).getTime());
  const acc = new Map<string, { n: number; pts: number; gd: number; gf: number }>();
  const out: Pt[] = [];
  for (const m of ms) {
    for (const side of ["h", "a"] as const) {
      const club = side === "h" ? m.home_club : m.away_club, name = side === "h" ? m.home_team : m.away_team;
      const gf = side === "h" ? m.home_goals : m.away_goals, ga = side === "h" ? m.away_goals : m.home_goals;
      const a = acc.get(club) ?? { n: 0, pts: 0, gd: 0, gf: 0 };
      a.n++; a.gd += gf - ga; a.gf += gf; a.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
      acc.set(club, a);
      out.push({ club, name, n: a.n, pts: a.pts, gd: a.gd, gf: a.gf, res: gf > ga ? "W" : gf === ga ? "D" : "L",
                 opp: side === "h" ? m.away_team : m.home_team, score: `${gf}–${ga}${side === "h" ? " (H)" : " (A)"}` });
    }
  }
  // position after round n: rank everyone's totals at their n-th match (or latest before it)
  const maxN = Math.max(0, ...out.map((p) => p.n));
  const byClub = new Map<string, Pt[]>();
  out.forEach((p) => { if (!byClub.has(p.club)) byClub.set(p.club, []); byClub.get(p.club)!.push(p); });
  for (let n = 1; n <= maxN; n++) {
    const snap = [...byClub.values()].map((ps) => ps[Math.min(n, ps.length) - 1]).filter(Boolean);
    snap.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    snap.forEach((p, i) => { if (p.n === n) p.pos = i + 1; });
  }
  return out;
}

export default function RaceTab({ league, season }: { league: string; season: number }) {
  const ms = useQuery(`select ${MATCH_COLS} from matches where competition_id = ${lit(league)} and season = ${season}`);
  const pts = useMemo(() => series(ms.rows), [ms.rows]);
  const table = useMemo(() => computeTable(ms.rows), [ms.rows]);
  const maxN = Math.max(0, ...pts.map((p) => p.n));
  const [mode, setMode] = useState<"points" | "position" | "gap">("points");
  const [upTo, setUpTo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { setPicked(table.slice(0, 3).map((t) => t.club_id)); setUpTo(0); setPlaying(false); }, [league, season, table.length]);
  const n = upTo || maxN;
  useEffect(() => {
    if (!playing) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setUpTo(maxN); setPlaying(false); return; }
    const id = window.setInterval(() => setUpTo((u) => { const nx = (u || 0) + 1; if (nx >= maxN) { setPlaying(false); return maxN; } return nx; }), 450);
    return () => window.clearInterval(id);
  }, [playing, maxN]);

  const plot = useMemo(() => {
    if (!pts.length) return undefined;
    const vis = pts.filter((p) => p.n <= n);
    // gap to the leader's points after round n (leader = most points at that round)
    const leaderAt = new Map<number, number>();
    vis.forEach((p) => leaderAt.set(p.n, Math.max(leaderAt.get(p.n) ?? -1, p.pts)));
    const data = vis.map((p) => ({ ...p, gap: p.pts - (leaderAt.get(p.n) ?? p.pts) }));
    const y = mode === "points" ? "pts" : mode === "position" ? "pos" : "gap";
    const hl = new Map(picked.map((id, i) => [id, css(`--s${i + 1}`)]));
    const grey = data.filter((p) => !hl.has(p.club)), color = data.filter((p) => hl.has(p.club));
    const ends = [...new Map(data.map((p) => [p.club, p])).values()].filter((p) => hl.has(p.club));
    const nTeams = table.length;
    return (width: number) => ({
      width, height: mode === "position" ? Math.max(380, nTeams * 22) : 440, marginRight: 110, marginLeft: 44,
      x: { label: "Matches played →", domain: [1, Math.max(2, maxN)] },
      y: mode === "position" ? { label: "↑ Position", reverse: true, domain: [1, nTeams], ticks: Array.from({ length: nTeams }, (_, i) => i + 1) }
        : mode === "gap" ? { label: "↑ Points behind the leader", grid: true } : { label: "↑ Points", grid: true },
      marks: [
        Plot.line(grey, { x: "n", y, z: "club", stroke: css("--axis"), strokeWidth: 1.25, curve: mode === "position" ? "bump-x" : "linear" }),
        Plot.line(color, { x: "n", y, z: "club", stroke: (d: any) => hl.get(d.club), strokeWidth: 2.5, curve: mode === "position" ? "bump-x" : "linear" }),
        Plot.dot(ends, { x: "n", y, fill: (d: any) => hl.get(d.club), r: 4, stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(ends, { x: "n", y, text: (d: any) => `${d.name} ${mode === "position" ? d.pos ?? "" : mode === "gap" ? fmt.signed(d.gap, 0) : d.pts}`,
                          dx: 8, textAnchor: "start", fill: css("--text"), fontSize: 11, fontWeight: 600 }),
        Plot.tip(data, Plot.pointer({ x: "n", y, title: (d: any) => `${d.name} after ${d.n} matches\n${d.pts} pts · ${d.pos ? `${d.pos}${ord(d.pos)}` : ""} · GD ${fmt.signed(d.gd, 0)}\nlatest: ${d.res} ${d.score} vs ${d.opp}` })),
      ],
    });
  }, [pts, n, mode, picked, table.length, maxN]);

  return (
    <>
      <Loading state={ms} />
      <div className="filters">
        <Field label="Show"><Seg value={mode} onChange={setMode} options={[["points", "Points"], ["position", "Position (bump)"], ["gap", "Gap to leader"]]} label="Measure" /></Field>
        <Field label={`After match ${n} of ${maxN}`}>
          <div className="row" style={{ gap: 8, minWidth: 260 }}>
            <button className="btn" onClick={() => { if (n >= maxN) setUpTo(1); setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play the season"}>
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <input type="range" min={1} max={Math.max(1, maxN)} value={n} aria-label="Matches played"
                   onChange={(e) => { setPlaying(false); setUpTo(Number(e.target.value)); }} style={{ flex: 1 }} />
          </div>
        </Field>
      </div>
      <HighlightPicker teams={table.map((t) => ({ id: t.club_id, name: t.name }))} picked={picked} onChange={setPicked} />
      {plot && (
        <Figure title={mode === "position" ? "League position, match by match" : mode === "gap" ? "How far behind the leader every team has been" : "The points race"}
                subtitle={<>Highlighted teams in colour (pick up to three above); everyone else in grey. Hover any line for the team, points and that match's result.
                  {mode === "position" && " Positions are after each team's n-th match, so rounds with postponed games are approximate."}</>}
                source="football-data.co.uk results" plot={plot} alt="Line chart of points by matches played"
                right={<Legend items={picked.map((id, i) => ({ label: table.find((t) => t.club_id === id)?.name ?? id, color: `var(--s${i + 1})`, kind: "line" }))} />}
                table={{ rows: table, cols: [["name", "Team"], ["p", "Played"], ["pts", "Points"], ["gd", "GD"]] }} />
      )}
    </>
  );
}

const ord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
