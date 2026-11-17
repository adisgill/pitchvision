// Tactics research: how leagues' shapes changed, whether a manager's shape and style follow to
// a new club, whether formation matchups beat the market, and which team traits are real.
// Spec 12.8.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Row, useQuery } from "../db";
import { css, div, fmt, LEAGUES, SHORT, slot } from "../lib/format";
import { formHex, formKey, FORMATIONS, formColor } from "../lib/tactics";
import { Figure } from "../ui/Figure";
import { Card, ClubLink, DataTable, Legend, LeagueSelect, Loading, PageHead, Tile, useParam } from "../ui/kit";

const TREND_LEAGUES = ["GB1", "ES1", "L1", "IT1", "FR1", "NL1", "PO1", "GB2"];

export default function Tactics() {
  const shape = useQuery(`select * from manager_shape`);
  const style = useQuery(`select * from manager_style_study`);
  const test = useQuery(`select * from formation_matchup_test`);
  const rel = useQuery(`select * from style_reliability`);
  const grel = useQuery(`select * from gamestate_reliability`);
  const counts = useQuery(`select (select count(*) from team_shape) as tm, (select count(*) from manager_spells) as sp`);
  const s = shape.rows[0], t = test.rows[0];
  const c = counts.rows[0];
  const poss = style.rows.find((r) => r.trait === "possession");
  const maxG = Math.max(0, ...grel.rows.map((r) => Math.abs(r.split_half_r)));
  return (
    <>
      <PageHead eyebrow="Research · tactics" title="Shapes, styles and the managers who pick them" right={<Link className="btn" to="/formations">Every formation →</Link>}
        lead={<>Formations for {c ? fmt.n(c.tm) : "every"} team-match since 2013, Opta team stats since 2024-25 and {c ? fmt.n(c.sp) : "every"} managerial spell.
          The question every time: is it a real, repeatable pattern, or a story told after the fact?</>} />
      <Loading state={shape} />
      <div className="tiles">
        {s && <Tile label="Formation follows the manager" value={`${fmt.n(s.b_manager, 2)} v ${fmt.n(s.b_club, 2)}`}
                    delta={`weight on the manager's old shape v the club's, ${fmt.n(s.moves)} moves`} />}
        {poss && <Tile label="Style follows the squad" value={`${fmt.n(poss.b_club, 2)} v ${fmt.n(poss.b_manager, 2)}`}
                       delta={`possession: weight on the club's old style v the manager's, ${poss.moves} moves`} />}
        {t && <Tile label="Formation matchups v the market" value={`p = ${fmt.n(t.p, 2)}`} delta={`no detectable effect in ${fmt.n(t.matches)} matches`} />}
        {grel.rows.length > 0 && <Tile label="Score-state habits" value={`r ≈ ${fmt.n(maxG, 2)}`} delta="split-half: not a repeatable team trait" />}
      </div>

      <Trends />

      <section className="section">
        <h2>Does the shape follow the manager?</h2>
        <div className="grid">{s && <ShapeStudy s={s} />}</div>
      </section>

      <section className="section">
        <h2>Does the style follow the manager?</h2>
        <div className="grid"><div className="c12">{style.rows.length > 0 && <StyleStudy rows={style.rows} />}</div></div>
      </section>

      <section className="section">
        <h2>Formation against formation</h2>
        <div className="grid"><div className="c12">{t && <Matchups t={t} />}</div></div>
      </section>

      <section className="section">
        <h2>What is a trait, and what is noise</h2>
        <div className="grid"><div className="c12">{rel.rows.length > 0 && <Reliability rows={rel.rows} g={grel.rows} />}</div></div>
      </section>

      <section className="section">
        <h2>Reputations people "just know"</h2>
        <Reputations />
      </section>

      <section className="section">
        <h2>Managers</h2>
        <Directory />
      </section>
    </>
  );
}

