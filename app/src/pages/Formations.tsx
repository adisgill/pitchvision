// Every formation in the data as a card: its shape, how often it's used now, and results
// beyond the odds since 2013. Spec 12.9.
import { Link } from "react-router-dom";
import { useQuery } from "../db";
import { fmt } from "../lib/format";
import { encF } from "../lib/tactics";
import { FormationPitch, slotsOf } from "../ui/FormationPitch";
import { Loading, PageHead } from "../ui/kit";

export default function Formations() {
  const p = useQuery(`select * from formation_profile order by n desc`);
  const sl = useQuery(`select * from formation_slots`);
  const withSlots = new Set(sl.rows.map((r) => r.formation));
  return (
    <>
      <PageHead eyebrow="Research · formations" title="Every formation, measured"
        lead={<>{p.rows.length} shapes across {fmt.n(p.rows.reduce((a, r) => a + r.n, 0))} team-matches since 2013. Open one for how teams play in it, who plays it best, which managers make it work, and how it fares against the odds.</>} />
      <Loading state={p} />
      <div className="fcards">
        {p.rows.map((r) => (
          <Link key={r.formation} to={`/formation/${encF(r.formation)}`} className="fcard-f">
            <div className="row between" style={{ alignItems: "baseline" }}>
              <span className="nm">{r.formation}</span>
              <span className="muted xs">{r.family}</span>
            </div>
            <div className="pitchbox">
              {withSlots.has(r.formation) ? <FormationPitch mini slots={slotsOf(sl.rows, r.formation)} label={`${r.formation} shape`} />
                : <div className="muted xs" style={{ padding: "40px 0", textAlign: "center" }}>No slot data (Transfermarkt era only)</div>}
            </div>
            <div className="meta"><span>{fmt.n(r.n)} starts</span><span>{fmt.pct(r.share_recent, 1)} lately</span></div>
            <div className="meta"><span>v the odds</span>
              <span style={{ color: Math.abs(r.over_pm) > 1.96 * r.se ? (r.over_pm > 0 ? "var(--up-text)" : "var(--critical)") : undefined }}>
                {fmt.signed(r.over_pm, 2)} ± {fmt.n(1.96 * r.se, 2)} pts/match</span></div>
          </Link>
        ))}
      </div>
    </>
  );
}
