// One formation: its shape and roles, who uses it and when, how the same teams play
// differently in it, how it fares against other shapes and the odds, which managers make it
// work, and which players are best in each of its roles. Spec 12.9.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, seasonLabel } from "../lib/format";
import { encF, formHex } from "../lib/tactics";
import { EffectBars } from "../ui/charts";
import { Figure } from "../ui/Figure";
import { FormationPitch, Slot, slotsOf, surname } from "../ui/FormationPitch";
import { Card, ClubLink, DataTable, Loading, PageHead, PlayerLink, Seg, Tile, useTip } from "../ui/kit";

export default function Formation() {
  const f = decodeURIComponent(useParams().f ?? "");
  const p = useQuery(`select * from formation_profile where formation = ${lit(f)}`);
  const sl = useQuery(`select * from formation_slots where formation = ${lit(f)}`);
  const all = useQuery(`select formation, n from formation_profile order by n desc`);
  const r = p.rows[0];
  const slots = slotsOf(sl.rows, f);
  const rank = all.rows.findIndex((x) => x.formation === f) + 1;
  const sig = r && Math.abs(r.over_pm) > 1.96 * r.se;
  return (
    <>
      <Loading state={p} />
      <PageHead eyebrow={<><Link to="/formations">Formations</Link> · {r?.family ?? ""}</>} title={f}
        lead={r ? <>The {rank ? `${ordinalWord(rank)} most used` : ""} shape in our leagues: {fmt.n(r.n)} league starts since {r.first} by {fmt.n(r.clubs)} clubs, {fmt.pct(r.share_recent, 1)} of starts in the last two seasons.
          Teams that pick it go in with a {fmt.pct(r.p_win)} average chance of winning, {r.p_win < 0.36 ? "so it's an underdog's shape" : r.p_win > 0.42 ? "so it's a favourite's shape" : "about the league norm"}.</> : `No league starts in a ${f}.`} />
      {r && (
        <div className="tiles">
          <Tile label="League starts" value={fmt.n(r.n)} delta={`${fmt.n(r.n_fm)} since 2024-25`} />
          <Tile label="Share of recent starts" value={fmt.pct(r.share_recent, 1)} delta="last two seasons, all our leagues" />
          <Tile label="Points v the odds" value={`${fmt.signed(r.over_pm, 2)}`} delta={`± ${fmt.n(1.96 * r.se, 2)} per match · ${sig ? "a real difference" : "no detectable edge"}`}
                tone={sig ? (r.over_pm > 0 ? "up" : "down") : undefined} />
          <Tile label="Points per match" value={fmt.n(r.ppg, 2)} delta={`${fmt.n(r.xppg, 2)} expected from the odds`} />
        </div>
      )}
      <div className="grid">
        <div className="c4">
          <Card title="The shape" sub={slots.length ? "Slots as FotMob draws them; roles from each slot's depth and width." : "No FotMob slot data: this shape only appears in the Transfermarkt era."}>
            {slots.length > 0 && <div className="fpitch"><FormationPitch slots={slots} label={`${f} slots and roles`} /></div>}
          </Card>
        </div>
        <div className="c8"><Usage f={f} /></div>
        <Style f={f} />
        <Opponents f={f} />
        <Teams f={f} />
        <Managers f={f} />
        {slots.length > 0 && <Players f={f} slots={slots} />}
        <PlayersTM f={f} />
      </div>
    </>
  );
}

