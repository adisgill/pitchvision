// The club header: identity and form on the left; this season's trend on the right, cumulative
// points against what the closing market expected match by match, with each match's xG
// difference as a strip underneath. Hover any match for the details; click to open it.
import { ReactNode, useId, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { lit, Row, useQuery } from "../../db";
import { fmt, LEAGUES, seasonLabel } from "../../lib/format";
import { useWidth } from "../../ui/Figure";
import { useTip } from "../../ui/kit";
import { ShareButton } from "../../ui/share";
import { pts, resultLetter, teamGamesSql } from "../match/shared";

function Trend({ games, name }: { games: Row[]; name: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const nav = useNavigate();
  const uid = useId().replace(/:/g, "");
  const rows = useMemo(() => {
    let p = 0, x = 0;
    return games.map((g, i) => {
      p += pts(g.gf, g.ga);
      x += g.p_win != null ? 3 * g.p_win + g.p_draw : pts(g.gf, g.ga);
      return { ...g, i, cp: p, cx: x, xd: g.xgf != null && g.xga != null ? g.xgf - g.xga : null } as Row;
    });
  }, [games]);
  if (rows.length < 2) return <div ref={ref}><p className="small muted">The season trend appears after two league matches.</p></div>;
  const W = width, H = 190, S = 46, top = 10, left = 30, right = 54;
  const n = rows.length, max = Math.max(3, ...rows.map((r) => Math.max(r.cp, r.cx)));
  const x = (i: number) => left + (i / Math.max(1, n - 1)) * (W - left - right);
  const y = (v: number) => top + (1 - v / max) * (H - top - 8);
  const xdMax = Math.max(0.5, ...rows.map((r) => Math.abs(r.xd ?? 0)));
  const bw = Math.max(2, Math.min(14, (W - left - right) / n - 2));
  const line = (k: "cp" | "cx") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
  // band between the two lines, split by sign so over- and under-performance read as colour
  const band = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.cp).toFixed(1)}`).join("")
    + rows.slice().reverse().map((r) => `L${x(r.i).toFixed(1)},${y(r.cx).toFixed(1)}`).join("") + "Z";
  const last = rows[n - 1];
  const ahead = last.cp >= last.cx;
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  const show = (e: React.PointerEvent, r: any) => tip.show(e, <>
    <div className="muted xs">{fmt.day(r.match_date)} · {r.side === "h" ? "v" : "at"} {r.opp}</div>
    <b>{r.gf}–{r.ga}</b> <span className="muted">{resultLetter(r.gf, r.ga)}</span>
    <div className="muted">{r.cp} pts after {r.i + 1} (market expected {fmt.n(r.cx, 1)})</div>
    {r.xd != null && <div className="muted">xG {fmt.n(r.xgf, 1)}–{fmt.n(r.xga, 1)}</div>}
  </>);
  return (
    <div ref={ref}>
      <svg width={W} height={H + S + 18} role="img" aria-label={`${name}: cumulative points against market expectation this season`} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <clipPath id={`${uid}a`}><path d={line("cx") + `L${x(n - 1)},${top}L${x(0)},${top}Z`} /></clipPath>
          <clipPath id={`${uid}b`}><path d={line("cx") + `L${x(n - 1)},${H}L${x(0)},${H}Z`} /></clipPath>
        </defs>
        {ticks.map((t) => <g key={t}>
          <line x1={left} x2={W - right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
          <text x={left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fontFamily="var(--font)" fill="var(--muted)">{t}</text>
        </g>)}
        <path d={band} fill="var(--pos)" opacity={0.18} clipPath={`url(#${uid}a)`} />
        <path d={band} fill="var(--neg)" opacity={0.18} clipPath={`url(#${uid}b)`} />
        <path d={line("cx")} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={line("cp")} fill="none" stroke="var(--text)" strokeWidth={2.2} strokeLinejoin="round" className="draw" pathLength={1} />
        <circle cx={x(n - 1)} cy={y(last.cp)} r={4} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} />
        <text x={x(n - 1) + 8} y={y(last.cp) + (ahead ? -2 : 10)} fontSize={11} fontWeight={600} fill="var(--text)">{last.cp} pts</text>
        <text x={x(n - 1) + 8} y={y(last.cx) + (ahead ? 12 : -2)} fontSize={10} fill="var(--muted)">{fmt.n(last.cx, 1)} exp.</text>
        {/* xG difference strip */}
        <line x1={left} x2={W - right} y1={H + S / 2} y2={H + S / 2} stroke="var(--axis)" />
        <text x={left - 6} y={H + S / 2 + 3} textAnchor="end" fontSize={9} fontFamily="var(--font)" fill="var(--muted)">xGD</text>
        {rows.map((r) => r.xd != null && (
          <rect key={r.match_id} x={x(r.i) - bw / 2} width={bw} rx={1}
                y={r.xd >= 0 ? H + S / 2 - (r.xd / xdMax) * (S / 2 - 3) : H + S / 2}
                height={Math.max(1, (Math.abs(r.xd) / xdMax) * (S / 2 - 3))} fill={r.xd >= 0 ? "var(--pos)" : "var(--neg)"} />
        ))}
        {rows.map((r) => (
          <text key={`r${r.match_id}`} x={x(r.i)} y={H + S + 14} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily="var(--display)"
                fill={r.gf > r.ga ? "var(--s3)" : r.gf < r.ga ? "var(--s8)" : "var(--muted)"}>{n <= 40 ? resultLetter(r.gf, r.ga) : ""}</text>
        ))}
        {rows.map((r) => (
          <rect key={`h${r.match_id}`} x={x(r.i) - (W - left - right) / n / 2} y={0} width={(W - left - right) / n} height={H + S + 18}
                fill="transparent" style={{ cursor: "pointer" }} onPointerMove={(e) => show(e, r)} onPointerLeave={tip.hide}
                onClick={() => nav(`/match/${encodeURIComponent(r.match_id)}`)} />
        ))}
      </svg>
      <div className="legend" style={{ marginTop: 4 }}>
        <span><span className="key" style={{ background: "var(--text)" }} />Points</span>
        <span><span className="key" style={{ background: "var(--muted)" }} />Market-expected points</span>
        <span><span className="dot" style={{ background: "var(--pos)", borderRadius: 2 }} />xG difference per match</span>
      </div>
      {tip.node}
    </div>
  );
}

