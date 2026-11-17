// For one club (FotMob era): how it plays in each of its shapes compared with its other
// shapes, results in each, and who fills each slot. Spec 12.9.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { lit, Row, useQuery } from "../../db";
import { fmt } from "../../lib/format";
import { encF } from "../../lib/tactics";
import { FormationPitch, Slot, surname } from "../../ui/FormationPitch";
import { Card, DataTable, PlayerLink, Seg, useTip } from "../../ui/kit";

const D = (v: number | null, d = 1, good?: boolean) => v == null ? <span className="muted">–</span>
  : <span style={{ color: good == null ? undefined : (v >= 0) === good ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v, d)}</span>;

export function ShapeStyle({ id, name }: { id: string; name: string }) {
  const q = useQuery(`select * from team_formation where club_id = ${lit(id)} and n >= 3 order by n desc`);
  if (!q.rows.length) return null;
  return (
    <div className="c12">
      <Card title={`How ${name} change between shapes`}
            sub="Since 2024-25. Each column is the club's average in that shape minus its average in its other shapes the same season, after adjusting every match for the strength gap and venue. Blank: the shape wasn't used alongside another one enough (3+ matches each) to compare.">
        <DataTable rows={q.rows} initialSort={{ key: "n", desc: true }} cols={[
          { key: "formation", label: "Shape", fmt: (v) => <Link to={`/formation/${encF(v)}`}><b>{v}</b></Link> },
          { key: "n", label: "Matches", num: true },
          { key: "ppg", label: "PPG", num: true, fmt: (v) => fmt.n(v, 2) },
          { key: "over_pm", label: "v odds", num: true, fmt: (v, r) => <>{D(v, 2, true)} <span className="muted xs">± {fmt.n(1.96 * r.se, 2)}</span></> },
          { key: "possession", label: "Possession", num: true, fmt: (v) => D(v) },
          { key: "territory", label: "Territory", num: true, fmt: (v) => D(v) },
          { key: "long_share", label: "Long balls", num: true, fmt: (v) => D(v) },
          { key: "press", label: "Opp. passes / action", num: true, fmt: (v) => D(v, 2) },
          { key: "op_xg_for", label: "xG for", num: true, fmt: (v) => D(v, 2, true) },
          { key: "op_xg_against", label: "xG against", num: true, fmt: (v) => D(v, 2, false) },
        ]} />
      </Card>
    </div>
  );
}

export function WhoPlaysWhere({ id, name }: { id: string; name: string }) {
  const forms = useQuery(`select formation, n from team_formation where club_id = ${lit(id)} and n >= 5 order by n desc`);
  const [pick, setPick] = useState<string | null>(null);
  const f = pick ?? forms.rows[0]?.formation;
  const pl = useQuery(f ? `select * from player_formation where club_id = ${lit(id)} and formation = ${lit(f)}` : null);
  const sl = useQuery(f ? `select * from formation_slots where formation = ${lit(f)}` : null);
  const tip = useTip();
  const byRole = useMemo(() => {
    const m = new Map<string, Row[]>();
    pl.rows.forEach((r) => { if (!r.role) return; if (!m.has(r.role)) m.set(r.role, []); m.get(r.role)!.push(r); });
    m.forEach((v) => v.sort((a, b) => b.starts - a.starts));
    return m;
  }, [pl.rows]);
  if (!forms.rows.length || !f) return null;
  const slots: Slot[] = sl.rows.map((s) => {
    const top = byRole.get(s.role)?.[0];
    return { role: s.role, x: s.x, y: s.y, name: top ? surname(top.name) : undefined, value: top ? `${top.starts} st · ${fmt.n(top.rating, 2)}` : undefined };
  });
  return (
    <>
      <div className="c5">
        <Card title={`${name}'s ${f}: who plays where`}
              sub="Each slot's most frequent starter since 2024-25, with starts and average FotMob rating there. Hover for the alternatives.">
          {forms.rows.length > 1 && <div style={{ marginBottom: 10 }}><Seg label="Formation" value={f} onChange={setPick}
              options={forms.rows.slice(0, 4).map((r) => [r.formation, r.formation] as [string, string])} /></div>}
          <div className="fpitch">
            <FormationPitch slots={slots} label={`${name} in a ${f}`} onHover={(e, s) => {
              const rs = s && byRole.get(s.role);
              if (!s || !rs?.length) { tip.hide(); return; }
              tip.show(e, <><b>{s.role} in the {f}</b>{rs.slice(0, 4).map((r) => <div key={r.player_id}>{r.name}: {r.starts} starts, {fmt.n(r.rating, 2)}</div>)}</>);
            }} />
          </div>
          {tip.node}
        </Card>
      </div>
      <div className="c7">
        <Card title={`Players in ${name}'s ${f}`} sub="Starts in this shape for the club, with rating here and the same player's rating in other shapes (5+ starts).">
          <DataTable rows={pl.rows} initialSort={{ key: "starts", desc: true }} maxHeight={520} cols={[
            { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v} /> },
            { key: "role", label: "Slot", fmt: (v) => v ?? "–" },
            { key: "starts", label: "Starts", num: true },
            { key: "rating", label: "Rating", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "rating_diff", label: "v other shapes", num: true, fmt: (v) => D(v, 2, true) },
            { key: "xgxa_p90", label: "xG+xA /90", num: true, fmt: (v) => fmt.n(v, 2) },
            { key: "def_p90", label: "Def. /90", num: true, fmt: (v) => fmt.n(v, 1) },
          ]} />
        </Card>
      </div>
    </>
  );
}