const ordinalWord = (n: number) => (n === 1 ? "" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`);

function Usage({ f }: { f: string }) {
  const q = useQuery(`select competition_id, season, n, total from formation_trends where kind = 'formation' and formation = ${lit(f)}`);
  const d = useMemo(() => ({ rows: q.rows.map((r): Row => ({ ...r, share: r.n / r.total })) }), [q.rows]);
  const overall = useMemo(() => {
    const m = new Map<number, { n: number; t: number }>();
    d.rows.forEach((r) => { const a = m.get(r.season) ?? { n: 0, t: 0 }; a.n += r.n; a.t += r.total; m.set(r.season, a); });
    return [...m.entries()].map(([season, a]) => ({ season, share: a.n / a.t })).sort((a, b) => a.season - b.season);
  }, [d.rows]);
  const plot = useMemo(() => {
    if (!d.rows.length) return undefined;
    return (width: number) => ({
      width, height: 300,
      x: { label: null, tickFormat: (v: number) => `'${String(v % 100).padStart(2, "0")}` },
      y: { label: "Share of starts in leagues where it's used", tickFormat: (v: number) => fmt.pct(v), grid: true },
      marks: [
        Plot.ruleX([2023.5], { stroke: css("--rule-strong"), strokeDasharray: "2 3" }),
        Plot.line(d.rows, { x: "season", y: "share", z: "competition_id", stroke: css("--muted"), strokeOpacity: 0.4 }),
        Plot.line(overall, { x: "season", y: "share", stroke: formHex(f) === css("--muted") ? css("--s1") : formHex(f), strokeWidth: 2.5 }),
        Plot.dot(overall, { x: "season", y: "share", fill: formHex(f) === css("--muted") ? css("--s1") : formHex(f), r: 3.5, stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.tip(d.rows, Plot.pointer({ x: "season", y: "share", z: "competition_id", title: (r: any) => `${LEAGUES[r.competition_id] ?? r.competition_id} ${seasonLabel(r.season, r.competition_id)}\n${r.n} of ${r.total} starts (${fmt.pct(r.share, 1)})` })),
      ],
    });
  }, [d.rows, overall]);
  return plot ? (
    <Figure title={`How often teams start in a ${f}`} subtitle="Share of league starts each season: all our leagues together (thick) and each league (thin). Transfermarkt labels to 2023-24, FotMob's after the dashed line, so part of any jump there is the label."
            source="Transfermarkt, FotMob" plot={plot} alt={`${f} usage by season`}
            table={{ rows: d.rows, cols: [["competition_id", "League"], ["season", "Season"], ["n", "Starts"], ["share", "Share", (v) => fmt.pct(v, 1)]] }} />
  ) : <Card title="Usage">No league starts recorded.</Card>;
}

const PHRASE: Record<string, [string, string]> = {
  possession: ["have more of the ball", "have less of the ball"], territory: ["play higher up the pitch", "play deeper"],
  long_share: ["go long more", "go long less"], crosses: ["cross more", "cross less"], press: ["press less", "press harder"],
  op_xg_for: ["create more", "create less"], op_xg_against: ["concede more chances", "concede fewer chances"],
  box_for: ["get into the box more", "get into the box less"], box_against: ["let opponents into the box more", "keep opponents out of the box"],
};

