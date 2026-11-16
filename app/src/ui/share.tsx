// "Save as image" for any panel: renders the DOM node to a 2x PNG with the page surface behind it.
import { toPng } from "html-to-image";
import { useState } from "react";
import { css } from "../lib/format";

export async function saveNodeAsPng(node: HTMLElement, name: string) {
  const url = await toPng(node, {
    backgroundColor: css("--surface"),
    pixelRatio: 2,
    filter: (n: HTMLElement) => !n.classList?.contains("no-share"),
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "pitchvision"}.png`;
  a.click();
}

/** A small button that saves ``target()`` as a PNG; hidden from the image itself. */
export function ShareButton({ target, name, label = "Save card" }: { target: () => HTMLElement | null; name: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn no-share no-print" disabled={busy} aria-label={`${label} as an image`}
            onClick={async () => {
              const n = target();
              if (!n) return;
              setBusy(true);
              try { await saveNodeAsPng(n, name); } finally { setBusy(false); }
            }}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
      </svg>
      {busy ? "Saving…" : label}
    </button>
  );
}