export default function ClubHeader({ id, club, name, tiles }: { id: string; club: Row | undefined; name: string; tiles: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const all = useQuery(`select * from (${teamGamesSql(`m.home_club = ${lit(id)} or m.away_club = ${lit(id)}`)})
                        where club_id = ${lit(id)} order by match_date`);
  const league = club?.league ?? all.rows[all.rows.length - 1]?.competition_id;
  const season = all.rows.length ? Math.max(...all.rows.filter((g) => !league || g.competition_id === league).map((g) => g.season)) : null;
  const games = all.rows.filter((g) => g.season === season && (!league || g.competition_id === league));
  const recent = all.rows.slice(-10);
  return (
    <div className="club" ref={ref}>
      <div className="club-id">
        <div className="eyebrow">
          {league ? <Link to={`/league?league=${league}`}>{LEAGUES[league] ?? league}</Link> : "Club"}
          {club?.stadium ? ` · ${club.stadium}${club.capacity ? ` (${fmt.n(club.capacity)})` : ""}` : ""}
        </div>
        <h1 className="club-name">{name}</h1>
        {recent.length > 0 && (
          <div className="club-form" aria-label="Last ten results, oldest first">
            {recent.map((g) => {
              const r = resultLetter(g.gf, g.ga);
              return (
                <Link key={g.match_id} to={`/match/${encodeURIComponent(g.match_id)}`} className={`fm ${r}`}
                      title={`${fmt.dayYear(g.match_date)}: ${g.side === "h" ? "v" : "at"} ${g.opp} ${g.gf}–${g.ga}`}>
                  <b>{g.gf}–{g.ga}</b><span>{g.side === "h" ? "" : "@"}{String(g.opp).slice(0, 3).toUpperCase()}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <div className="club-trend">
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="eyebrow">{season != null ? `${seasonLabel(season, league)} · points vs market expectation` : "Season trend"}</span>
        </div>
        {games.length > 0 && <Trend games={games} name={name} />}
      </div>
      <div className="club-tiles">{tiles}</div>
      <div className="sc-foot">
        <span>Points against the closing market's pre-match expectation · xG from shots · pitchvision</span>
        <ShareButton target={() => ref.current} name={`${name} season card`} />
      </div>
    </div>
  );
}