function Trends() {
  const [lg, setLg] = useParam("league", "GB1");
  const q = useQuery(`select * from formation_trends`);
  const fam = useMemo(() => q.rows.filter((r) => r.kind === "family" && r.formation === "Back three" && TREND_LEAGUES.includes(r.competition_id)), [q.rows]);
  const forms = useMemo(() => {
    const rows = q.rows.filter((r) => r.kind === "formation" && r.competition_id === lg);
    const agg = new Map<string, Row>();
    rows.forEach((r) => {
      const k = `${r.season}|${formKey(r.formation)}`;
      const a = agg.get(k) ?? { season: r.season, formation: formKey(r.formation), share: 0, n: 0 };
      a.share += r.share; a.n += r.n; agg.set(k, a);
    });
    return [...agg.values()];
  }, [q.rows, lg]);
  const keys = [...FORMATIONS, "Other"];
  const latest = fam.filter((r) => r.competition_id === lg).sort((a, b) => b.season - a.season)[0];
  const first = fam.filter((r) => r.competition_id === lg).sort((a, b) => a.season - b.season)[0];
  const famPlot = useMemo(() => {
    if (!fam.length) return undefined;
    return (width: number) => ({
      width, height: 300, marginRight: 40,
      x: { label: null, tickFormat: (v: number) => `'${String(v % 100).padStart(2, "0")}` },
      y: { label: "Share of starts with a back three or five", tickFormat: (v: number) => fmt.pct(v), grid: true },
      marks: [
        Plot.ruleX([2023.5], { stroke: css("--rule-strong"), strokeDasharray: "2 3" }),
        Plot.text([{ x: 2023.5 }], { x: "x", frameAnchor: "top", text: () => "provider switch", dx: 4, textAnchor: "start", fill: css("--muted"), fontSize: 10 }),
        Plot.line(fam.filter((r) => r.competition_id !== lg), { x: "season", y: "share", z: "competition_id", stroke: css("--muted"), strokeOpacity: 0.45, strokeWidth: 1.25 }),
        Plot.line(fam.filter((r) => r.competition_id === lg), { x: "season", y: "share", stroke: css("--s1"), strokeWidth: 2.5 }),
        Plot.dot(fam.filter((r) => r.competition_id === lg), { x: "season", y: "share", fill: css("--s1"), r: 3.5, stroke: css("--surface"), strokeWidth: 1.5 }),
        Plot.text(fam.filter((r) => r.season === Math.max(...fam.map((x) => x.season))), { x: "season", y: "share", text: (r: any) => SHORT[r.competition_id] ?? r.competition_id, dx: 6, textAnchor: "start", fontSize: 10, fill: (r: any) => (r.competition_id === lg ? css("--text") : css("--muted")) }),
        Plot.tip(fam, Plot.pointer({ x: "season", y: "share", z: "competition_id", title: (r: any) => `${LEAGUES[r.competition_id]} ${r.season}\n${fmt.pct(r.share)} of starts in a back three or five (${r.n} of ${r.total})` })),
      ],
    });
  }, [fam, lg]);
  const formPlot = useMemo(() => {
    if (!forms.length) return undefined;
    return (width: number) => ({
      width, height: 300,
      x: { label: null, tickFormat: (v: number) => `'${String(v % 100).padStart(2, "0")}` },
      y: { label: "Share of starts", tickFormat: (v: number) => fmt.pct(v), domain: [0, 1] },
      color: { domain: keys, range: keys.map((k) => formHex(k === "Other" ? null : k)) },
      marks: [
        Plot.areaY(forms, { x: "season", y: "share", fill: "formation", order: keys, curve: "monotone-x", stroke: css("--surface"), strokeWidth: 1 }),
        Plot.ruleX([2023.5], { stroke: css("--text"), strokeOpacity: 0.5, strokeDasharray: "2 3" }),
        Plot.tip(forms, Plot.pointer(Plot.stackY({ x: "season", y: "share", z: "formation", order: keys, title: (r: any) => `${r.season}: ${r.formation}\n${fmt.pct(r.share)} of starts (${r.n})` }))),
      ],
    });
  }, [forms]);
  return (
    <section className="section">
      <h2>How the leagues' shapes changed</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <LeagueSelect value={lg} onChange={setLg} leagues={TREND_LEAGUES} />
      </div>
      <div className="grid">
        <div className="c6">
          {famPlot && <Figure title={latest && first ? `${LEAGUES[lg]}: back three in ${fmt.pct(latest.share)} of starts, from ${fmt.pct(first.share)} in ${first.season}` : "Back threes"}
                              subtitle="Share of league starts with three or five at the back, every league (grey) and the selected one. Transfermarkt labels to 2023-24, FotMob's after the dashed line: some of the jump there is the provider, not the game."
                              source="Transfermarkt, FotMob" plot={famPlot} alt="Back-three share by season"
                              table={{ rows: fam, cols: [["competition_id", "League"], ["season", "Season"], ["share", "Back three", (v) => fmt.pct(v)], ["n", "Starts"]] }} />}
        </div>
        <div className="c6">
          {formPlot && <Figure title={`${LEAGUES[lg]}: every shape, season by season`} subtitle="Share of league starts in each formation. Rarer shapes are grouped as Other."
                               source="Transfermarkt, FotMob" plot={formPlot} alt="Formation shares by season"
                               table={{ rows: forms, cols: [["season", "Season"], ["formation", "Formation"], ["share", "Share", (v) => fmt.pct(v)], ["n", "Starts"]] }}>
            <Legend items={keys.map((k) => ({ label: k, color: formColor(k === "Other" ? null : k), kind: "rect" as const }))} />
          </Figure>}
        </div>
      </div>
    </section>
  );
}

