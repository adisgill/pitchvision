// The forecast as a shareable card: both sides, the three outcomes, the likeliest score and the
// headline markets, with the date and source baked in. "Save card" writes it as a PNG.
import { useRef } from "react";
import { fmt, LEAGUES } from "../../lib/format";
import { MarketSummary } from "../../lib/models";
import { ShareButton } from "../../ui/share";

export default function ForecastCard({ home, away, comp, s, lh, la, custom, neutral }: {
  home: string; away: string; comp?: string; s: MarketSummary; lh: number; la: number; custom: boolean; neutral: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fav = s.home >= s.away ? "h" : "a";
  return (
    <div className="fcard" ref={ref}>
      <div className="fc-top">
        <span>{comp ? LEAGUES[comp] ?? comp : "Match forecast"}{neutral ? " · neutral ground" : ""}</span>
        <span>{custom ? "your scenario" : "model forecast"} · {today}</span>
      </div>
      <div className="fc-main">
        <div className={`fc-side ${fav === "h" ? "fav" : ""}`}>
          <span className="nm">{home}</span>
          <span className="pc">{fmt.pct(s.home)}</span>
          <span className="xg">xG {fmt.n(lh, 2)}</span>
        </div>
        <div className="fc-mid">
          <span className="pc">{fmt.pct(s.draw)}</span>
          <span className="lb">draw</span>
          <span className="sc"><i>likeliest</i>{s.top[0].h}–{s.top[0].a}<i>{fmt.pct(s.top[0].p, 1)}</i></span>
        </div>
        <div className={`fc-side away ${fav === "a" ? "fav" : ""}`}>
          <span className="nm">{away}</span>
          <span className="pc">{fmt.pct(s.away)}</span>
          <span className="xg">xG {fmt.n(la, 2)}</span>
        </div>
      </div>
      <div className="fc-bar" aria-hidden="true">
        <span style={{ flex: s.home, background: "var(--s1)" }} />
        <span style={{ flex: s.draw, background: "var(--muted)" }} />
        <span style={{ flex: s.away, background: "var(--s2)" }} />
      </div>
      <div className="fc-mk">
        <span>Both score <b>{fmt.pct(s.btts)}</b></span>
        <span>Over 2.5 <b>{fmt.pct(s.over25)}</b></span>
        <span>{home} clean sheet <b>{fmt.pct(s.cleanHome)}</b></span>
        <span>{away} clean sheet <b>{fmt.pct(s.cleanAway)}</b></span>
      </div>
      <div className="fc-foot">
        <span className="brandmark">PITCH<b>VISION</b></span>
        <span>Dixon-Coles score model · adisgill.github.io/pitchvision</span>
        <ShareButton target={() => ref.current} name={`${home} v ${away} forecast`} />
      </div>
    </div>
  );
}
