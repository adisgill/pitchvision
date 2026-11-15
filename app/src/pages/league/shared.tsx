// Shared league-hub helpers: the season's matches, the table computed from them, zone rules
// and a "highlight up to three teams" picker used by the line charts.
import { Row } from "../../db";
import { LEAGUES } from "../../lib/format";

export const MATCH_COLS = `match_id, competition_id, season, match_date, kickoff_utc, home_club, away_club, home_team,
  away_team, played, home_goals, away_goals, home_goals_ht, away_goals_ht, home_shots, away_shots, home_sot,
  away_sot, home_corners, away_corners, home_fouls, away_fouls, home_yellows, away_yellows, home_reds, away_reds,
  proxy_home_xg, proxy_away_xg, home_xg, away_xg, elo_home, elo_away, mkt_h, mkt_d, mkt_a, lh, la`;

export type TeamRow = {
  club_id: string; name: string; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number;
  pts: number; form: string[]; xgf: number; xga: number; ppg: number;
};

/** League table from played matches (points, goal difference, goals scored). */
export function computeTable(matches: Row[]): TeamRow[] {
  const t = new Map<string, TeamRow & { _res: { d: number; r: string }[] }>();
  const get = (id: string, name: string) => {
    if (!t.has(id)) t.set(id, { club_id: id, name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [], xgf: 0, xga: 0, ppg: 0, _res: [] });
    return t.get(id)!;
  };
  for (const m of matches) {
    if (!m.played || m.home_goals == null) continue;
    const h = get(m.home_club, m.home_team), a = get(m.away_club, m.away_team);
    const hg = m.home_goals, ag = m.away_goals;
    const d = new Date(m.kickoff_utc ?? m.match_date).getTime();
    h.p++; a.p++; h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg;
    h.xgf += m.proxy_home_xg ?? 0; h.xga += m.proxy_away_xg ?? 0; a.xgf += m.proxy_away_xg ?? 0; a.xga += m.proxy_home_xg ?? 0;
    if (hg > ag) { h.w++; a.l++; h.pts += 3; h._res.push({ d, r: "W" }); a._res.push({ d, r: "L" }); }
    else if (hg < ag) { a.w++; h.l++; a.pts += 3; h._res.push({ d, r: "L" }); a._res.push({ d, r: "W" }); }
    else { h.d++; a.d++; h.pts++; a.pts++; h._res.push({ d, r: "D" }); a._res.push({ d, r: "D" }); }
  }
  const rows = [...t.values()].map((r) => {
    r.gd = r.gf - r.ga;
    r.ppg = r.p ? r.pts / r.p : 0;
    r.form = r._res.sort((x, y) => x.d - y.d).slice(-5).map((x) => x.r);
    const { _res, ...rest } = r;
    void _res;
    return rest;
  });
  return rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
}

export type Zone = { from: number; to: number; label: string; color: string };

/** Approximate end-of-season zones per league (cup winners and coefficients shift places). */
export function zones(league: string, n: number): Zone[] {
  const top = "var(--s1)", eur = "var(--seq-300)", rel = "var(--s8)", play = "var(--s5)";
  const releg = (k: number): Zone => ({ from: n - k + 1, to: n, label: "Relegation", color: rel });
  switch (league) {
    case "GB2": return [{ from: 1, to: 2, label: "Promotion", color: top }, { from: 3, to: 6, label: "Play-offs", color: eur }, releg(3)];
    case "L1": case "FR1": return [{ from: 1, to: league === "FR1" ? 3 : 4, label: "Champions League", color: top },
      { from: league === "FR1" ? 4 : 5, to: 6, label: "Europe", color: eur }, { from: n - 2, to: n - 2, label: "Relegation play-off", color: play }, releg(2)];
    case "NL1": case "PO1": return [{ from: 1, to: 2, label: "Champions League", color: top }, { from: 3, to: 5, label: "Europe", color: eur },
      { from: n - 2, to: n - 2, label: "Relegation play-off", color: play }, releg(2)];
    default: return [{ from: 1, to: 4, label: "Champions League", color: top }, { from: 5, to: 6, label: "Europe", color: eur }, releg(3)];
  }
}
export const zoneOf = (zs: Zone[], pos: number) => zs.find((z) => pos >= z.from && pos <= z.to);

export const topLabel = (league: string) => (league === "GB2" ? "Promoted" : league === "NL1" || league === "PO1" ? "Top two" : "Top four");

/** Picker: click team chips to highlight up to three (colour slots 1-3 in pick order). */
export function HighlightPicker({ teams, picked, onChange }: {
  teams: { id: string; name: string }[]; picked: string[]; onChange: (ids: string[]) => void;
}) {
  return (
    <div className="row" style={{ gap: 6, marginBottom: 8 }} role="group" aria-label="Highlight teams (up to three)">
      {teams.map((t) => {
        const i = picked.indexOf(t.id);
        const on = i >= 0;
        return (
          <button key={t.id} className="pill" aria-pressed={on}
                  style={{ cursor: "pointer", borderColor: on ? `var(--s${i + 1})` : undefined, fontWeight: on ? 650 : 500,
                           color: on ? "var(--text)" : undefined, background: on ? "var(--surface)" : undefined }}
                  onClick={() => onChange(on ? picked.filter((x) => x !== t.id) : [...picked, t.id].slice(-3))}>
            {on && <span className="dot" style={{ background: `var(--s${i + 1})` }} />}{t.name}
          </button>
        );
      })}
    </div>
  );
}

export const leagueName = (k: string) => LEAGUES[k] ?? k;
export const shortSeason = (s: number) => `${String(s % 100).padStart(2, "0")}-${String((s + 1) % 100).padStart(2, "0")}`;
