// The player header as a scout's card: identity, the seven dimension ratings against position
// peers, the season line, and the strengths / watch-points the percentiles single out.
// Saveable as an image.
import { ReactNode, useRef } from "react";
import { Row } from "../../db";
import { fmt, LEAGUES, POSITION_NAMES, seasonLabel } from "../../lib/format";
import { ClubLink } from "../../ui/kit";
import { ShareButton } from "../../ui/share";
import { DIMS, useFmPercentiles } from "./fotmob";

const OUTFIELD_DIMS = DIMS.filter(([k]) => k !== "goalkeeping_rating");
const GK_DIMS = DIMS.filter(([k]) => ["goalkeeping_rating", "security_rating", "physical_rating", "duels_rating"].includes(k));

function Dim({ label, v, i }: { label: string; v: number | null; i: number }) {
  const ok = v != null && Number.isFinite(v);
  const c = ok ? Math.max(0, Math.min(100, v!)) : 50;
  const left = Math.min(c, 50), w = Math.max(1, Math.abs(c - 50));
  return (
    <div className="sc-dim" title={ok ? `${label}: ${Math.round(v!)} (50 = position average, 10 points = one standard deviation)` : `${label}: not enough data`}>
      <span className="l">{label}</span>
      <span className="track">
        <span className="mid" />
        {ok && <span className="fill" style={{ left: `${left}%`, width: `${w}%`, background: v! >= 50 ? "var(--pos)" : "var(--neg)",
                            transformOrigin: v! >= 50 ? "left" : "right", animationDelay: `${i * 0.05}s` }} />}
      </span>
      <span className="v">{ok ? Math.round(v!) : "–"}</span>
    </div>
  );
}

export default function ScoutCard({ id, bio, latest, age, extra }: {
  id: string; bio: Row; latest: Row; age: number | null; extra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pr = useFmPercentiles(id, latest.competition_id, latest.season);
  const pos: string | undefined = latest.position_group;
  const dims = pos === "GK" ? GK_DIMS : OUTFIELD_DIMS;
  const ranked = pr.axes.map((m) => ({ m, p: pr.vals[m.key] })).filter((x) => x.p != null) as { m: any; p: number }[];
  ranked.sort((a, b) => b.p - a.p);
  const strengths = ranked.filter((x) => x.p >= 70).slice(0, 4);
  const watch = ranked.filter((x) => x.p <= 30).slice(-3).reverse();
  const season = `${seasonLabel(latest.season, latest.competition_id)} ${LEAGUES[latest.competition_id] ?? latest.competition_id}`;
  const line: [string, ReactNode][] = [
    ["Minutes", fmt.n(latest.minutes)],
    ["Apps (starts)", `${fmt.n(latest.apps)} (${fmt.n(latest.starts)})`],
    ["Goals", fmt.n(latest.goals)],
    ["Assists", fmt.n(latest.assists)],
    ["npxG / 90", fmt.n(latest.npxg_p90, 2)],
    ["xA / 90", fmt.n(latest.xa_p90, 2)],
  ];
  return (
    <div className="scout" ref={ref}>
      <div className="sc-id">
        <div className="sc-pos" aria-label={pos ? POSITION_NAMES[pos] : undefined}>{pos ?? "–"}</div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{pos ? POSITION_NAMES[pos] : bio.position}{bio.sub_position && bio.sub_position !== bio.position ? ` · ${bio.sub_position}` : ""}</div>
          <h1 className="sc-name">{bio.name}</h1>
          <div className="sc-meta">
            {latest.club_id && <span><ClubLink id={latest.club_id} name={latest.club ?? latest.club_id} bold /></span>}
            {age != null && <span>Age {age}</span>}
            {bio.nationality && <span>{bio.nationality}</span>}
            {bio.foot && <span>{bio.foot}-footed</span>}
            {bio.height_in_cm && <span>{bio.height_in_cm} cm</span>}
            {bio.contract_expiration_date && <span>Contract to {fmt.dayYear(bio.contract_expiration_date)}</span>}
          </div>
          <div className="sc-value">
            <span className="eyebrow">Market value</span>
            <b>{latest.market_value ? fmt.eur(latest.market_value) : bio.market_value_in_eur ? fmt.eur(bio.market_value_in_eur) : "–"}</b>
          </div>
        </div>
      </div>

      <div className="sc-dims">
        <div className="row between"><span className="eyebrow">Ratings vs {pos ? POSITION_NAMES[pos].toLowerCase() : "position"}s</span><span className="eyebrow">50 = avg</span></div>
        {dims.map(([k, l], i) => <Dim key={k} label={l} v={latest[k]} i={i} />)}
      </div>

      <div className="sc-line">
        <span className="eyebrow">{season}</span>
        <div className="sc-stats">
          {line.map(([l, v]) => <div key={l}><span>{l}</span><b>{v}</b></div>)}
        </div>
        {strengths.length > 0 && (
          <div className="sc-tags"><span className="eyebrow">Stands out</span>
            {strengths.map(({ m, p }) => <span key={m.key} className="tag up" title={`${m.label}: ${pr.raw[m.key]} (${Math.round(p)}th percentile)`}>{m.short ?? m.label} <i>{Math.round(p)}</i></span>)}
          </div>
        )}
        {watch.length > 0 && (
          <div className="sc-tags"><span className="eyebrow">Watch</span>
            {watch.map(({ m, p }) => <span key={m.key} className="tag down" title={`${m.label}: ${pr.raw[m.key]} (${Math.round(p)}th percentile)`}>{m.short ?? m.label} <i>{Math.round(p)}</i></span>)}
          </div>
        )}
      </div>

      <div className="sc-foot">
        <span>Percentiles vs {pr.n ? `${fmt.n(pr.n)} ` : ""}{pos ? POSITION_NAMES[pos].toLowerCase() : ""}s with enough minutes, {season} · ratings shrunk toward average on small samples · FotMob (Opta) data · pitchvision</span>
        <span className="row" style={{ gap: 8 }}>{extra}<ShareButton target={() => ref.current} name={`${bio.name} scout card`} /></span>
      </div>
    </div>
  );
}
