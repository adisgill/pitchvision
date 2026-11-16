// The opposition report's sections. Each is self-contained (own queries) and printable.
import * as Plot from "@observablehq/plot";
import { ReactNode, useMemo } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt } from "../../lib/format";
import { Figure } from "../../ui/Figure";
import { Card, DataTable, Legend, PlayerLink, useTip } from "../../ui/kit";
import { HeatLegend, L, Pitch, W, ZoneHeat } from "../../ui/pitch";
import { BIN_LABELS, bin15, fingerprint, pts, SITUATIONS, traits, zoneName } from "./data";

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rp-section"><h2>{title}</h2>{children}</section>
);

// ---------- 2. style fingerprint ----------

export function Fingerprint({ rows, team, name, matches }: { rows: Row[]; team: string; name: string; matches: number }) {
  const fp = useMemo(() => fingerprint(rows, team), [rows, team]);
  const tr = useMemo(() => traits(fp), [fp]);
  const shown = fp.filter((r) => r.z != null);
  return (
    <Section title="Style fingerprint">
      <div className="grid">
        <div className="c8">
          <Card title={`How ${name} play, against the rest of the league`}
                sub={`Per-match averages over ${matches} league matches with FotMob/Opta data, as standard deviations from the league's team average (blue above, red below; the colour marks direction, not good or bad). Rank among ${shown[0]?.teams ?? "–"} teams.`}>
            <div className="table-wrap" style={{ maxHeight: "none" }}>
              <table className="data">
                <thead><tr><th>Measure</th><th className="r">{name.length > 14 ? "Team" : name}</th><th className="r">League</th><th style={{ minWidth: 180 }} className="c">vs league (SD)</th><th className="r">Rank</th></tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const z = Math.max(-3, Math.min(3, r.z!));
                    const w = (Math.abs(z) / 3) * 50;
                    return (
                      <tr key={r.key}>
                        <td>{r.label}{r.note === "predictive" ? <span className="pill accent" style={{ marginLeft: 6 }} title="Among the most predictive team stats for future results">predictive</span> : r.note === "dominated" ? <span className="pill" style={{ marginLeft: 6 }} title="High volume usually means a team is under pressure">pressure sign</span> : null}</td>
                        <td className="r num">{r.fmt(r.v!)}</td>
                        <td className="r num muted">{r.fmt(r.lg!)}</td>
                        <td>
                          <div style={{ position: "relative", height: 10, background: "var(--surface-2)", borderRadius: 4 }} title={`${fmt.signed(r.z, 2)} SD`}>
                            <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--axis)" }} />
                            <div style={{ position: "absolute", top: 1, bottom: 1, borderRadius: 3, background: z >= 0 ? "var(--pos)" : "var(--neg)",
                                          left: z >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }} />
                          </div>
                        </td>
                        <td className="r num muted">{r.rank}/{r.teams}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="c4">
          <Card title="In plain English" sub="The most extreme traits, strongest first.">
            {tr.length ? <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.7 }}>{tr.map((t) => <li key={t}>{t}</li>)}</ul>
              : <p className="ink2 small">A balanced profile: nothing more than one standard deviation from the league norm.</p>}
          </Card>
        </div>
      </div>
    </Section>
  );
}

// ---------- 3/4. how they create and concede ----------

type Zone = { zx: number; zy: number; v: number; team: number; lg: number };

function zoneDeltas(rows: Row[], team: string, side: "for" | "against"): { cells: Zone[]; teamPm: number; lgPm: number } {
  const s = rows.filter((r) => r.side === side);
  const matches = new Map<string, number>();
  s.forEach((r) => matches.set(r.club_id, Number(r.matches)));
  const totalM = [...matches.values()].reduce((a, b) => a + b, 0) || 1;
  const tm = matches.get(team) ?? 0;
  const lg = new Map<string, number>(), me = new Map<string, number>();
  s.forEach((r) => {
    const k = `${r.zx},${r.zy}`;
    lg.set(k, (lg.get(k) ?? 0) + Number(r.xg));
    if (r.club_id === team) me.set(k, (me.get(k) ?? 0) + Number(r.xg));
  });
  const cells: Zone[] = [...lg.keys()].map((k) => {
    const [zx, zy] = k.split(",").map(Number);
    const l = lg.get(k)! / totalM, t = tm ? (me.get(k) ?? 0) / tm : 0;
    return { zx, zy, v: t - l, team: t, lg: l };
  }).filter((c) => c.lg > 0.002 || c.team > 0.002);
  return { cells, teamPm: tm ? [...me.values()].reduce((a, b) => a + b, 0) / tm : 0, lgPm: [...lg.values()].reduce((a, b) => a + b, 0) / totalM };
}

