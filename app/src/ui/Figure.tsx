// The figure frame every Plot chart lives in: a takeaway title, definitions and sample sizes
// in the subtitle, a source line, a table view (every chart has its WCAG-clean twin), and
// PNG / SVG export with a small watermark. Plot's pointer-driven tip mark supplies hover.
import * as Plot from "@observablehq/plot";
import { toPng, toSvg } from "html-to-image";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Row } from "../db";
import { css } from "../lib/format";

/** The element's content width, measured before the first paint (so charts never draw at a
 * guessed width and then jump) and kept current with a ResizeObserver. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setW(Math.max(260, Math.floor(ref.current.getBoundingClientRect().width)));
    let raf = 0;
    const ro = new ResizeObserver((e) => {
      const nw = Math.max(260, Math.floor(e[0].contentRect.width));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW((old) => (Math.abs(old - nw) > 1 ? nw : old)));
    });
    ro.observe(ref.current);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return [ref, w || 640, w > 0] as const;
}

const cleanLabel = (l: unknown) =>
  typeof l === "string" ? l.replace(/^\s*[↑↓←→]\s*/, "").replace(/\s*[↑↓←→]\s*$/, "") : l;

/** House style for every Plot chart: no tick marks or axis arrows, the y label above the axis,
 * horizontal grid only, room at the top for the label. Page options win where they're set. */
function polish(o: Record<string, any>): Record<string, any> {
  const axis = (s: any, y: boolean) => {
    const base: Record<string, any> = { tickSize: 0, tickPadding: y ? 8 : 6, labelArrow: "none" };
    if (y) Object.assign(base, { labelAnchor: "top" });
    if (s == null) return base;
    return { ...base, ...s, label: cleanLabel(s.label) };
  };
  const hasYLabel = o.y?.label != null && o.y?.label !== "";
  return {
    ...o,
    marginTop: o.marginTop ?? (hasYLabel ? 32 : 16),
    marginBottom: o.marginBottom ?? (o.x?.label ? 40 : 28),
    x: axis(o.x, false),
    y: axis(o.y, true),
  };
}

/** Hide direct labels that would overprint an earlier one (earlier marks win). */
function declutter(svg: Element) {
  const placed: DOMRect[] = [];
  svg.querySelectorAll('g[aria-label="text"] text').forEach((t) => {
    const b = (t as SVGGraphicsElement).getBoundingClientRect();
    if (!b.width) return;
    const hit = placed.some((p) => b.left < p.right + 2 && b.right > p.left - 2 && b.top < p.bottom + 1 && b.bottom > p.top - 1);
    if (hit) (t as SVGElement).style.display = "none";
    else placed.push(b);
  });
}

export type TableSpec = { rows: Row[]; cols: [string, string, ((v: any) => string)?][] };

export function Figure(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  source?: string;
  /** Plot options for a given width (loosely typed so literal scale options need no casts). */
  plot?: (width: number) => Record<string, any>;
  children?: ReactNode;
  alt?: string;
  table?: TableSpec;
  right?: ReactNode;
  stale?: boolean;
  className?: string;
  /** Called with the chart's SVG element after each render (for linked highlighting). */
  onRender?: (el: SVGSVGElement | HTMLElement) => void;
}) {
  const [ref, width, measured] = useWidth<HTMLDivElement>();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  useEffect(() => {
    if (!props.plot || !box.current || showTable || !measured) return;
    const opts = polish(props.plot(width));
    const el = Plot.plot({
      style: { background: "transparent", color: css("--text-2"), fontSize: "11.5px", fontFamily: "var(--font)", overflow: "visible" },
      ...(opts as Plot.PlotOptions),
    });
    el.setAttribute("role", "img");
    if (props.alt) el.setAttribute("aria-label", props.alt);
    box.current.replaceChildren(el);
    declutter(el);
    props.onRender?.(el as any);
    return () => { el.remove(); };
  }, [props.plot, width, showTable, measured]);
  const save = async (kind: "png" | "svg") => {
    if (!frame.current) return;
    const opts = { backgroundColor: css("--surface"), pixelRatio: 2, filter: (n: HTMLElement) => !n.classList?.contains("fig-actions") };
    const url = kind === "png" ? await toPng(frame.current, opts) : await toSvg(frame.current, opts);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(typeof props.title === "string" ? props.title : "pitchvision").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.${kind}`;
    a.click();
  };
  return (
    <div className={`card ${props.className ?? ""}`} ref={frame}>
      <div className="card-head">
        <div>
          <p className="fig-title">{props.title}</p>
          {props.subtitle && <p className="fig-sub">{props.subtitle}</p>}
        </div>
        {props.right}
      </div>
      <div ref={ref} className={`plot ${props.stale ? "refetch" : ""}`}>
        {showTable && props.table ? <TableView spec={props.table} /> : <><div ref={box} />{props.children}</>}
      </div>
      <div className="fig-foot">
        <span>{props.source ? `${props.source} · ` : ""}pitchvision · adisgill.github.io/pitchvision</span>
        <span className="fig-actions">
          {props.table && <button aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>{showTable ? "Chart" : "Table"}</button>}
          <button onClick={() => save("png")} aria-label="Download as PNG">PNG</button>
          <button onClick={() => save("svg")} aria-label="Download as SVG">SVG</button>
        </span>
      </div>
    </div>
  );
}

function TableView({ spec }: { spec: TableSpec }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 420 }}>
      <table className="data">
        <thead><tr>{spec.cols.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
        <tbody>
          {spec.rows.map((r, i) => (
            <tr key={i}>{spec.cols.map(([k, , f]) => <td key={k}>{f ? f(r[k]) : String(r[k] ?? "–")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Standard axis/grid styling for Plot, from the design tokens. */
export const axes = () => ({
  grid: { stroke: css("--grid"), strokeOpacity: 1 },
});
