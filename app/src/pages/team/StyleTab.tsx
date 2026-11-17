// How a team plays: a reliability-gated read (tendencies, strengths, weaknesses), the style
// fingerprint against every other team in the league, and the score-state / match-clock
// history with the verdict that it isn't a repeatable trait. FotMob (Opta) team stats, 2024-25
// onward; method in spec 12.8.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { lit, Row, useQuery } from "../../db";
import { css, fmt, LEAGUES, seasonLabel } from "../../lib/format";
import { ordinal, readProfile, stripPct, Trait, TRAIT_REL, traitGroup, traitValue } from "../../lib/tactics";
import { Figure, useWidth } from "../../ui/Figure";
import { Card, Empty, Legend, Loading, Seg, useTip } from "../../ui/kit";

export default function StyleTab({ id, name }: { id: string; name: string }) {
  const mine = useQuery(`select * from team_style_fm where club_id = ${lit(id)}`);
  const rel = useQuery(`select * from style_reliability`);
  const seasons = useMemo(() => [...new Set(mine.rows.map((r) => Number(r.season)))].sort((a, b) => b - a), [mine.rows]);
  const [pick, setPick] = useState<string | null>(null);
  const season = pick ? Number(pick) : seasons[0];
  const rows = mine.rows.filter((r) => Number(r.season) === season);
  const comp = rows[0]?.competition_id as string | undefined;
  const league = useQuery(comp ? `select s.club_id, s.trait, s.value, s.pct, c.name from team_style_fm s left join clubs c using (club_id)
                                  where s.competition_id = ${lit(comp)} and s.season = ${season}` : null);
  const traits = rel.rows as Trait[];
  if (!mine.loading && !mine.rows.length) {
    return <Empty>No style profile for {name}: profiles need FotMob team stats, which we hold for nine leagues from 2024-25.</Empty>;
  }
  const n = rows[0]?.n ?? 0;
  return (
    <div className="grid">
      <Loading state={mine} />
      {seasons.length > 1 && (
        <div className="c12 row between">
          <Seg label="Season" options={seasons.map((s) => [String(s), seasonLabel(s, comp)] as [string, string])} value={String(season)} onChange={setPick} />
          <span className="muted small">{n} league matches · {LEAGUES[comp ?? ""] ?? comp}</span>
        </div>
      )}
      {traits.length > 0 && rows.length > 0 && <Identity name={name} rows={rows} traits={traits} n={n} />}
      {traits.length > 0 && rows.length > 0 && (
        <div className="c12">
          <Fingerprint name={name} id={id} rows={rows} league={league.rows} traits={traits} n={n} season={season} comp={comp} />
        </div>
      )}
      {comp && <GameState id={id} name={name} comp={comp} season={season} />}
    </div>
  );
}

