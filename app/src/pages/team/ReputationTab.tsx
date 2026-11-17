// A club's reputation, tested: "parks the bus", "presses high", "big-game team"... each with
// its number, interval and verdict, plus the matches behind the bus-parking claim. Spec 12.9.
import { useMemo, useState } from "react";
import { lit, useQuery } from "../../db";
import { fmt, seasonLabel } from "../../lib/format";
import { Card, DataTable, Empty, Loading, MatchLink, Seg } from "../../ui/kit";
import { ReputationCards } from "../../ui/Reputation";

export default function ReputationTab({ id, name }: { id: string; name: string }) {
  const q = useQuery(`select * from reputation_checks where who = 'club' and id = ${lit(id)}`);
  const rel = useQuery(`select * from reputation_reliability`);
  const ev = useQuery(`select * from reputation_matches where club_id = ${lit(id)} order by match_date desc`);
  const seasons = useMemo(() => [...new Set(q.rows.filter((r) => r.season > 0).map((r) => Number(r.season)))].sort((a, b) => b - a), [q.rows]);
  const [scope, setScope] = useState("0");
  const rows = q.rows.filter((r) => String(r.season) === scope);
  const comp = q.rows[0]?.competition_id;
  if (!q.loading && !q.rows.length) return <Empty>No reputation checks for {name}: they need FotMob match stats (nine leagues, 2024-25 onward) and at least 10 matches.</Empty>;
  const yes = rows.filter((r) => r.verdict === "true").map((r) => r.label.toLowerCase());
  const lean = rows.filter((r) => r.verdict === "leans that way").map((r) => r.label.toLowerCase());
  const no = rows.filter((r) => r.verdict === "the opposite").map((r) => r.label.toLowerCase());
  const title = [yes.length ? `${name}: ${yes.join(", ")}` : null, lean.length ? `${yes.length ? "leans towards" : `${name} lean towards`} ${lean.join(", ")}` : null,
                 no.length ? `the opposite of ${no.join(", ")}` : null].filter(Boolean).join("; ");
  return (
    <div className="grid">
      <Loading state={q} />
      <div className="c12 row between">
        <Seg label="Matches used" value={scope} onChange={setScope}
             options={[["0", "2024-25 onward"], ...seasons.map((s) => [String(s), seasonLabel(s, comp)] as [string, string])]} />
        <span className="muted small">{rows[0]?.matches ?? 0} league matches</span>
      </div>
      <div className="c12">
        <Card title={title || `Nothing people say about ${name} is clearly backed by the numbers`}
              sub={<>Each claim is tested on these matches against what the match-up predicts. Style claims compare each match with a typical side in the same position (strength gap from the closing odds, home or away), so a big club isn't called "possession-heavy" just for being good. Results claims compare points with the closing odds. "True" means the 95% interval clears zero, the effect is big enough to notice (for example 3+ points of possession) and the team is in the league's top fifth; "leans that way" means it clears zero but is milder. Some claims never hold for any team from one half of a season to the other; those can't be proven, whatever the number says.</>}>
          <ReputationCards rows={rows} rel={rel.rows} name={name} />
        </Card>
      </div>
      {scope === "0" && (
        <div className="c12">
          <Card title={ev.rows.length ? `${name}'s deep-block matches: ${ev.rows.length}` : `${name} haven't played a deep-block match since 2024-25`}
                sub="The evidence for 'parks the bus': matches where they had 10+ points less possession and 8+ points less of their passing in the opposition half than a side in the same position usually does.">
            {ev.rows.length > 0 && (
              <DataTable rows={ev.rows} initialSort={{ key: "match_date", desc: true }} cols={[
                { key: "match_date", label: "Date", fmt: (v, r) => <MatchLink id={r.match_id}>{fmt.dayYear(v)}</MatchLink> },
                { key: "opp", label: "Opponent", fmt: (v, r) => `${r.home ? "v" : "at"} ${v}` },
                { key: "gf", label: "Score", fmt: (v, r) => `${v}–${r.ga}` },
                { key: "possession", label: "Possession", num: true, fmt: (v, r) => <>{fmt.n(v, 0)}% <span className="muted xs">exp. {fmt.n(r.possession_exp, 0)}%</span></> },
                { key: "territory", label: "Passes in their half", num: true, fmt: (v, r) => <>{fmt.n(v, 0)}% <span className="muted xs">exp. {fmt.n(r.territory_exp, 0)}%</span></> },
                { key: "formation", label: "Shape" },
                { key: "p_win", label: "Win chance", num: true, fmt: (v) => fmt.pct(v) },
                { key: "pts", label: "Pts v odds", num: true, fmt: (v, r) => <span style={{ color: v - r.xpts >= 0 ? "var(--up-text)" : "var(--critical)" }}>{fmt.signed(v - r.xpts, 2)}</span> },
              ]} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
