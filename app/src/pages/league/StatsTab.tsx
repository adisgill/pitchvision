import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { lit, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, ClubLink, Col, DataTable, Empty, Field, Loading, Seg, Select } from "../../ui/kit";

type View = "attack" | "discipline" | "state" | "timing";
const BINS = ["1–15", "16–30", "31–45+", "46–60", "61–75", "76–90+"];

export default function StatsTab({ league, season }: { league: string; season: number }) {
  const [view, setView] = useState<View>("attack");
  const where = `competition_id = ${lit(league)} and season = ${season} and played`;
  const st = useQuery(`
    with t as (
      select home_club as club, home_team as tname, match_date, home_goals gf, away_goals ga, home_goals_ht hf, away_goals_ht ha,
             home_shots sf, away_shots sa, home_sot tf, away_sot ta, home_corners cf, away_corners ca, home_fouls fo,
             away_fouls foa, home_yellows y, home_reds r, proxy_home_xg xf, proxy_away_xg xa
      from matches where ${where}
      union all
      select away_club, away_team, match_date, away_goals, home_goals, away_goals_ht, home_goals_ht, away_shots, home_shots,
             away_sot, home_sot, away_corners, home_corners, away_fouls, home_fouls, away_yellows, away_reds, proxy_away_xg, proxy_home_xg
      from matches where ${where}),
    p as (select *, case when gf > ga then 3 when gf = ga then 1 else 0 end pts from t)
    select club, arg_max(tname, match_date) as name, count(*) as p, sum(pts)::int pts,
           avg(sf) sf, avg(sa) sa, avg(tf) tf, avg(ta) ta, sum(tf) / nullif(sum(sf), 0) sot_pct, sum(gf) / nullif(sum(tf), 0) conv,
           sum(ga) / nullif(sum(ta), 0) conv_against, avg(xf) xf, avg(xa) xa, avg(gf) gf, avg(ga) ga,
           sum(gf) - sum(xf) as finishing, sum(xa) - sum(ga) as keeping,
           avg(cf) cf, avg(ca) ca, avg(fo) fo, avg(foa) foa, avg(y) y, sum(r)::int r,
           sum((ga = 0)::int)::int cs, sum((gf = 0)::int)::int fts,
           sum(hf) h1f, sum(ha) h1a, sum(gf - hf) h2f, sum(ga - ha) h2a,
           sum((hf > ha)::int)::int as ahead, sum(case when hf > ha then pts end)::int as pts_ahead,
           sum((hf = ha)::int)::int as drawn_ht, sum(case when hf = ha then pts end)::int as pts_drawn_ht,
           sum((hf < ha)::int)::int as behind, sum(case when hf < ha then pts end)::int as pts_behind,
           sum((hf < ha and gf > ga)::int)::int as comebacks, sum((hf > ha and gf < ga)::int)::int as collapses
    from p group by club`);
  const timing = useQuery(view === "timing" ? `
    with g as (
      select e.club_id, case when e.club_id = m.home_club then m.away_club else m.home_club end opp,
             e.minute as mnt
      from match_events e join matches m using (match_id)
      where e.type = 'goals' and m.${where.replace(/ and /g, " and m.")})
    select club, bin, sum(f)::int f, sum(a)::int a from (
      select club_id club, least(5, (greatest(mnt, 1) - 1) // 15) bin, 1 f, 0 a from g
      union all select opp, least(5, (greatest(mnt, 1) - 1) // 15), 0, 1 from g) group by all` : null);
  const names = useMemo(() => new Map(st.rows.map((r) => [r.club, r.name])), [st.rows]);
  const tRows = useMemo(() => {
    const by = new Map<string, any>();
    timing.rows.forEach((r) => {
      const o = by.get(r.club) ?? { club: r.club, name: names.get(r.club) ?? r.club, f: 0, a: 0 };
      o[`f${r.bin}`] = r.f; o[`a${r.bin}`] = r.a; o.f += r.f; o.a += r.a;
      by.set(r.club, o);
    });
    return [...by.values()].map((o) => ({ ...o, late: (o.f5 ?? 0) - (o.a5 ?? 0) }));
  }, [timing.rows, names]);
  const [team, setTeam] = useState("");

  const team0 = team || [...tRows].sort((a, b) => b.f - a.f)[0]?.club || "";
  const timePlot = useMemo(() => {
    const t = tRows.find((r) => r.club === team0);
    if (!t) return undefined;
    const d = BINS.flatMap((b, i) => [{ bin: b, side: "Scored", v: t[`f${i}`] ?? 0 }, { bin: b, side: "Conceded", v: -(t[`a${i}`] ?? 0) }]);
    return (width: number) => ({
      width, height: 260, x: { label: null, domain: BINS }, y: { label: "↑ scored · conceded ↓", grid: true, tickFormat: (v: number) => String(Math.abs(v)) },
      marks: [
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.barY(d, { x: "bin", y: "v", fill: (r: any) => (r.side === "Scored" ? css("--pos") : css("--neg")), insetLeft: 14, insetRight: 14, rx: 4 }),
        Plot.text(d.filter((r) => r.v > 0), { x: "bin", y: "v", text: (r: any) => String(r.v), dy: -8, fill: css("--text-2"), fontSize: 11 }),
        Plot.text(d.filter((r) => r.v < 0), { x: "bin", y: "v", text: (r: any) => String(-r.v), dy: 9, fill: css("--text-2"), fontSize: 11 }),
        Plot.tip(d, Plot.pointerX({ x: "bin", y: "v", title: (r: any) => `${r.bin} min: ${Math.abs(r.v)} ${r.side.toLowerCase()}` })),
      ],
    });
  }, [tRows, team0]);

  const name: Col = { key: "name", label: "Team", fmt: (v, r) => <ClubLink id={r.club} name={v} /> };
  const n2 = (v: any) => fmt.n(v, 2), n1 = (v: any) => fmt.n(v, 1);
  const cols: Record<View, Col[]> = {
    attack: [name, { key: "p", label: "P", num: true },
      { key: "sf", label: "Shots", num: true, heat: "pos", fmt: n1, title: "Shots per match" },
      { key: "sa", label: "Shots ag.", num: true, heat: "neg", fmt: n1 },
      { key: "tf", label: "On target", num: true, heat: "pos", fmt: n1 },
      { key: "ta", label: "OT ag.", num: true, heat: "neg", fmt: n1 },
      { key: "sot_pct", label: "SOT%", num: true, heat: "pos", fmt: (v) => fmt.pct(v) },
      { key: "conv", label: "Goals/SOT", num: true, heat: "pos", fmt: (v) => fmt.pct(v), title: "Goals per shot on target" },
      { key: "xf", label: "xG", num: true, heat: "pos", fmt: n2, title: "Shot-based expected goals per match" },
      { key: "xa", label: "xGA", num: true, heat: "neg", fmt: n2 },
      { key: "finishing", label: "G − xG", num: true, heat: "pos", fmt: (v) => fmt.signed(v, 1), title: "Season goals minus shot-based xG" },
      { key: "keeping", label: "xGA − GA", num: true, heat: "pos", fmt: (v) => fmt.signed(v, 1), title: "Goals prevented vs shot-based expectation" },
      { key: "cs", label: "Clean sheets", num: true, heat: "pos" }, { key: "fts", label: "Blanks", num: true, heat: "neg" }],
    discipline: [name, { key: "p", label: "P", num: true },
      { key: "cf", label: "Corners", num: true, heat: "pos", fmt: n1 }, { key: "ca", label: "Corners ag.", num: true, heat: "neg", fmt: n1 },
      { key: "fo", label: "Fouls", num: true, heat: "neg", fmt: n1 }, { key: "foa", label: "Fouled", num: true, heat: "pos", fmt: n1 },
      { key: "y", label: "Yellows", num: true, heat: "neg", fmt: n2 }, { key: "r", label: "Reds", num: true, heat: "neg" }],
    state: [name, { key: "p", label: "P", num: true },
      { key: "h1f", label: "1st-half GF", num: true, heat: "pos" }, { key: "h1a", label: "1st-half GA", num: true, heat: "neg" },
      { key: "h2f", label: "2nd-half GF", num: true, heat: "pos" }, { key: "h2a", label: "2nd-half GA", num: true, heat: "neg" },
      { key: "ahead", label: "Led at HT", num: true }, { key: "pts_ahead", label: "Pts when led", num: true, fmt: (v, r) => r.ahead ? `${v} (${fmt.n(v / r.ahead, 2)})` : "–" },
      { key: "behind", label: "Behind at HT", num: true }, { key: "pts_behind", label: "Pts from behind", num: true, heat: "pos", fmt: (v, r) => r.behind ? `${v} (${fmt.n(v / r.behind, 2)})` : "–" },
      { key: "comebacks", label: "Comeback wins", num: true, heat: "pos" }, { key: "collapses", label: "Lost from ahead", num: true, heat: "neg" }],
    timing: [],
  };
  const top = (k: string, asc = false) => [...st.rows].filter((r) => r[k] != null).sort((a, b) => (asc ? a[k] - b[k] : b[k] - a[k]))[0];
  const best = { sot: top("tf"), comeback: top("pts_behind"), clean: top("cs") };

  return (
    <>
      <div className="filters">
        <Field label="Stats"><Seg value={view} onChange={setView} label="Stat group" options={[["attack", "Shooting & defending"], ["discipline", "Set pieces & discipline"], ["state", "Game state"], ["timing", "Goal timing"]]} /></Field>
      </div>
      <Loading state={st} />
      {view !== "timing" ? (
        <Card title={{ attack: `${best.sot?.name ?? "–"} put the most shots on target`, discipline: "Corners, fouls and cards per match",
                       state: best.comeback ? `${best.comeback.name} have taken the most points from losing positions at half-time` : "Game state" }[view]}
              sub={{ attack: "Per match unless noted. xG is shot-based (from shots and shots on target) for every season; G − xG over the whole season.",
                     discipline: "Per match; reds are season totals.", state: "Results by the half-time score; points per match in that state in brackets." }[view]}>
          <DataTable rows={st.rows} cols={cols[view]} initialSort={{ key: view === "state" ? "pts_behind" : view === "attack" ? "xf" : "cf", desc: true }} rank maxHeight={760} />
        </Card>
      ) : !timing.loading && !tRows.length ? (
        <Empty>Goal minutes come from Transfermarkt events, which stop at the end of 2025-26 (the data mirror is frozen).</Empty>
      ) : (
        <div className="grid">
          <div className="c7">
            <Card title="When every team scores and concedes" sub="Goals by 15-minute period (added time counts in the period it extends). Late = goals scored minus conceded after the 75th minute.">
              <DataTable rows={tRows} initialSort={{ key: "late", desc: true }} onRow={(r) => setTeam(r.club)} highlight={(r) => r.club === team0} maxHeight={720} cols={[
                { key: "name", label: "Team" },
                ...BINS.map((b, i) => ({ key: `f${i}`, label: b, num: true, heat: "pos" as const, title: `Scored, ${b} min` })),
                { key: "late", label: "Late +/−", num: true, heat: "pos" as const, fmt: (v: any) => fmt.signed(v, 0) },
              ]} />
              <p className="xs muted" style={{ marginTop: 8 }}>Columns show goals scored per period; click a row to see that team's full profile.</p>
            </Card>
          </div>
          <div className="c5">
            <div className="filters" style={{ marginTop: 0 }}>
              <Select label="Team" value={team0} onChange={setTeam} options={[...tRows].sort((a, b) => a.name.localeCompare(b.name)).map((r) => [r.club, r.name])} />
            </div>
            {timePlot && (
              <Figure title={`${names.get(team0) ?? ""}: goals by period`} subtitle="Up: goals scored. Down: goals conceded." source="Transfermarkt match events"
                      plot={timePlot} alt="Goals scored and conceded by 15-minute period"
                      table={{ rows: BINS.map((b, i) => ({ bin: b, f: tRows.find((r) => r.club === team0)?.[`f${i}`] ?? 0, a: tRows.find((r) => r.club === team0)?.[`a${i}`] ?? 0 })),
                               cols: [["bin", "Minutes"], ["f", "Scored"], ["a", "Conceded"]] }} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