function Identity({ name, rows, traits, n }: { name: string; rows: Row[]; traits: Trait[]; n: number }) {
  const p = readProfile(rows, traits);
  const col = (title: string, items: typeof p.strengths, tone: string, none: string) => (
    <div className={`dna-col ${tone}`}>
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.slice(0, 5).map((r) => (
            <li key={r.trait.trait}>
              <b>{r.phrase}</b>
              <span>{traitValue(r.trait, r.row.value)} {r.trait.label.toLowerCase()} · {r.trait.higher_better === false ? `better than ${fmt.n(r.pct, 0)}% of the league` : `${ordinal(r.pct)} percentile`}</span>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{none}</p>}
    </div>
  );
  return (
    <div className="c12">
      <Card title={`How ${name} play`}
            sub={<>Read from {n} league matches. A line only appears when the trait is reliable at this many matches ({">"}= {TRAIT_REL} split-half reliability) and the team is in the league's top or bottom fifth.{p.noisy ? ` ${p.noisy} more extreme reading${p.noisy > 1 ? "s are" : " is"} left out because that stat is mostly noise over a season.` : ""}</>}>
        <div className="dna">
          {col("Tendencies", p.tendencies, "neutral", "Nothing extreme: a middle-of-the-league style.")}
          {col("Strengths", p.strengths, "good", "No reliable strength stands out yet.")}
          {col("Weaknesses", p.weaknesses, "bad", "No reliable weakness stands out yet.")}
        </div>
      </Card>
    </div>
  );
}

const GROUPS: [string, string][] = [["Style", "more →"], ["Attack", "better →"], ["Defence", "better →"]];

function Fingerprint({ name, id, rows, league, traits, n, season, comp }: {
  name: string; id: string; rows: Row[]; league: Row[]; traits: Trait[]; n: number; season: number; comp?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const narrow = width < 640;
  const labW = narrow ? 128 : 250, valW = narrow ? 58 : 120, rowH = 26, headH = 28;
  const x0 = labW + 8, x1 = width - valW - 8;
  const x = (p: number) => x0 + (p / 100) * (x1 - x0);
  const mine = new Map(rows.map((r) => [r.trait, r]));
  const lg = useMemo(() => {
    const m = new Map<string, Row[]>();
    league.filter((r) => r.club_id !== id).forEach((r) => { if (!m.has(r.trait)) m.set(r.trait, []); m.get(r.trait)!.push(r); });
    return m;
  }, [league, id]);
  const groups = GROUPS.map(([g, dir]) => ({ g, dir, ts: traits.filter((t) => traitGroup(t) === g && mine.has(t.trait))
    .sort((a, b) => b.season_rel - a.season_rel) }));
  let y = 0;
  const layout = groups.map((g) => { const top = y; y += headH + g.ts.length * rowH + 10; return { ...g, top }; });
  const H = y + 18;
  return (
    <Figure title={`${name}'s style fingerprint, ${seasonLabel(season, comp)}`}
            subtitle={<>Each row is one stat, placed by percentile among the league's teams (ticks: every other team). Style rows run from less to more; attack and defence rows from worse to better. Filled dots are reliable at {n} matches; hollow dots are mostly noise this season, so don't read much into them.</>}
            source="FotMob (Opta) team stats"
            table={{ rows: traits.filter((t) => mine.has(t.trait)).map((t) => ({ ...mine.get(t.trait)!, label: t.label })),
                     cols: [["label", "Stat"], ["value", "Value", (v) => fmt.n(v, 2)], ["pct", "League percentile", (v) => fmt.n(v, 0)], ["rel", "Reliability", (v) => fmt.n(v, 2)]] }}>
      <div ref={ref}>
        <svg width={width} height={H} role="img" aria-label={`${name} style fingerprint`} style={{ display: "block" }}>
          {layout.map((g) => (
            <g key={g.g} transform={`translate(0,${g.top})`}>
              <text x={0} y={16} fontSize={11} fontWeight={700} letterSpacing="0.06em" fill="var(--text)" style={{ textTransform: "uppercase" }}>{g.g}</text>
              <text x={x1} y={16} fontSize={10.5} fill="var(--muted)" textAnchor="end">{g.dir}</text>
              <line x1={x(50)} x2={x(50)} y1={headH - 4} y2={headH + g.ts.length * rowH} stroke="var(--rule-strong)" strokeDasharray="2 3" />
              {g.ts.map((t, i) => {
                const r = mine.get(t.trait)!;
                const cy = headH + i * rowH + rowH / 2;
                const ok = r.rel >= TRAIT_REL;
                const others = lg.get(t.trait) ?? [];
                return (
                  <g key={t.trait} className="fp-row"
                     onPointerMove={(e) => tip.show(e, <>
                       <b>{t.label}</b>
                       <div>{name}: {traitValue(t, r.value)} · {t.higher_better === false ? `${ordinal(stripPct(t, r.pct))} percentile (fewer is better)` : `${ordinal(r.pct)} percentile`} in the league</div>
                       <div className="muted">League average {traitValue(t, r.league_mean)}</div>
                       <div className="muted">Reliability at {n} matches: {fmt.n(r.rel, 2)}{ok ? "" : " — mostly noise"} (needs ~{fmt.n(t.matches_for_07, 0)} matches for 0.7)</div>
                     </>)}
                     onPointerLeave={tip.hide}>
                    <rect x={0} y={cy - rowH / 2} width={width} height={rowH} fill="transparent" />
                    <text x={labW} y={cy + 4} textAnchor="end" fontSize={narrow ? 10.5 : 12} fill={ok ? "var(--text)" : "var(--muted)"}>
                      {narrow ? t.label.split(" (")[0].slice(0, 22) : t.label.split(" (")[0]}
                    </text>
                    <line x1={x0} x2={x1} y1={cy} y2={cy} stroke="var(--grid)" />
                    {others.map((o) => (
                      <line key={o.club_id} x1={x(stripPct(t, o.pct))} x2={x(stripPct(t, o.pct))} y1={cy - 5} y2={cy + 5}
                            stroke="var(--muted)" strokeOpacity={0.55} strokeWidth={1.5} />
                    ))}
                    <circle cx={x(stripPct(t, r.pct))} cy={cy} r={6.5} fill={ok ? "var(--s1)" : "var(--surface)"} stroke={ok ? "var(--surface)" : "var(--s1)"}
                            strokeWidth={ok ? 2 : 1.75} />
                    <text x={width - valW} y={cy + 4} fontSize={narrow ? 10.5 : 12} fill="var(--text-2)" className="num">
                      {traitValue(t, r.value)}{narrow ? "" : <tspan fill="var(--muted)" fontSize={10.5}>{`  ${ordinal(stripPct(t, r.pct))}`}</tspan>}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
          <text x={x(0)} y={H - 4} fontSize={10} fill="var(--muted)">league bottom</text>
          <text x={x(50)} y={H - 4} fontSize={10} fill="var(--muted)" textAnchor="middle">median</text>
          <text x={x(100)} y={H - 4} fontSize={10} fill="var(--muted)" textAnchor="end">top</text>
        </svg>
        {tip.node}
        <Legend items={[{ label: `${name}, reliable`, color: "var(--s1)", kind: "dot" }, { label: "Other teams", color: "var(--muted)", kind: "line" }]} />
      </div>
    </Figure>
  );
}

const STATES: [string, string][] = [["level", "Level"], ["ahead", "Ahead"], ["behind", "Behind"]];
const BLOCKS = ["0-15", "15-30", "30-45+", "45-60", "60-75", "75-90+"];

function GameState({ id, name, comp, season }: { id: string; name: string; comp: string; season: number }) {
  const q = useQuery(`select * from team_gamestate where club_id = ${lit(id)} and competition_id = ${lit(comp)} and season = ${season}`);
  const lg = useQuery(`select state, 90 * (sum(xg_for) + sum(xg_against)) / 2 / sum(minutes) as rate from team_gamestate
                       where competition_id = ${lit(comp)} and season = ${season} group by state`);
  const rel = useQuery(`select * from gamestate_reliability`);
  const by = new Map(q.rows.map((r) => [r.state, r]));
  const lgr = new Map(lg.rows.map((r) => [r.state, r.rate]));
  const states = useMemo(() => STATES.flatMap(([k, l]) => {
    const r = by.get(k);
    if (!r || r.minutes < 1) return [];
    return [{ state: l, side: "For", v: r.raw_for_p90, min: r.minutes, lg: lgr.get(k) }, { state: l, side: "Against", v: r.raw_against_p90, min: r.minutes, lg: lgr.get(k) }];
  }), [q.rows, lg.rows]);
  const blocks = useMemo(() => BLOCKS.flatMap((b, i) => {
    const r = by.get(`block${i}`);
    if (!r) return [];
    const k = 15 / 90;
    return [{ b, i, side: "For", v: r.raw_for_p90 * k, lg: (lgr.get(`block${i}`) ?? 0) * k }, { b, i, side: "Against", v: r.raw_against_p90 * k, lg: (lgr.get(`block${i}`) ?? 0) * k }];
  }), [q.rows, lg.rows]);
  const maxR = Math.max(0, ...rel.rows.map((r) => Math.abs(r.split_half_r)));
  const statePlot = useMemo(() => {
    if (!states.length) return undefined;
    return (width: number) => ({
      width, height: 200, marginLeft: 64,
      x: { label: "xG per 90 minutes", grid: true, domain: [0, Math.max(2.4, ...states.map((d) => d.v ?? 0)) * 1.05] },
      y: { label: null, domain: STATES.map((s) => s[1]) },
      color: { domain: ["For", "Against"], range: [css("--s1"), css("--s2")] },
      marks: [
        Plot.tickX(states.filter((d) => d.side === "For"), { x: "lg", y: "state", stroke: css("--muted"), strokeWidth: 2, strokeDasharray: "3 2" }),
        Plot.link(STATES.map(([, l]) => { const f = states.find((d) => d.state === l && d.side === "For"), a = states.find((d) => d.state === l && d.side === "Against"); return { state: l, f: f?.v, a: a?.v }; }),
          { x1: "f", x2: "a", y1: "state", y2: "state", stroke: css("--rule-strong"), strokeWidth: 2 }),
        Plot.dot(states, { x: "v", y: "state", fill: "side", r: 6.5, stroke: css("--surface"), strokeWidth: 2 }),
        Plot.tip(states, Plot.pointer({ x: "v", y: "state", title: (d: any) => `${d.state}, ${d.side.toLowerCase()}\n${fmt.n(d.v, 2)} xG per 90 over ${fmt.n(d.min, 0)} minutes\nLeague average ${fmt.n(d.lg, 2)}` })),
      ],
    });
  }, [states]);
  const blockPlot = useMemo(() => {
    if (!blocks.length) return undefined;
    return (width: number) => ({
      width, height: 200, marginLeft: 44,
      x: { label: null, domain: BLOCKS, padding: 0.2 },
      y: { label: "xG per match in the window", grid: true },
      color: { domain: ["For", "Against"], range: [css("--s1"), css("--s2")] },
      marks: [
        Plot.line(blocks.filter((d) => d.side === "For"), { x: "b", y: "lg", stroke: css("--muted"), strokeDasharray: "3 2", strokeWidth: 1.5 }),
        Plot.line(blocks, { x: "b", y: "v", stroke: "side", strokeWidth: 2 }),
        Plot.dot(blocks, { x: "b", y: "v", fill: "side", r: 4.5, stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.tip(blocks, Plot.pointer({ x: "b", y: "v", title: (d: any) => `${d.b} min, ${d.side.toLowerCase()}\n${fmt.n(d.v, 2)} xG per match (league ${fmt.n(d.lg, 2)})` })),
      ],
    });
  }, [blocks]);
  if (!q.rows.length) return null;
  return (
    <>
      <div className="c12">
        <div className="verdict">
          <b>Not a trait.</b> We tested every score-state and match-clock pattern ("sits back when ahead", "chases the game", "concedes late") on {fmt.n(Math.max(0, ...rel.rows.map((r) => r.team_seasons)), 0)} team-seasons:
          a team's pattern in one random half of its matches says nothing about the other half (split-half r between −{fmt.n(maxR, 2)} and +{fmt.n(maxR, 2)}). What's below is what happened, not a habit to plan around.
        </div>
      </div>
      <div className="c6">
        {statePlot && <Figure title={`${name} by score`} subtitle="Expected goals for and against per 90 minutes while level, ahead and behind. Dashed tick: the league's rate in that state."
          source="FotMob (Opta) shots" plot={statePlot} alt="xG per 90 by game state"
          table={{ rows: states, cols: [["state", "State"], ["side", "Side"], ["v", "xG per 90", (v) => fmt.n(v, 2)], ["min", "Minutes", (v) => fmt.n(v, 0)], ["lg", "League", (v) => fmt.n(v, 2)]] }}>
          <Legend items={[{ label: "For", color: "var(--s1)", kind: "dot" }, { label: "Against", color: "var(--s2)", kind: "dot" }, { label: "League", color: "var(--muted)", kind: "line" }]} />
        </Figure>}
      </div>
      <div className="c6">
        {blockPlot && <Figure title={`${name} by match clock`} subtitle="Expected goals for and against per match in each 15-minute window (added time counts in the 45th and 90th-minute windows). Dashed: the league."
          source="FotMob (Opta) shots" plot={blockPlot} alt="xG by 15-minute window"
          table={{ rows: blocks, cols: [["b", "Minutes"], ["side", "Side"], ["v", "xG per match", (v) => fmt.n(v, 2)], ["lg", "League", (v) => fmt.n(v, 2)]] }}>
          <Legend items={[{ label: "For", color: "var(--s1)", kind: "line" }, { label: "Against", color: "var(--s2)", kind: "line" }, { label: "League", color: "var(--muted)", kind: "line" }]} />
        </Figure>}
      </div>
    </>
  );
}
