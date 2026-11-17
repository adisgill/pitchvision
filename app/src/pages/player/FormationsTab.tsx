// A player by formation: the slot played in each shape, the rating and output there, and the
// same numbers in every other shape, so you can see which systems suit them. FotMob era with
// Transfermarkt starts back to 2013-14. Spec 12.9.
import { Link } from "react-router-dom";
import { lit, useQuery } from "../../db";
import { fmt } from "../../lib/format";
import { encF } from "../../lib/tactics";
import { FormationPitch } from "../../ui/FormationPitch";
import { Card, DataTable, Empty, Loading } from "../../ui/kit";

export default function FormationsTab({ id, name }: { id: string; name: string }) {
  const q = useQuery(`select * from player_formation where player_id = ${lit(id)} order by starts desc`);
  const tm = useQuery(`select * from player_formation_tm where player_id = ${lit(id)} order by starts desc`);
  const sl = useQuery(`select s.* from formation_slots s where s.formation in (select formation from player_formation where player_id = ${lit(id)})`);
  if (!q.loading && !tm.loading && !q.rows.length && !tm.rows.length) return <Empty>No formation records for {name}: we need 3+ league starts in a shape.</Empty>;
  const cmp = q.rows.filter((r) => r.rating_diff != null && r.starts >= 5).sort((a, b) => b.rating_diff - a.rating_diff);
  const best = cmp[0], worst = cmp[cmp.length - 1];
  return (
    <div className="grid">
      <Loading state={q} />
      {q.rows.length > 0 && (
        <div className="c12">
          <Card title={best && worst && best !== worst ? `${name} rates best in a ${best.formation} (${fmt.signed(best.rating_diff, 2)}) and worst in a ${worst.formation} (${fmt.signed(worst.rating_diff, 2)})`
                                                       : `${name} by formation since 2024-25`}
                sub="Each shape the player started in (3+ starts): the slot played (highlighted), FotMob rating and output per 90, against the same player in every other shape. Ratings differences under about 0.15 are within normal match-to-match noise over 10-20 starts.">
            <div className="fcards">
              {q.rows.map((r) => {
                const slots = sl.rows.filter((s) => s.formation === r.formation).map((s) => ({ role: s.role, x: s.x, y: s.y, fill: s.role === r.role ? "var(--hi)" : "var(--muted)" }));
                return (
                  <div key={r.formation} className="fcard-f" style={{ cursor: "default" }}>
                    <div className="row between" style={{ alignItems: "baseline" }}>
                      <Link to={`/formation/${encF(r.formation)}`} className="nm">{r.formation}</Link>
                      <span className="muted xs">{r.role ?? ""} · {r.starts} starts</span>
                    </div>
                    {slots.length > 0 && <div className="pitchbox"><FormationPitch mini slots={slots} label={`${r.role} in a ${r.formation}`} /></div>}
                    <div className="meta"><span>Rating</span><b className="num" style={{ color: "var(--text)" }}>{fmt.n(r.rating, 2)}
                      {r.rating_diff != null && <span style={{ color: r.rating_diff >= 0 ? "var(--up-text)" : "var(--critical)", fontWeight: 400 }}> ({fmt.signed(r.rating_diff, 2)})</span>}</b></div>
                    <div className="meta"><span>xG+xA /90</span><span>{fmt.n(r.xgxa_p90, 2)}{r.other_xgxa_p90 != null ? ` v ${fmt.n(r.other_xgxa_p90, 2)} elsewhere` : ""}</span></div>
                    <div className="meta"><span>Team v odds</span><span>{fmt.signed(r.res, 2)}{r.other_res != null ? ` v ${fmt.signed(r.other_res, 2)}` : ""}</span></div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}
      {tm.rows.length > 0 && (
        <div className="c12">
          <Card title="Earlier seasons (Transfermarkt line-ups)" sub="Starts by the team's formation, 2013-14 to 2023-24, with goals and assists per 90 and the team's points beyond the odds in those starts.">
            <DataTable rows={tm.rows} initialSort={{ key: "starts", desc: true }} cols={[
              { key: "formation", label: "Formation", fmt: (v) => <Link to={`/formation/${encF(v)}`}>{v}</Link> },
              { key: "role", label: "Usual slot", fmt: (v) => v ?? "–" },
              { key: "starts", label: "Starts", num: true },
              { key: "first", label: "Seasons", fmt: (v, r) => `${v}–${String(r.last).slice(2)}` },
              { key: "ga_p90", label: "G+A /90", num: true, fmt: (v) => fmt.n(v, 2) },
              { key: "res", label: "Team v odds", num: true, fmt: (v) => fmt.signed(v, 2) },
            ]} />
          </Card>
        </div>
      )}
    </div>
  );
}