function ShapeStudy({ s }: { s: Row }) {
  const mv = useQuery(`select * from manager_shape_moves`);
  const plot = useMemo(() => {
    if (!mv.rows.length) return undefined;
    const d = mv.rows.map((r) => ({ ...r, jx: r.mgr_prev_b3 + (Math.sin(r.n_new * 7.1 + r.n_prev) * 0.012), jy: r.new_b3 + (Math.cos(r.n_club * 3.3) * 0.012) }));
    return (width: number) => ({
      width, height: 380,
      x: { label: "Manager's back-three share at the previous club", tickFormat: (v: number) => fmt.pct(v), domain: [-0.03, 1.03] },
      y: { label: "Back-three share in the new spell", tickFormat: (v: number) => fmt.pct(v), domain: [-0.03, 1.03], grid: true },
      color: { type: "linear" as const, domain: [0, 1], range: [css("--s1"), css("--s2")], legend: false },
      marks: [
        Plot.line([[0, 0], [1, 1]], { stroke: css("--rule-strong"), strokeDasharray: "3 3" }),
        Plot.dot(d, { x: "jx", y: "jy", fill: "club_prev_b3", r: 4, fillOpacity: 0.8, stroke: css("--surface"), strokeWidth: 1 }),
        Plot.tip(d, Plot.pointer({ x: "jx", y: "jy", title: (r: any) => `${r.manager}: ${r.from_team} → ${r.to_team} (${new Date(r.start_date).getUTCFullYear()})\nback three: ${fmt.pct(r.mgr_prev_b3)} before, club ${fmt.pct(r.club_prev_b3)} before, ${fmt.pct(r.new_b3)} in the new spell\nshapes: ${r.mgr_prev_mode} · ${r.club_prev_mode} · ${r.new_mode}` })),
      ],
    });
  }, [mv.rows]);
  return (
    <>
      <div className="c8">
        {plot && <Figure title="A new club's shape moves toward the manager's old one"
                         subtitle={<>Each dot is a manager moving club (15+ matches in both spells and in the club's previous one; same provider era). Dots on the diagonal kept their shape; colour is the club's back-three share before (blue none, red all). Shapes from the first 38 matches of the new spell.</>}
                         source="Transfermarkt, FotMob" plot={plot} alt="Back-three share before and after a managerial move"
                         table={{ rows: mv.rows, cols: [["manager", "Manager"], ["from_team", "From"], ["to_team", "To"], ["mgr_prev_b3", "Manager before", (v) => fmt.pct(v)], ["club_prev_b3", "Club before", (v) => fmt.pct(v)], ["new_b3", "New spell", (v) => fmt.pct(v)]] }}>
          <Legend items={[{ label: "Club played no back three before", color: "var(--s1)", kind: "dot" }, { label: "Club always did", color: "var(--s2)", kind: "dot" }]} />
        </Figure>}
      </div>
      <div className="c4 stack" style={{ gap: 16 }}>
        <Card title="Both pull; the manager pulls harder" sub="Back-three share in the new spell, regressed on both. 95% intervals from 2,000 bootstrap resamples of the moves.">
          <div className="coefs">
            {([["Manager's previous club", s.b_manager, s.b_manager_lo, s.b_manager_hi, "var(--s1)"],
               ["Club's previous manager", s.b_club, s.b_club_lo, s.b_club_hi, "var(--s2)"]] as [string, number, number, number, string][]).map(([l, b, lo, hi, c]) => (
              <div key={l} className="coef">
                <div className="row between"><span>{l}</span><b className="num">{fmt.n(b, 2)}</b></div>
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                  <rect x={0} y={4} width={100} height={2} fill="var(--grid)" />
                  <rect x={lo * 100} y={2} width={(hi - lo) * 100} height={6} rx={1} fill={c} opacity={0.35} />
                  <rect x={b * 100 - 0.6} y={0} width={1.2} height={10} fill={c} />
                </svg>
                <div className="muted xs">95% interval {fmt.n(lo, 2)} to {fmt.n(hi, 2)} (scale 0 to 1)</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Same exact formation?">
          <p className="small" style={{ margin: 0 }}>The new spell's main formation matches the manager's old one in <b>{fmt.pct(s.same_mode_manager)}</b> of moves and the club's old one in <b>{fmt.pct(s.same_mode_club)}</b>.
            By chance (shuffling the managers) it would be {fmt.pct(s.same_mode_chance)}. When manager and club disagreed on back three v back four ({s.informative_moves} moves), the new spell went the manager's way {fmt.pct(s.follows_manager_share)} of the time.</p>
        </Card>
      </div>
    </>
  );
}

function StyleStudy({ rows }: { rows: Row[] }) {
  const d = rows.flatMap((r) => [
    { label: r.label.split(" (")[0], who: "Manager's previous club", b: r.b_manager, lo: r.b_manager_lo, hi: r.b_manager_hi, n: r.moves },
    { label: r.label.split(" (")[0], who: "Club's previous manager", b: r.b_club, lo: r.b_club_lo, hi: r.b_club_hi, n: r.moves },
  ]);
  const order = [...rows].sort((a, b) => b.b_manager - a.b_manager).map((r) => r.label.split(" (")[0]);
  const plot = (width: number) => ({
    width, height: order.length * 46 + 60, marginLeft: 210,
    x: { label: "Weight on the new spell's style (1 = carried over in full)", grid: true, domain: [-0.3, 0.9] },
    y: { label: null, domain: order },
    color: { domain: ["Manager's previous club", "Club's previous manager"], range: [css("--s1"), css("--s2")] },
    marks: [
      Plot.ruleX([0], { stroke: css("--axis") }),
      ...([["Manager's previous club", -6], ["Club's previous manager", 6]] as [string, number][]).flatMap(([who, dy]) => [
        Plot.ruleY(d.filter((r) => r.who === who), { y: "label", x1: "lo", x2: "hi", stroke: "who", strokeWidth: 2, dy }),
        Plot.dot(d.filter((r) => r.who === who), { y: "label", x: "b", fill: "who", r: 5, stroke: css("--surface"), strokeWidth: 1.5, dy }),
      ]),
      Plot.tip(d, Plot.pointer({ y: "label", x: "b", title: (r: any) => `${r.label}\n${r.who}: ${fmt.n(r.b, 2)} (95% ${fmt.n(r.lo, 2)} to ${fmt.n(r.hi, 2)})\n${r.n} moves` })),
    ],
  });
  return (
    <Figure title="Style travels less than shape: the squad sets most of it"
            subtitle={<>FotMob era, {rows[0]?.moves} moves. Each spell's style is a z-score against the league that season; the new spell's is regressed on the manager's previous spell and the club's previous one. Territory, pressing and directness carry some of the manager; open-play xG and crossing don't.</>}
            source="FotMob (Opta) team stats" plot={plot} alt="How much style carries over with a manager"
            table={{ rows: d, cols: [["label", "Trait"], ["who", "Source"], ["b", "Weight", (v) => fmt.n(v, 2)], ["lo", "Low", (v) => fmt.n(v, 2)], ["hi", "High", (v) => fmt.n(v, 2)]] }}>
      <Legend items={[{ label: "Manager's previous club", color: "var(--s1)", kind: "dot" }, { label: "Club's previous manager", color: "var(--s2)", kind: "dot" }]} />
    </Figure>
  );
}

function Matchups({ t }: { t: Row }) {
  const q = useQuery(`select * from formation_matchups`);
  const order = String(t.formations).split(", ");
  const lim = 0.25;
  const plot = useMemo(() => {
    if (!q.rows.length) return undefined;
    return (width: number) => ({
      width: Math.min(width, 640), height: Math.min(width, 640) * 0.9, marginLeft: 70, marginBottom: 46,
      x: { label: "Opponent's formation", domain: order, tickRotate: 0 },
      y: { label: "Team's formation", domain: order },
      marks: [
        Plot.cell(q.rows, { x: "opp_formation", y: "formation", fill: (r: any) => (r.n < 50 ? css("--grid") : div(r.res / lim)), inset: 1.5, rx: 2 }),
        Plot.text(q.rows, { x: "opp_formation", y: "formation", text: (r: any) => (r.n < 50 ? "" : fmt.signed(r.res, 2)), fill: css("--text"), fontSize: 10.5 }),
        Plot.tip(q.rows, Plot.pointer({ x: "opp_formation", y: "formation", title: (r: any) => `${r.formation} v ${r.opp_formation}\n${fmt.n(r.n)} team-matches\n${fmt.n(r.ppg, 2)} points per match v ${fmt.n(r.xppg, 2)} expected by the odds\n${fmt.signed(r.res, 2)} ± ${fmt.n(1.96 * r.se, 2)}` })),
      ],
    });
  }, [q.rows]);
  return plot ? (
    <Figure title={t.p > 0.05 ? "No formation beats another once the odds are known" : "Some formation pairings beat the odds"}
            subtitle={<>Points per match above (blue) or below (red) the closing line's expectation, for the team in the row's shape against the column's ({fmt.n(t.matches)} matches since 2013, the 8 most common shapes; grey: fewer than 50).
              A permutation test shuffling results within each league-season finds pairings explain no more than chance (p = {fmt.n(t.p, 2)}). The market already prices whatever a shape matchup is worth.</>}
            source="Transfermarkt, FotMob, closing odds via football-data.co.uk" plot={plot} alt="Formation matchup grid"
            table={{ rows: q.rows, cols: [["formation", "Formation"], ["opp_formation", "Opponent"], ["n", "Matches"], ["res", "vs odds", (v) => fmt.signed(v, 2)], ["se", "SE", (v) => fmt.n(v, 2)]] }} />
  ) : null;
}

const TEND: Record<string, string> = {
  ahead_for: "xG for when ahead (v level)", ahead_against: "xG against when ahead (v level)", behind_for: "xG for when behind (v level)",
  behind_against: "xG against when behind (v level)", late_for: "Share of xG created after 75'", late_against: "Share of xG conceded after 75'",
  early_for: "Share of xG created in the first 15'", early_against: "Share of xG conceded in the first 15'",
};

function Reliability({ rows, g }: { rows: Row[]; g: Row[] }) {
  const d = [
    ...rows.map((r) => ({ label: r.label.split(" (")[0], rel: r.season_rel, group: r.kind === "style" ? "Style" : r.trait.endsWith("_for") ? "Attack" : "Defence", n: r.matches_for_07 })),
    ...g.map((r) => ({ label: TEND[r.tendency] ?? r.tendency, rel: Math.max(0, r.season_rel), group: "Score state & clock", n: Infinity })),
  ].sort((a, b) => b.rel - a.rel);
  const groups = ["Style", "Attack", "Defence", "Score state & clock"];
  const plot = (width: number) => ({
    width, height: d.length * 21 + 50, marginLeft: 250, marginRight: 50,
    x: { label: "Reliability over a full season (share of the spread between teams that is stable)", domain: [0, 1], grid: true },
    y: { label: null, domain: d.map((r) => r.label) },
    color: { domain: groups, range: [slot(1), slot(3), slot(2), css("--muted")] },
    marks: [
      Plot.barX(d, { y: "label", x: "rel", fill: "group", insetTop: 3, insetBottom: 3, rx: 2 }),
      Plot.ruleX([0.7], { stroke: css("--text"), strokeDasharray: "3 3" }),
      Plot.text(d, { y: "label", x: "rel", text: (r: any) => fmt.n(r.rel, 2), dx: 6, textAnchor: "start", fontSize: 10, fill: css("--text-2") }),
      Plot.tip(d, Plot.pointer({ y: "label", x: "rel", title: (r: any) => `${r.label}\nseason reliability ${fmt.n(r.rel, 2)}\n${Number.isFinite(r.n) ? `about ${fmt.n(r.n, 0)} matches needed for 0.7` : "never reaches 0.7"}` })),
    ],
  });
  return (
    <Figure title="How a team plays is a fingerprint; how it defends set pieces is mostly luck"
            subtitle="Split-half reliability: each team-season's matches split in two (odd v even for style; a random half for score state), the league average removed, the halves correlated, and stepped up to a full season. Above the dashed line (0.7) we call it a trait and the Style tab will describe it; below it, a team's number is mostly noise."
            source="FotMob (Opta) team stats and shots, 2024-25 onward" plot={plot} alt="Reliability of team traits"
            table={{ rows: d, cols: [["label", "Stat"], ["group", "Group"], ["rel", "Season reliability", (v) => fmt.n(v, 2)]] }}>
      <Legend items={groups.map((k, i) => ({ label: k, color: i === 3 ? "var(--muted)" : `var(--s${[1, 3, 2][i]})`, kind: "rect" as const }))} />
    </Figure>
  );
}

function Directory() {
  const [text, setText] = useState("");
  const q = useQuery(`select manager, manager_slug, count(distinct club_id) as clubs, sum(n) as n,
      sum(over_pm * n_odds) / nullif(sum(n_odds), 0) as over, arg_max(team, end_date) as team, arg_max(club_id, end_date) as club_id,
      max(end_date) as last, arg_max(top_formation, n) as shape
    from manager_spells group by manager, manager_slug having sum(n) >= 30`);
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return t ? q.rows.filter((r) => String(r.manager).toLowerCase().includes(t) || String(r.team).toLowerCase().includes(t)) : q.rows;
  }, [q.rows, text]);
  return (
    <Card title="Every manager with 30+ league matches" sub="Career totals across all clubs since 2012-13. Open one for spell-by-spell results, shapes and style."
          right={<input type="search" placeholder="Search a manager or club" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search managers" style={{ maxWidth: 240 }} />}>
      <Loading state={q} />
      <DataTable rows={rows} initialSort={{ key: "n", desc: true }} limit={50} cols={[
        { key: "manager", label: "Manager", fmt: (v, r) => <Link to={`/manager/${r.manager_slug}`}><b>{v}</b></Link> },
        { key: "team", label: "Latest club", fmt: (v, r) => <ClubLink id={r.club_id} name={v} /> },
        { key: "last", label: "Until", fmt: (v) => fmt.date(v) },
        { key: "clubs", label: "Clubs", num: true },
        { key: "n", label: "Matches", num: true },
        { key: "over", label: "vs odds / match", num: true, fmt: (v) => v == null ? "–" : <span style={{ color: v >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, 2)}</span> },
        { key: "shape", label: "Main shape" },
      ]} />
    </Card>
  );
}

const CLAIM_ORDER = ["park_bus", "long_ball", "press", "wings", "park_bus_big", "set_pieces", "counter", "shape_big", "big_game", "fortress", "flat_track"];

function Reputations() {
  const rel = useQuery(`select * from reputation_reliability`);
  const [claim, setClaim] = useParam("claim", "park_bus");
  const safe = claim.replace(/[^a-z_]/g, "");
  const q = useQuery(`select r.*, c.name as club from reputation_checks r left join clubs c on c.club_id = r.id
                      where r.who = 'club' and r.season = 0 and r.claim = '${safe}' and r.verdict = 'true' order by r.value desc limit 40`);
  const m = useQuery(`select * from reputation_checks where who = 'manager' and claim = '${safe}' and verdict = 'true' and matches >= 30 order by value desc limit 15`);
  const rows = CLAIM_ORDER.map((c) => rel.rows.find((r) => r.claim === c)).filter(Boolean) as Row[];
  const cur = rel.rows.find((r) => r.claim === safe);
  const plot = (width: number) => ({
    width, height: rows.length * 26 + 50, marginLeft: 230, marginRight: 50,
    x: { label: "How much a team's number repeats across a season (reliability)", domain: [0, 1], grid: true },
    y: { label: null, domain: rows.map((r) => r.label) },
    marks: [
      Plot.barX(rows, { y: "label", x: (r: any) => Math.max(0, r.season_rel), fill: (r: any) => (r.season_rel >= 0.3 ? css("--s1") : css("--muted")), insetTop: 4, insetBottom: 4, rx: 2 }),
      Plot.ruleX([0.3], { stroke: css("--text"), strokeDasharray: "3 3" }),
      Plot.text(rows, { y: "label", x: (r: any) => Math.max(0, r.season_rel), text: (r: any) => fmt.n(Math.max(0, r.season_rel), 2), dx: 6, textAnchor: "start", fontSize: 10, fill: css("--text-2") }),
      Plot.tip(rows, Plot.pointer({ y: "label", x: (r: any) => Math.max(0, r.season_rel), title: (r: any) => `${r.label}\n${r.question}\nsplit-half r ${fmt.n(r.split_half_r, 2)} over ${r.team_seasons} team-seasons` })),
    ],
  });
  return (
    <div className="grid">
      <div className="c6">
        {rows.length > 0 && <Figure title="Style reputations can be real; results reputations can't"
          subtitle="Split-half reliability of each claim: a team-season's matches split at random, the claim measured in each half, and the halves correlated. Left of the dashed line (0.3) a claim doesn't repeat for any team, so 'big-game team', 'flat-track bully', 'fortress' and 'changes shape for big games' can't be proven for anyone, whatever one season says."
          source="FotMob (Opta) team stats, closing odds, 2024-25 onward" plot={plot} alt="Reliability of each reputation claim"
          table={{ rows, cols: [["label", "Claim"], ["season_rel", "Reliability", (v) => fmt.n(v, 2)], ["team_seasons", "Team-seasons"]] }} />}
      </div>
      <div className="c6 stack" style={{ gap: 16 }}>
        <Card title={`Who it's true of: ${cur?.label?.toLowerCase() ?? ""}`} sub={cur ? `${cur.question} Clubs whose 95% interval clears zero, with an effect big enough to notice, in their league's top fifth, 2024-25 onward.` : undefined}
              right={<select value={safe} onChange={(e) => setClaim(e.target.value)} aria-label="Claim">{rows.filter((r) => r.season_rel >= 0.3).map((r) => <option key={r.claim} value={r.claim}>{r.label}</option>)}</select>}>
          <DataTable rows={q.rows} limit={12} maxHeight={360} cols={[
            { key: "club", label: "Club", fmt: (v, r) => <Link to={`/team/${encodeURIComponent(r.id)}?tab=reputation`}>{v ?? r.id}</Link> },
            { key: "competition_id", label: "League", fmt: (v) => LEAGUES[v] ?? v },
            { key: "value", label: "Effect", num: true, fmt: (v, r) => <>{fmt.signed(v, 1)} <span className="muted xs">({fmt.signed(r.lo, 1)} to {fmt.signed(r.hi, 1)})</span></> },
            { key: "matches", label: "Matches", num: true },
          ]} />
        </Card>
        <Card title="Managers it's true of" sub="Same test on each manager's FotMob-era league matches (30+).">
          <DataTable rows={m.rows} limit={8} cols={[
            { key: "name", label: "Manager", fmt: (v, r) => <Link to={`/manager/${r.id}`}>{v}</Link> },
            { key: "value", label: "Effect", num: true, fmt: (v, r) => <>{fmt.signed(v, 1)} <span className="muted xs">({fmt.signed(r.lo, 1)} to {fmt.signed(r.hi, 1)})</span></> },
            { key: "matches", label: "Matches", num: true },
          ]} />
        </Card>
      </div>
    </div>
  );
}