function Style({ f }: { f: string }) {
  const q = useQuery(`select * from formation_style where formation = ${lit(f)}`);
  if (!q.rows.length) return null;
  const n = Math.max(...q.rows.map((r) => r.team_seasons));
  const order = ["possession", "territory", "long_share", "crosses", "press", "box_for", "op_xg_for", "box_against", "op_xg_against"];
  const rows = order.map((k) => q.rows.find((r) => r.stat === k)).filter(Boolean) as Row[];
  const big = rows.filter((r) => Math.abs(r.diff) > 1.96 * (r.se ?? Infinity));
  return (
    <div className="c12">
      <Card title={big.length ? `In a ${f}, the same teams ${big.map((r) => PHRASE[r.stat]?.[r.diff > 0 ? 0 : 1] ?? r.label).join(", ")}`
                              : `A ${f} barely changes how a team plays`}
            sub={<>Each stat in a {f} minus the same team's average in its other shapes that season ({n} team-seasons that used both, 2024-25 onward), after adjusting every match for the strength gap and venue, so it isn't just the fixtures a team picks the shape for. Units are the stat's own (possession and territory in percentage points). Bars crossing zero: no detectable change.</>}
            foot="FotMob (Opta) team stats">
        <EffectBars rows={rows.map((r) => ({ label: r.label, b: r.diff, se: r.se ?? 0, color: Math.abs(r.diff) > 1.96 * (r.se ?? Infinity) ? undefined : "var(--muted)",
          note: <div className="muted">{r.team_seasons} team-seasons, {r.matches} matches in a {f}</div> }))} />
      </Card>
    </div>
  );
}

function Opponents({ f }: { f: string }) {
  const q = useQuery(`select * from formation_matchups where formation = ${lit(f)} and n >= 50 order by n desc`);
  if (!q.rows.length) return null;
  return (
    <div className="c6">
      <Card title={`A ${f} against each shape`} sub="Points per match beyond the closing odds, by the opponent's formation (since 2013, 50+ matches). Across all pairings this is no more than chance (see Tactics)."
            foot="Transfermarkt, FotMob, closing odds via football-data.co.uk">
        <EffectBars unit=" pts/match" rows={q.rows.map((r) => ({ label: <Link to={`/formation/${encF(r.opp_formation)}`}>v {r.opp_formation}</Link>, b: r.res, se: r.se, color: "var(--muted)",
          note: <div className="muted">{fmt.n(r.n)} matches · {fmt.n(r.ppg, 2)} points v {fmt.n(r.xppg, 2)} expected</div> }))} />
      </Card>
    </div>
  );
}

function Teams({ f }: { f: string }) {
  const q = useQuery(`select s.club_id, c.name, count(*) as n, min(s.season) as first, max(s.season) as last, avg(s.pts) as ppg,
      avg(s.pts - s.xpts) as over, arg_max(s.manager, s.match_date) as manager, arg_max(s.manager_slug, s.match_date) as slug
    from team_shape s left join clubs c using (club_id) where s.formation = ${lit(f)} group by s.club_id, c.name having count(*) >= 5`);
  return (
    <div className="c6">
      <Card title={`Who plays a ${f}`} sub="Clubs with 5+ league starts in it since 2013, and the last manager to pick it.">
        <DataTable rows={q.rows} initialSort={{ key: "n", desc: true }} limit={12} maxHeight={420} cols={[
          { key: "name", label: "Club", fmt: (v, r) => <ClubLink id={r.club_id} name={v ?? r.club_id} /> },
          { key: "n", label: "Starts", num: true },
          { key: "last", label: "Last", fmt: (v) => String(v) },
          { key: "manager", label: "Manager", fmt: (v, r) => (r.slug ? <Link to={`/manager/${r.slug}`}>{v}</Link> : v ?? "–") },
          { key: "over", label: "v odds", num: true, fmt: (v) => <span style={{ color: v >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, 2)}</span> },
        ]} />
      </Card>
    </div>
  );
}

function Managers({ f }: { f: string }) {
  const q = useQuery(`select * from manager_formation where formation = ${lit(f)} and n >= 10`);
  const allQ = useQuery(`select verdict, count(*) as k from manager_formation where n >= 20 group by verdict`);
  const tot = allQ.rows.reduce((a, r) => a + r.k, 0), wins = allQ.rows.find((r) => r.verdict === "better than the odds")?.k ?? 0,
    losses = allQ.rows.find((r) => r.verdict === "worse than the odds")?.k ?? 0;
  return (
    <div className="c12">
      <Card title={`Managers in a ${f}: who made it work`}
            sub={<>Points per match beyond the closing odds for each manager's league matches in this shape since 2013 (10+). Across every manager and shape with 20+ matches, {wins} of {tot} beat the odds and {losses} fell short at 95% confidence, about what luck alone would give ({fmt.n(tot * 0.025, 0)} each way). So a manager's record in one shape is mostly noise; the interval says how much.</>}>
        <DataTable rows={q.rows} initialSort={{ key: "n", desc: true }} limit={15} cols={[
          { key: "manager", label: "Manager", fmt: (v, r) => <Link to={`/manager/${r.manager_slug}`}>{v}</Link> },
          { key: "n", label: "Matches", num: true },
          { key: "clubs", label: "Clubs", num: true },
          { key: "last", label: "Last", fmt: (v) => String(v) },
          { key: "ppg", label: "PPG", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "over_pm", label: "v odds / match", num: true, fmt: (v, r) => <span style={{ color: r.verdict === "better than the odds" ? "var(--up-text)" : r.verdict === "worse than the odds" ? "var(--critical)" : undefined }}>
            {fmt.signed(v, 2)} <span className="muted xs">± {fmt.n(1.96 * r.se, 2)}</span></span> },
          { key: "verdict", label: "Verdict" },
        ]} />
      </Card>
    </div>
  );
}

function Players({ f, slots }: { f: string; slots: Slot[] }) {
  const roles = slots.filter((s) => s.role !== "GK").map((s) => s.role);
  const [role, setRole] = useState<string>("all");
  const q = useQuery(`select p.*, c.name as club from player_formation p left join clubs c using (club_id)
                      where p.formation = ${lit(f)} and p.starts >= 5`);
  const tip = useTip();
  // ratings shrunk toward the shape's average by starts (10 starts' worth of prior), so five
  // good games don't top the list
  const rated = useMemo(() => {
    const rs = q.rows.filter((r) => r.rating != null);
    const mu = rs.reduce((a, r) => a + r.rating * r.starts, 0) / Math.max(1, rs.reduce((a, r) => a + r.starts, 0));
    return q.rows.map((r): Row => ({ ...r, adj: r.rating == null ? null : mu + ((r.rating - mu) * r.starts) / (r.starts + 10) }));
  }, [q.rows]);
  const best = useMemo(() => {
    const m = new Map<string, Row>();
    rated.filter((r) => r.starts >= 8 && r.adj != null).forEach((r) => {
      const cur = m.get(r.role);
      if (!cur || r.adj > cur.adj) m.set(r.role, r);
    });
    return m;
  }, [rated]);
  const xi: Slot[] = slots.map((s) => {
    const b = best.get(s.role);
    return { ...s, name: b ? surname(b.name) : undefined, value: b ? fmt.n(b.rating, 2) : undefined };
  });
  const rows = role === "all" ? rated : rated.filter((r) => r.role === role);
  return (
    <>
      <div className="c4">
        <Card title={`Best ${f} XI since 2024-25`} sub="The best player in each slot: FotMob rating, 8+ starts in this shape, shrunk toward the shape's average by starts so a short hot run doesn't win. FotMob ratings run a little high in some leagues. Hover a slot for the detail.">
          <div className="fpitch">
            <FormationPitch slots={xi} label={`Best players in a ${f}`} onHover={(e, s) => {
              const b = s && best.get(s.role);
              if (!s || !b) { tip.hide(); return; }
              tip.show(e, <><b>{b.name} · {s.role}</b><div>{b.club} · {b.starts} starts · rating {fmt.n(b.rating, 2)}</div>
                <div className="muted">{b.rating_diff != null ? `${fmt.signed(b.rating_diff, 2)} v the player's other shapes` : "no other shape to compare"}</div></>);
            }} />
          </div>
          {tip.node}
        </Card>
      </div>
      <div className="c8">
        <Card title={`Who plays a ${f} best`} right={<Seg label="Role" value={role} onChange={setRole} options={[["all", "All"], ...[...new Set(roles)].map((r) => [r, r] as [string, string])]} />}
              sub="FotMob era, 5+ starts in this shape, sorted by the shrunk rating. 'v other shapes' is the player's rating here minus the same player's rating in every other formation (5+ starts there): who thrives in this system and who doesn't.">
          <DataTable rows={rows} initialSort={{ key: "adj", desc: true }} limit={25} maxHeight={520} cols={[
            { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v} /> },
            { key: "club", label: "Club", fmt: (v, r) => (v ? <ClubLink id={r.club_id} name={v} /> : "–") },
            { key: "role", label: "Role" },
            { key: "starts", label: "Starts", num: true },
            { key: "rating", label: "Rating", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "adj", label: "Shrunk", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "rating_diff", label: "v other shapes", num: true, fmt: (v) => v == null ? "–" : <span style={{ color: v >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, 2)}</span> },
            { key: "xgxa_p90", label: "xG+xA /90", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "def_p90", label: "Def. actions /90", num: true, fmt: (v) => fmt.n(v, 1) },
            { key: "res", label: "Team v odds", num: true, fmt: (v) => fmt.signed(v, 2) },
          ]} />
        </Card>
      </div>
    </>
  );
}

function PlayersTM({ f }: { f: string }) {
  const q = useQuery(`select t.*, p.name from player_formation_tm t left join players p using (player_id)
                      where t.formation = ${lit(f)} and t.starts >= 10 order by t.starts desc limit 300`);
  if (!q.rows.length) return null;
  return (
    <div className="c12">
      <Card title={`The ${f} regulars, 2013-14 to 2023-24`} sub="Starts in this shape from Transfermarkt line-ups (10+), with goals and assists per 90 and the team's points beyond the odds in those matches.">
        <DataTable rows={q.rows} initialSort={{ key: "starts", desc: true }} limit={20} maxHeight={480} cols={[
          { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
          { key: "role", label: "Role", fmt: (v) => v ?? "–" },
          { key: "starts", label: "Starts", num: true },
          { key: "first", label: "Seasons", fmt: (v, r) => `${v}–${String(r.last).slice(2)}` },
          { key: "ga_p90", label: "G+A /90", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "res", label: "Team v odds", num: true, fmt: (v) => fmt.signed(v, 2) },
        ]} />
      </Card>
    </div>
  );
}