export function CreateConcede({ team, name, comp, season }: { team: string; name: string; comp: string; season: number }) {
  const zones = useQuery(`select * from fm_zones_team where competition_id = ${lit(comp)} and season = ${season}`);
  const sit = useQuery(`select * from fm_team_situations where competition_id = ${lit(comp)} and season = ${season}`);
  const pl = useQuery(`select f.player_id, coalesce(p.name, q.name) as pname, f.position_group, f.minutes, f.npxg, f.xa, f.npxg_p90, f.xa_p90,
      f.chances_p90, f.big_chances, f.goals, f.assists from fm_player_season f
      left join players p on p.player_id = f.player_id left join fm_players q on q.player_id = f.player_id
      where f.club_id = ${lit(team)} and f.season = ${season} and f.competition_id = ${lit(comp)}`);
  const zf = useMemo(() => zoneDeltas(zones.rows, team, "for"), [zones.rows, team]);
  const za = useMemo(() => zoneDeltas(zones.rows, team, "against"), [zones.rows, team]);
  const matches = useMemo(() => {
    const m = new Map<string, number>();
    zones.rows.filter((r) => r.side === "for").forEach((r) => m.set(r.club_id, Number(r.matches)));
    return m;
  }, [zones.rows]);
  const sitRows = (side: "for" | "against") => {
    const tm = matches.get(team) ?? 0;
    const totalM = [...matches.values()].reduce((a, b) => a + b, 0) || 1;
    const rows = sit.rows.filter((r) => r.side === side);
    const teamTotal = rows.filter((r) => r.club_id === team).reduce((a, r) => a + Number(r.xg), 0);
    return SITUATIONS.map(([key, label, sits]) => {
      const mine = rows.filter((r) => r.club_id === team && sits.includes(r.situation));
      const all = rows.filter((r) => sits.includes(r.situation));
      const xg = mine.reduce((a, r) => a + Number(r.xg), 0);
      return { key, label, xg_pm: tm ? xg / tm : null, lg_pm: all.reduce((a, r) => a + Number(r.xg), 0) / totalM,
               share: teamTotal ? xg / teamTotal : null, goals: mine.reduce((a, r) => a + Number(r.goals), 0),
               shots: mine.reduce((a, r) => a + Number(r.shots), 0) };
    });
  };
  const sf = sitRows("for"), sa = sitRows("against");
  const top = (cells: Zone[], k = 3) => [...cells].sort((a, b) => b.v - a.v).slice(0, k).filter((c) => c.v > 0);
  const maxAbs = Math.max(0.01, ...zf.cells.map((c) => Math.abs(c.v)), ...za.cells.map((c) => Math.abs(c.v)));
  const sitTable = (rows: ReturnType<typeof sitRows>, against: boolean) => (
    <table className="data" style={{ marginTop: 10 }}>
      <thead><tr><th>Situation</th><th className="r">xG / match</th><th className="r">League</th><th className="r">Share</th><th className="r">Goals</th></tr></thead>
      <tbody>{rows.map((r) => {
        const hi = r.xg_pm != null && r.lg_pm > 0 && r.xg_pm / r.lg_pm > 1.25;
        const lo = r.xg_pm != null && r.lg_pm > 0 && r.xg_pm / r.lg_pm < 0.75;
        return (
          <tr key={r.key}>
            <td className={r.key === "corner" ? "muted small" : ""}>{r.label}</td>
            <td className="r num" style={{ fontWeight: hi || lo ? 650 : 400 }}>{fmt.n(r.xg_pm, 2)}{hi ? (against ? " ▲" : " ▲") : lo ? " ▼" : ""}</td>
            <td className="r num muted">{fmt.n(r.lg_pm, 2)}</td>
            <td className="r num">{fmt.pct(r.share)}</td>
            <td className="r num">{r.goals}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
  const creators = [...pl.rows].filter((r) => r.minutes >= 270).sort((a, b) => (b.npxg + b.xa) - (a.npxg + a.xa)).slice(0, 6);
  return (
    <>
      <Section title="How they create">
        <div className="grid">
          <div className="c7">
            <Card title={`${name} create ${fmt.n(zf.teamPm, 2)} xG per match (league team average ${fmt.n(zf.lgPm, 2)})`}
                  sub={<>Where their shots' xG comes from, per match, minus the league average for the same zone (blue: more than the league, red: less). Attacking left to right.
                    {top(zf.cells).length ? <> Biggest sources above the norm: {top(zf.cells).map((c) => zoneName(c.zx, c.zy)).join("; ")}.</> : null}</>}>
              <ZoneHeat cells={zf.cells.map((c) => ({ zx: c.zx, zy: c.zy, v: c.v, label: undefined }))} mode="div" max={maxAbs} labelTop={4}
                        fmtV={(v) => fmt.signed(v, 2)}
                        title={(c) => { const z = zf.cells.find((q) => q.zx === c.zx && q.zy === c.zy)!; return <><b>{fmt.signed(z.v, 3)} xG / match vs league</b><div className="muted">{zoneName(z.zx, z.zy)} · {name} {z.team.toFixed(3)} · league {z.lg.toFixed(3)}</div></>; }} />
              <HeatLegend mode="div" lo="less than league" hi="more than league" label="xG per match" />
            </Card>
          </div>
          <div className="c5 stack" style={{ gap: 16 }}>
            <Card title="Where the xG comes from" sub="By shot situation, per match, against the league's team average. ▲/▼: at least 25% above/below.">
              {sitTable(sf, false)}
            </Card>
            <Card title="Main threats" sub="Players by non-penalty xG + xA this season (min. 270 minutes).">
              <table className="data"><thead><tr><th>Player</th><th className="r">npxG</th><th className="r">xA</th><th className="r">G+A</th><th className="r">per 90</th></tr></thead>
                <tbody>{creators.map((p) => (
                  <tr key={p.player_id}><td><PlayerLink id={p.player_id} name={p.pname ?? p.player_id} /> <span className="xs muted">{p.position_group}</span></td>
                    <td className="r num">{fmt.n(p.npxg, 1)}</td><td className="r num">{fmt.n(p.xa, 1)}</td><td className="r num">{fmt.n(p.goals + p.assists)}</td>
                    <td className="r num muted">{fmt.n(p.npxg_p90 + p.xa_p90, 2)}</td></tr>
                ))}</tbody></table>
            </Card>
          </div>
        </div>
      </Section>
      <Section title="How they concede">
        <div className="grid">
          <div className="c7">
            <Card title={`${name} concede ${fmt.n(za.teamPm, 2)} xG per match (league team average ${fmt.n(za.lgPm, 2)})`}
                  sub={<>Where opponents' xG comes from, mirrored into {name}'s view (their own goal on the left), minus the league average.
                    {top(za.cells).length ? <> Most exposed vs the norm: {top(za.cells).map((c) => zoneName(c.zx, c.zy, true)).join("; ")}.</> : null}</>}>
              <ZoneHeat cells={za.cells.map((c) => ({ zx: c.zx, zy: c.zy, v: c.v }))} mode="div" max={maxAbs} labelTop={4}
                        fmtV={(v) => fmt.signed(v, 2)}
                        title={(c) => { const z = za.cells.find((q) => q.zx === c.zx && q.zy === c.zy)!; return <><b>{fmt.signed(z.v, 3)} xG conceded / match vs league</b><div className="muted">{zoneName(z.zx, z.zy, true)} · {name} {z.team.toFixed(3)} · league {z.lg.toFixed(3)}</div></>; }} />
              <HeatLegend mode="div" lo="concede less than league" hi="concede more than league" label="xG per match" />
            </Card>
          </div>
          <div className="c5">
            <Card title="Weak points" sub="Situations they concede from, per match, vs the league's team average. ▲: at least 25% more than the league.">
              {sitTable(sa, true)}
              {(() => {
                const worst = sa.filter((r) => r.key !== "corner" && r.xg_pm != null && r.lg_pm > 0).sort((a, b) => (b.xg_pm! / b.lg_pm) - (a.xg_pm! / a.lg_pm))[0];
                return worst && worst.xg_pm! > worst.lg_pm * 1.1
                  ? <p className="small" style={{ marginTop: 10 }}><b>Target:</b> they concede {fmt.pct(worst.xg_pm! / worst.lg_pm - 1)} more xG than average from {worst.label.toLowerCase()}.</p>
                  : <p className="small ink2" style={{ marginTop: 10 }}>No situation stands out: they concede at or below the league rate across the board.</p>;
              })()}
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}

// ---------- 5. game state ----------

export function GameState({ team, name, comp, season, mine }: { team: string; name: string; comp: string; season: number; mine: Row[] }) {
  const ev = useQuery(`select e.minute, e.is_home, m.home_club from fm_events e join matches m using (match_id)
      where e.type = 'goal' and m.competition_id = ${lit(comp)} and m.season = ${season} and (m.home_club = ${lit(team)} or m.away_club = ${lit(team)})`);
  const bins = useMemo(() => {
    const b = BIN_LABELS.map((l) => ({ bin: l, scored: 0, conceded: 0 }));
    ev.rows.forEach((e) => {
      const ours = (e.home_club === team) === !!e.is_home;
      const i = bin15(Number(e.minute));
      if (ours) b[i].scored++; else b[i].conceded++;
    });
    return b;
  }, [ev.rows, team]);
  const plot = useMemo(() => {
    const long = bins.flatMap((b) => [{ bin: b.bin, v: b.scored, k: "Scored" }, { bin: b.bin, v: -b.conceded, k: "Conceded" }]);
    return (width: number) => ({
      width, height: 240, marginLeft: 40, x: { label: null, domain: BIN_LABELS, padding: 0.35 },
      y: { label: "Goals (conceded below the line)", grid: true, tickFormat: (v: number) => String(Math.abs(v)) },
      color: { domain: ["Scored", "Conceded"], range: [css("--pos"), css("--neg")] },
      marks: [
        Plot.barY(long, { x: "bin", y: "v", fill: "k", rx: 3 }),
        Plot.ruleY([0], { stroke: css("--axis") }),
        Plot.tip(long, Plot.pointer({ x: "bin", y: "v", title: (d: any) => `${d.bin}': ${Math.abs(d.v)} goals ${d.k.toLowerCase()}` })),
      ],
    });
  }, [bins]);
  const ht = (["lead", "level", "trail"] as const).map((s) => {
    const g = mine.filter((r) => r.gf_ht != null && (s === "lead" ? r.gf_ht > r.ga_ht : s === "level" ? r.gf_ht === r.ga_ht : r.gf_ht < r.ga_ht));
    const w = g.filter((r) => r.gf > r.ga).length, d = g.filter((r) => r.gf === r.ga).length;
    return { state: s === "lead" ? "Leading at half-time" : s === "level" ? "Level at half-time" : "Trailing at half-time", n: g.length,
             record: `${w}-${d}-${g.length - w - d}`, ppg: g.length ? g.reduce((a, r) => a + pts(r.gf, r.ga), 0) / g.length : null };
  });
  const forms = useMemo(() => {
    const m = new Map<string, Row[]>();
    mine.forEach((r) => { const f = r.formation ?? "unknown"; if (!m.has(f)) m.set(f, []); m.get(f)!.push(r); });
    return [...m.entries()].map(([f, rs]) => ({ formation: f, n: rs.length, ppg: rs.reduce((a, r) => a + pts(r.gf, r.ga), 0) / rs.length,
      xgf: rs.reduce((a, r) => a + (r.expected_goals ?? 0), 0) / rs.length, xga: rs.reduce((a, r) => a + (r.expected_goals_opp ?? 0), 0) / rs.length }))
      .sort((a, b) => b.n - a.n);
  }, [mine]);
  const venue = (["h", "a"] as const).map((v) => {
    const rs = mine.filter((r) => r.side === v);
    const avg = (f: (r: Row) => number) => (rs.length ? rs.reduce((a, r) => a + f(r), 0) / rs.length : null);
    return { venue: v === "h" ? "Home" : "Away", n: rs.length, ppg: avg((r) => pts(r.gf, r.ga)), xgf: avg((r) => r.expected_goals ?? 0),
             xga: avg((r) => r.expected_goals_opp ?? 0), poss: avg((r) => r.ballpossesion ?? 0), xpts: avg((r) => 3 * (r.p_win ?? 0) + (r.p_draw ?? 0)) };
  });
  const late = bins[4].scored + bins[5].scored, lateC = bins[4].conceded + bins[5].conceded;
  const totS = bins.reduce((a, b) => a + b.scored, 0), totC = bins.reduce((a, b) => a + b.conceded, 0);
  return (
    <Section title="Game state">
      <div className="grid">
        <div className="c6">
          <Figure title={totS + totC ? `${fmt.pct(totS ? late / totS : 0)} of their goals come after the hour; ${fmt.pct(totC ? lateC / totC : 0)} of those conceded` : "When goals happen"}
                  subtitle="League goals scored (above) and conceded (below) by 15-minute window. Added time counts in the 45th and 90th-minute windows."
                  source="FotMob events" plot={plot} alt="Goals scored and conceded by 15-minute window"
                  table={{ rows: bins, cols: [["bin", "Minutes"], ["scored", "Scored"], ["conceded", "Conceded"]] }}>
            <Legend items={[{ label: "Scored", color: "var(--pos)", kind: "rect" }, { label: "Conceded", color: "var(--neg)", kind: "rect" }]} />
          </Figure>
        </div>
        <div className="c6 stack" style={{ gap: 16 }}>
          <Card title="From each half-time position">
            <table className="data"><thead><tr><th>At half-time</th><th className="r">Matches</th><th className="r">W-D-L</th><th className="r">Points / match</th></tr></thead>
              <tbody>{ht.map((r) => <tr key={r.state}><td>{r.state}</td><td className="r num">{r.n}</td><td className="r num">{r.record}</td><td className="r num">{fmt.n(r.ppg, 2)}</td></tr>)}</tbody></table>
          </Card>
          <Card title="Home and away" sub="Expected points: from the closing odds before each match.">
            <table className="data"><thead><tr><th></th><th className="r">P</th><th className="r">Pts/m</th><th className="r">Exp. pts/m</th><th className="r">xG for</th><th className="r">xG against</th><th className="r">Poss.</th></tr></thead>
              <tbody>{venue.map((r) => <tr key={r.venue}><td>{r.venue}</td><td className="r num">{r.n}</td><td className="r num">{fmt.n(r.ppg, 2)}</td><td className="r num muted">{fmt.n(r.xpts, 2)}</td><td className="r num">{fmt.n(r.xgf, 2)}</td><td className="r num">{fmt.n(r.xga, 2)}</td><td className="r num">{fmt.n(r.poss, 0)}%</td></tr>)}</tbody></table>
          </Card>
        </div>
        <div className="c12">
          {forms.some((f) => f.formation !== "unknown") ? (
            <Card title={`${name} mostly line up in a ${forms.find((f) => f.formation !== "unknown")!.formation}`}
                  sub={`Starting formation as recorded by Transfermarkt, with results and xG per match in each.${forms.some((f) => f.formation === "unknown") ? " Matches after the Transfermarkt freeze (July 2026) have no recorded formation." : ""}`}>
              <DataTable rows={forms} initialSort={{ key: "n", desc: true }} cols={[
                { key: "formation", label: "Formation" }, { key: "n", label: "Matches", num: true },
                { key: "ppg", label: "Points / match", num: true, fmt: (v) => fmt.n(v, 2) },
                { key: "xgf", label: "xG for", num: true, fmt: (v) => fmt.n(v, 2) }, { key: "xga", label: "xG against", num: true, fmt: (v) => fmt.n(v, 2) },
              ]} />
            </Card>
          ) : (
            <Card title="Formations" sub="No formations recorded for this season: Transfermarkt, our formation source, stopped updating in July 2026. The likely XI below shows their recent shape from line-ups." />
          )}
        </div>
      </div>
    </Section>
  );
}

// ---------- 6. likely XI and key players ----------

export function LikelyXI({ team, name, comp, season }: { team: string; name: string; comp: string; season: number }) {
  const tip = useTip();
  const lu = useQuery(`select l.player_id, l.name, l.shirt, l.usual_position_id, l.layout_x, l.layout_y, l.rating, l.match_id, m.match_date
      from fm_lineups l join matches m using (match_id)
      where l.club_id = ${lit(team)} and l.starter and m.competition_id = ${lit(comp)} and m.season = ${season}`);
  const un = useQuery(`select * from fm_unavailable where club_id = ${lit(team)} and season = ${season}
      and kickoff_utc = (select max(kickoff_utc) from fm_unavailable where club_id = ${lit(team)} and season = ${season})`);
  const pl = useQuery(`select f.*, coalesce(p.name, q.name) as pname from fm_player_season f
      left join players p on p.player_id = f.player_id left join fm_players q on q.player_id = f.player_id
      where f.club_id = ${lit(team)} and f.season = ${season} and f.competition_id = ${lit(comp)} order by f.minutes desc`);
  const xi = useMemo(() => {
    const ids = [...new Set([...lu.rows].sort((a, b) => +new Date(b.match_date) - +new Date(a.match_date)).map((r) => r.match_id))].slice(0, 5);
    const recent = lu.rows.filter((r) => ids.includes(r.match_id));
    const by = new Map<string, Row[]>();
    recent.forEach((r) => { if (!by.has(r.player_id)) by.set(r.player_id, []); by.get(r.player_id)!.push(r); });
    const avg = (rs: Row[], k: string) => { const v = rs.map((r) => r[k]).filter((x) => x != null) as number[]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    // position from each player's most recent start (averaging across formations blurs roles)
    const latest = (rs: Row[]) => [...rs].sort((a, b) => +new Date(b.match_date) - +new Date(a.match_date)).find((r) => r.layout_x != null);
    const lastDate = ids.length ? recent.reduce((a, r) => Math.max(a, +new Date(r.match_date)), 0) : null;
    return { n: ids.length, lastDate, players: [...by.entries()].map(([id, rs]) => ({ id, name: rs[0].name as string, shirt: rs[0].shirt, starts: rs.length,
      x: latest(rs)?.layout_x ?? null, y: latest(rs)?.layout_y ?? null, rating: avg(rs, "rating") }))
      .sort((a, b) => b.starts - a.starts || (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 11) };
  }, [lu.rows]);
  // only trust an absentee list from the team's most recent match: an older list is stale
  const listDate = un.rows[0]?.kickoff_utc ? +new Date(un.rows[0].kickoff_utc) : null;
  const fresh = listDate != null && xi.lastDate != null && listDate >= xi.lastDate - 3 * 86400000;
  const absent = fresh ? un.rows : [];
  const absentDate = fresh ? un.rows[0]?.kickoff_utc : null;
  return (
    <Section title="Likely XI and key players">
      <div className="grid">
        <div className="c7">
          <Card title={`Most-used starting XI over the last ${xi.n} league matches`}
                sub="Players placed at their average position in FotMob's line-up layout (schematic, not tracking data), attacking left to right. Number: starts in those matches.">
            <Pitch label={`${name} likely XI`}>
              {xi.players.filter((p) => p.x != null && p.y != null).map((p) => {
                const px = 4 + p.x! * 97, py = W - p.y! * W;
                return (
                  <g key={p.id} onPointerMove={(e) => tip.show(e, <><b>{p.name}</b><div className="muted">{p.starts}/{xi.n} starts · avg rating {fmt.n(p.rating, 1)}</div></>)} onPointerLeave={tip.hide}>
                    <circle cx={px} cy={py} r={3} fill="var(--s1)" stroke="var(--surface)" strokeWidth={0.6} />
                    <text x={px} y={-py + 0.9} transform="scale(1 -1)" textAnchor="middle" fontSize={2.3} fontWeight={700} fill="#fff" pointerEvents="none">{p.starts}</text>
                    <text x={px} y={-py + 6} transform="scale(1 -1)" textAnchor="middle" fontSize={2.3} fill="var(--text)" pointerEvents="none">{p.name.split(" ").slice(-1)[0]}</text>
                  </g>
                );
              })}
              <line x1={L / 2} y1={0} x2={L / 2} y2={0} stroke="none" />
            </Pitch>
            {tip.node}
          </Card>
        </div>
        <div className="c5 stack" style={{ gap: 16 }}>
          <Card title={absent.length ? `${absent.length} unavailable` : "Unavailable"}
                sub={absentDate ? `FotMob's list for their most recent match (${fmt.dayYear(absentDate)}). Check team news before kickoff.`
                  : listDate ? `No absentees listed for their most recent match (the last list was from ${fmt.dayYear(listDate)}). Check team news before kickoff.`
                  : "No absentee list in FotMob's data for this season."}>
            {absent.length > 0 && (
              <table className="data"><tbody>{[...absent].sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0)).map((u) => (
                <tr key={u.player_id}><td><PlayerLink id={u.player_id} name={u.name} /></td><td className="small">{u.type === "internationalDuty" ? "international duty" : u.type}</td>
                  <td className="small muted">{u.expected_return ?? ""}</td><td className="r num muted small">{fmt.eur(u.market_value)}</td></tr>
              ))}</tbody></table>
            )}
          </Card>
          <Card title="Key players" sub="Most minutes this season, with FotMob match rating and our dimension ratings (50 = position average).">
            <div className="table-wrap" style={{ maxHeight: 360 }}>
              <table className="data"><thead><tr><th>Player</th><th className="r">Min</th><th className="r">Rating</th><th>Best dimension</th></tr></thead>
                <tbody>{pl.rows.slice(0, 11).map((p) => {
                  const dims = ["shooting", "creation", "progression", "security", "defending", "duels", "physical", "goalkeeping"]
                    .map((d) => [d, p[`${d}_rating`]] as const).filter(([, v]) => v != null).sort((a, b) => (b[1] as number) - (a[1] as number));
                  return (
                    <tr key={p.player_id}><td><PlayerLink id={p.player_id} name={p.pname ?? p.player_id} /> <span className="xs muted">{p.position_group}</span></td>
                      <td className="r num">{fmt.n(p.minutes)}</td><td className="r num">{fmt.n(p.rating, 2)}</td>
                      <td>{dims[0] ? <span className={`pill ${(dims[0][1] as number) >= 60 ? "accent" : ""}`} title="50 = position average; 10 points = 1 SD">{dims[0][0]} {Math.round(dims[0][1] as number)}</span> : "–"}</td></tr>
                  );
                })}</tbody></table>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}

// ---------- 7. set pieces ----------

export function SetPieces({ rows, team, name, comp, season }: { rows: Row[]; team: string; name: string; comp: string; season: number }) {
  const sit = useQuery(`select club_id, side, sum(xg) as xg, sum(goals) as goals, sum(shots) as shots from fm_team_situations
      where competition_id = ${lit(comp)} and season = ${season} and situation in ('FromCorner', 'SetPiece', 'FreeKick', 'ThrowInSetPiece') group by all`);
  const per = useMemo(() => {
    const m = new Map<string, { n: number; corners: number; cornersA: number; sp: number; spA: number }>();
    rows.forEach((r) => {
      const e = m.get(r.club_id) ?? { n: 0, corners: 0, cornersA: 0, sp: 0, spA: 0 };
      e.n++; e.corners += r.corners ?? 0; e.cornersA += r.corners_opp ?? 0; e.sp += r.expected_goals_set_play ?? 0; e.spA += r.expected_goals_set_play_opp ?? 0;
      m.set(r.club_id, e);
    });
    const goals = new Map<string, { f: number; a: number }>();
    sit.rows.forEach((r) => { const g = goals.get(r.club_id) ?? { f: 0, a: 0 }; if (r.side === "for") g.f += Number(r.goals); else g.a += Number(r.goals); goals.set(r.club_id, g); });
    const list = [...m.entries()].map(([club, e]) => ({ club, corners: e.corners / e.n, cornersA: e.cornersA / e.n, sp: e.sp / e.n, spA: e.spA / e.n,
      gf: goals.get(club)?.f ?? 0, ga: goals.get(club)?.a ?? 0 }));
    const rank = (k: "corners" | "sp" | "spA" | "gf" | "ga", desc = true) => {
      const me = list.find((x) => x.club === team);
      return me ? 1 + list.filter((x) => (desc ? x[k] > me[k] : x[k] < me[k])).length : null;
    };
    const avg = (k: "corners" | "cornersA" | "sp" | "spA" | "gf" | "ga") => list.reduce((a, x) => a + x[k], 0) / (list.length || 1);
    return { me: list.find((x) => x.club === team), teams: list.length, rank, avg };
  }, [rows, sit.rows, team]);
  const me = per.me;
  if (!me) return null;
  const line = (label: string, v: number, lg: number, rank: number | null, d = 2, note?: string) => (
    <tr><td>{label}</td><td className="r num" style={{ fontWeight: 650 }}>{fmt.n(v, d)}</td><td className="r num muted">{fmt.n(lg, d)}</td><td className="r num">{rank}/{per.teams}</td><td className="small muted">{note ?? ""}</td></tr>
  );
  return (
    <Section title="Set pieces">
      <Card title={`${name} rank ${per.rank("sp")}${["st", "nd", "rd"][(per.rank("sp") ?? 4) - 1] ?? "th"} for set-piece xG and ${per.rank("spA", false)}${["st", "nd", "rd"][(per.rank("spA", false) ?? 4) - 1] ?? "th"} for set-piece xG conceded (1st = fewest)`}
            sub="Corners, free kicks and throw-in routines. Per match unless stated; ranks among the league's teams. Note: set-piece xG is less stable from match to match than open-play xG, so read small differences with care.">
        <table className="data">
          <thead><tr><th></th><th className="r">{name.length > 14 ? "Team" : name}</th><th className="r">League avg</th><th className="r">Rank</th><th></th></tr></thead>
          <tbody>
            {line("Corners won", me.corners, per.avg("corners"), per.rank("corners"), 1)}
            {line("Corners conceded", me.cornersA, per.avg("cornersA"), null, 1)}
            {line("Set-piece xG for", me.sp, per.avg("sp"), per.rank("sp"))}
            {line("Set-piece xG against", me.spA, per.avg("spA"), per.rank("spA", false), 2, "rank 1 = concedes least")}
            {line("Set-piece goals for (season)", me.gf, per.avg("gf"), per.rank("gf"), 0)}
            {line("Set-piece goals against (season)", me.ga, per.avg("ga"), per.rank("ga", false), 0, "rank 1 = concedes fewest")}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

// ---------- 8. trend ----------

export function Trend({ mine, name }: { mine: Row[]; name: string }) {
  const series = useMemo(() => mine.map((r, i) => {
    const w = mine.slice(Math.max(0, i - 4), i + 1);
    const avg = (k: string) => w.reduce((a, x) => a + (x[k] ?? 0), 0) / w.length;
    return { i: i + 1, date: new Date(r.match_date), opp: r.opp, gf: r.gf, ga: r.ga, res: r.gf > r.ga ? "W" : r.gf < r.ga ? "L" : "D",
             xgf: avg("expected_goals"), xga: avg("expected_goals_opp"), venue: r.side === "h" ? "H" : "A" };
  }), [mine]);
  const plot = useMemo(() => {
    if (series.length < 3) return undefined;
    const long = series.flatMap((s) => [{ ...s, v: s.xgf, k: "xG for" }, { ...s, v: s.xga, k: "xG against" }]);
    const top = Math.max(...long.map((d) => d.v)) * 1.15;
    return (width: number) => ({
      width, height: 260, marginLeft: 40, x: { label: "League match", tickFormat: (d: number) => String(d) },
      y: { label: "xG per match (rolling 5)", grid: true, domain: [0, top] },
      color: { domain: ["xG for", "xG against"], range: [css("--s1"), css("--s2")] },
      marks: [
        Plot.line(long, { x: "i", y: "v", stroke: "k", strokeWidth: 2, curve: "monotone-x" }),
        Plot.text(series, { x: "i", y: top * 0.97, text: "res", fontSize: 9, fill: (d: any) => (d.res === "W" ? css("--up-text") : d.res === "L" ? css("--critical") : css("--muted")) }),
        Plot.ruleX(series, Plot.pointerX({ x: "i", stroke: css("--axis") })),
        Plot.tip(series, Plot.pointerX({ x: "i", y: "xgf", title: (d: any) => `Match ${d.i} · ${d.venue} vs ${d.opp} · ${d.gf}–${d.ga} (${d.res})\nrolling xG for ${d.xgf.toFixed(2)}, against ${d.xga.toFixed(2)}` })),
      ],
    });
  }, [series]);
  if (!plot) return null;
  const last = series[series.length - 1], first = series[Math.min(4, series.length - 1)];
  const dir = last.xgf - last.xga - (first.xgf - first.xga);
  return (
    <Section title="Trend">
      <Figure title={`Rolling xG difference is ${fmt.signed(last.xgf - last.xga)} per match, ${Math.abs(dir) < 0.15 ? "steady" : dir > 0 ? "improving" : "declining"} through the season`}
              subtitle="Five-match rolling average of xG for and against in league matches with FotMob/Opta data; results marked along the top."
              source="FotMob/Opta" plot={plot} alt={`${name} rolling xG for and against`}
              table={{ rows: series, cols: [["i", "Match"], ["opp", "Opponent"], ["venue", "H/A"], ["res", "Result"], ["xgf", "xG for (r5)", (v) => v.toFixed(2)], ["xga", "xG against (r5)", (v) => v.toFixed(2)]] }}>
        <Legend items={[{ label: "xG for", color: "var(--s1)", kind: "line" }, { label: "xG against", color: "var(--s2)", kind: "line" }]} />
      </Figure>
    </Section>
  );
}

// ---------- 9. what matters ----------

export function WhatMatters() {
  const st = useQuery(`select * from ww_stability order by predict_r desc`);
  if (!st.rows.length) return null;
  const top = st.rows.filter((r) => r.group !== "Results").slice(0, 5);
  const neg = [...st.rows].sort((a, b) => a.predict_r - b.predict_r).slice(0, 4);
  return (
    <Section title="What matters, and what's noise">
      <div className="callout">
        Across 8,300 recent league matches, a team's first-half-of-season average predicts its points in the second half best for{" "}
        {top.map((r, i) => <span key={r.stat}>{i ? ", " : ""}<b>{r.label.toLowerCase()}</b> (r {r.predict_r.toFixed(2)})</span>)}: weight those most.
        High defensive volume ({neg.map((r) => r.label.toLowerCase()).join(", ")}) predicts <i>fewer</i> points (r down to {neg[0].predict_r.toFixed(2)}):
        it means a team is being pressed back, not that it defends well. Possession and passing are very stable team traits but predict results less than box entries and xG.
        Set-piece xG is the least stable attacking measure, so small set-piece edges are mostly noise.
      </div>
    </Section>
  );
}
