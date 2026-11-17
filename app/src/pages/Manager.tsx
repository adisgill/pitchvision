// One manager's career: every league spell since 2012-13 against the odds, the shapes picked
// at each club, how the teams played (FotMob era) and what happened to a new club's shape on
// arrival. Spec 12.8.
import * as Plot from "@observablehq/plot";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { lit, Row, useQuery } from "../db";
import { css, div, fmt, LEAGUES } from "../lib/format";
import { formColor, formHex, formKey, FORMATIONS } from "../lib/tactics";
import { Figure } from "../ui/Figure";
import { Card, ClubLink, DataTable, Legend, Loading, PageHead, Tile, useTip } from "../ui/kit";

export default function Manager() {
  const slug = decodeURIComponent(useParams().slug ?? "");
  const sp = useQuery(`select * from manager_spells where manager_slug = ${lit(slug)} order by start_date`);
  const fq = useQuery(`select * from manager_formations where manager_slug = ${lit(slug)}`);
  const st = useQuery(`select s.*, m.team, m.start_date from spell_style s join manager_spells m using (club_id, spell)
                       where s.manager_slug = ${lit(slug)} order by m.start_date`);
  const mv = useQuery(`select * from manager_shape_moves where manager_slug = ${lit(slug)} order by start_date`);
  const spells = sp.rows;
  const name = spells[0]?.manager ?? slug.replace(/-/g, " ");
  const tot = useMemo(() => {
    const n = spells.reduce((a, r) => a + r.n, 0);
    const odds = spells.filter((r) => r.n_odds > 0);
    const no = odds.reduce((a, r) => a + r.n_odds, 0);
    const over = no ? odds.reduce((a, r) => a + r.over_pm * r.n_odds, 0) / no : null;
    const ppg = n ? spells.reduce((a, r) => a + r.ppg * r.n, 0) / n : null;
    const se = no ? 1.2 / Math.sqrt(no) : null;
    const forms = new Map<string, number>();
    fq.rows.forEach((r) => forms.set(r.formation, (forms.get(r.formation) ?? 0) + r.n));
    const fn = [...forms.values()].reduce((a, v) => a + v, 0);
    const topF = [...forms.entries()].sort((a, b) => b[1] - a[1])[0];
    const b3 = fn ? [...forms.entries()].filter(([f]) => f[0] === "3" || f[0] === "5").reduce((a, [, v]) => a + v, 0) / fn : null;
    return { n, over, ppg, se, clubs: new Set(spells.map((r) => r.club_id)).size, topF, fn, b3 };
  }, [spells, fq.rows]);

  if (!sp.loading && !spells.length) {
    return (
      <>
        <PageHead eyebrow="Manager" title="Manager not found" lead={<>We have no league spells under “{slug.replace(/-/g, " ")}”. Find managers on the <Link to="/tactics">Tactics</Link> page.</>} />
      </>
    );
  }
  return (
    <>
      <Loading state={sp} />
      <PageHead eyebrow="Manager" title={name}
        lead={spells.length ? <>{fmt.n(tot.n)} league matches at {tot.clubs} club{tot.clubs > 1 ? "s" : ""} since {new Date(spells[0].start_date).getUTCFullYear()}.
          {tot.over != null && <> Results against the closing odds: {fmt.signed(tot.over, 2)} points per match (± {fmt.n(1.96 * (tot.se ?? 0), 2)}).</>}</> : null} />
      <div className="tiles">
        <Tile label="League matches" value={fmt.n(tot.n)} delta={`${spells.length} spell${spells.length > 1 ? "s" : ""}`} />
        <Tile label="Points per match" value={fmt.n(tot.ppg, 2)} delta={tot.over != null ? `${fmt.signed(tot.over, 2)} vs the odds` : "no odds for these matches"} tone={tot.over == null ? undefined : tot.over >= 0 ? "up" : "down"} />
        <Tile label="Favourite shape" value={tot.topF?.[0] ?? "–"} delta={tot.topF ? `${fmt.pct(tot.topF[1] / tot.fn)} of matches with a recorded formation` : undefined} />
        <Tile label="Back three" value={tot.b3 != null ? fmt.pct(tot.b3) : "–"} delta="share of matches with three or five at the back" />
      </div>
      <div className="grid">
        <div className="c12"><Career spells={spells} name={name} /></div>
        <div className="c12"><Shapes spells={spells} forms={fq.rows} name={name} /></div>
        {st.rows.length > 0 && <div className="c12"><StyleBySpell rows={st.rows} name={name} /></div>}
        {mv.rows.length > 0 && (
          <div className="c12">
            <Card title={`What happened to the shape when ${name.split(" ").slice(-1)[0]} arrived`}
                  sub="Share of matches in a back three (or five): at the manager's previous club, at the new club under its previous manager, and in the first 38 matches of the new spell. Across every such move since 2013, the new club's shape follows the manager more than its own past (see Tactics).">
              <DataTable rows={mv.rows} cols={[
                { key: "to_team", label: "Moved to", fmt: (v, r) => <ClubLink id={r.to_club} name={v} /> },
                { key: "start_date", label: "From", fmt: (v) => fmt.date(v) },
                { key: "mgr_prev_b3", label: "Manager's last club", num: true, fmt: (v, r) => `${fmt.pct(v)} · ${r.mgr_prev_mode}` },
                { key: "club_prev_b3", label: "Club before", num: true, fmt: (v, r) => `${fmt.pct(v)} · ${r.club_prev_mode}` },
                { key: "new_b3", label: "New spell", num: true, fmt: (v, r) => <b>{fmt.pct(v)} · {r.new_mode}</b> },
              ]} />
            </Card>
          </div>
        )}
        <div className="c12">
          <Card title="Every spell" sub="Points per match against the closing line's expectation for the same fixtures. Short spells are mostly noise: see the 95% interval.">
            <DataTable rows={spells} initialSort={{ key: "start_date", desc: true }} cols={[
              { key: "team", label: "Club", fmt: (v, r) => <ClubLink id={r.club_id} name={v} /> },
              { key: "competition_id", label: "League", fmt: (v) => LEAGUES[v] ?? v },
              { key: "start_date", label: "From", fmt: (v) => fmt.date(v) },
              { key: "end_date", label: "To", fmt: (v) => fmt.date(v) },
              { key: "n", label: "Matches", num: true },
              { key: "w", label: "W-D-L", fmt: (_v, r) => `${r.w}-${r.d}-${r.l}` },
              { key: "ppg", label: "PPG", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "over_pm", label: "vs odds / match", num: true, fmt: (v, r) => v == null ? "–" : <span style={{ color: v >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, 2)} <span className="muted xs">± {fmt.n(1.96 * r.se, 2)}</span></span> },
              { key: "top_formation", label: "Main shape" },
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}

function Career({ spells, name }: { spells: Row[]; name: string }) {
  const plot = useMemo(() => {
    if (!spells.length) return undefined;
    const d: Row[] = spells.map((r) => ({ ...r, label: r.team, s: new Date(r.start_date), e: new Date(new Date(r.end_date).getTime() + 5 * 864e5) }));
    const lim = Math.max(0.3, ...d.map((r) => Math.abs(r.over_pm ?? 0)));
    return (width: number) => ({
      width, height: Math.max(130, [...new Set(d.map((r) => r.label))].length * 36 + 50), marginLeft: 130, marginRight: 70,
      x: { label: null, type: "time" as const, grid: true },
      y: { label: null, domain: [...new Set(d.map((r) => r.label))] },
      marks: [
        Plot.barX(d, { x1: "s", x2: "e", y: "label", fill: (r: any) => (r.over_pm == null ? css("--mid") : div((r.over_pm ?? 0) / lim)), insetTop: 7, insetBottom: 7, rx: 2 }),
        Plot.text(d.filter((r) => r.over_pm != null), { x: "e", y: "label", text: (r: any) => `${fmt.signed(r.over_pm, 2)}`, dx: 6, textAnchor: "start", fill: css("--text-2"), fontSize: 10.5 }),
        Plot.tip(d, Plot.pointer({ x1: "s", x2: "e", y: "label", title: (r: any) =>
          `${r.team}\n${fmt.dayYear(r.start_date)} – ${fmt.dayYear(r.end_date)}\n${r.n} league matches, ${r.w}-${r.d}-${r.l}\n${fmt.n(r.ppg, 2)} points per match${r.over_pm != null ? `, ${fmt.signed(r.over_pm, 2)} vs the odds` : ""}\nMain shape ${r.top_formation ?? "–"}` })),
      ],
    });
  }, [spells]);
  return plot ? (
    <Figure title={`${name}'s career, spell by spell`} subtitle="Each bar is a spell in charge of a club's league matches. Colour: points per match above (blue) or below (red) what the closing odds expected; the label gives the figure."
            source="Transfermarkt and FotMob managers, closing odds via football-data.co.uk" plot={plot} alt={`${name} career timeline`} />
  ) : null;
}

function Shapes({ spells, forms, name }: { spells: Row[]; forms: Row[]; name: string }) {
  const data = useMemo(() => {
    const out: Row[] = [];
    spells.forEach((s) => {
      const f = forms.filter((r) => r.club_id === s.club_id && r.spell === s.spell);
      const n = f.reduce((a, r) => a + r.n, 0);
      if (!n) return;
      const agg = new Map<string, number>();
      f.forEach((r) => agg.set(formKey(r.formation), (agg.get(formKey(r.formation)) ?? 0) + r.n));
      [...agg.entries()].forEach(([k, v]) => out.push({ spell: `${s.team} ${new Date(s.start_date).getUTCFullYear()}`, formation: k, share: v / n, n: v, total: n }));
    });
    return out;
  }, [spells, forms]);
  const keys = [...FORMATIONS, "Other"].filter((k) => data.some((d) => d.formation === k));
  const plot = useMemo(() => {
    if (!data.length) return undefined;
    const ys = [...new Set(data.map((d) => d.spell))];
    return (width: number) => ({
      width, height: ys.length * 30 + 50, marginLeft: 150,
      x: { label: "Share of league matches", tickFormat: (v: number) => fmt.pct(v), domain: [0, 1] },
      y: { label: null, domain: ys },
      color: { domain: keys, range: keys.map((k) => formHex(k === "Other" ? null : k)) },
      marks: [
        Plot.barX(data, Plot.stackX({ x: "share", y: "spell", fill: "formation", order: keys, insetTop: 6, insetBottom: 6, stroke: css("--surface"), strokeWidth: 1 })),
        Plot.tip(data, Plot.pointer(Plot.stackX({ x: "share", y: "spell", z: "formation", order: keys, title: (d: any) => `${d.spell}\n${d.formation}: ${d.n} of ${d.total} matches (${fmt.pct(d.share)})` }))),
      ],
    });
  }, [data]);
  return plot ? (
    <Figure title={`The shapes ${name} picked`} subtitle="Starting formation in each spell's league matches. Transfermarkt labels to 2023-24, FotMob's since; the two providers label the same match differently about a third of the time, so a change at 2024-25 may be the label rather than the team."
            source="Transfermarkt, FotMob" plot={plot} alt="Formations by spell"
            table={{ rows: data, cols: [["spell", "Spell"], ["formation", "Formation"], ["n", "Matches"], ["share", "Share", (v) => fmt.pct(v)]] }}>
      <Legend items={keys.map((k) => ({ label: k, color: formColor(k === "Other" ? null : k), kind: "rect" as const }))} />
    </Figure>
  ) : null;
}

const STYLE: [string, string][] = [["possession", "Possession"], ["territory", "Territory"], ["press", "Pressing"], ["long_share", "Long balls"],
  ["crosses", "Crossing"], ["counter_share", "Counters"], ["op_xg_for", "Chance creation"], ["op_xg_against", "Chance prevention"]];
const flip = (k: string, v: number | null) => (v == null ? v : k === "op_xg_against" ? -v : v);

function StyleBySpell({ rows, name }: { rows: Row[]; name: string }) {
  const tip = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const cell = 64;
  return (
    <Card title={`How ${name}'s teams played`} sub="Each spell since 2024-25 (8+ league matches) against the league's teams that season, in standard deviations. Blue: more of it than the league's average team; red: less. Chance creation and prevention are open-play xG for and against (blue: creates more, concedes less).">
      <div className="table-wrap">
        <table className="data heat">
          <thead><tr><th>Spell</th>{STYLE.map(([k, l]) => <th key={k} className="r" style={{ minWidth: cell }}>{l}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.club_id}-${r.spell}`}>
                <td><ClubLink id={r.club_id} name={r.team} /> <span className="muted xs">{new Date(r.start_date).getUTCFullYear()} · {r.n} m</span></td>
                {STYLE.map(([k, l]) => {
                  const v = flip(k, r[k]);
                  const c = v == null ? "transparent" : div(Math.max(-1, Math.min(1, v / 2)));
                  return (
                    <td key={k} className="r num" style={{ background: c, color: Math.abs(v ?? 0) > 1.2 ? "#fff" : undefined, outline: hover === k ? "1px solid var(--text)" : undefined }}
                        onPointerMove={(e) => { setHover(k); tip.show(e, <><b>{l}</b><div>{fmt.signed(v, 2)} SD vs the league · {r.n} matches</div></>); }}
                        onPointerLeave={() => { setHover(null); tip.hide(); }}>
                      {fmt.signed(v, 1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip.node}
    </Card>
  );
}

