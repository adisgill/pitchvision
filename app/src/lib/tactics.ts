// Shared pieces for formations, style profiles and managers (spec 12.8).
import { Row } from "../db";
import { css } from "./format";

/** The seven most common shapes keep fixed colours everywhere; everything else is "Other". */
export const FORMATIONS = ["4-2-3-1", "4-3-3", "4-4-2", "3-4-2-1", "3-5-2", "3-4-3", "4-1-4-1"];
export const formColor = (f: string | null | undefined) => {
  const i = f ? FORMATIONS.indexOf(f) : -1;
  return i >= 0 ? `var(--s${i + 1})` : "var(--muted)";
};
/** Resolved colour (for Plot scales that need a literal). */
export const formHex = (f: string | null | undefined) => css(formColor(f).slice(4, -1));
export const formKey = (f: string | null | undefined) => (f && FORMATIONS.includes(f) ? f : "Other");

// letters NFKD doesn't decompose into ASCII (keep in step with TRANSLIT in research/tactics.py)
const TRANSLIT: Record<string, string> = { æ: "ae", Æ: "Ae", ø: "o", Ø: "O", ß: "ss", ł: "l", Ł: "L", đ: "d", Đ: "D", œ: "oe", Œ: "Oe", ı: "i", þ: "th", ð: "d" };

/** Same key as the pipeline: transliterated, accents and other non-ASCII dropped, lower case,
 * words joined by "-". */
export const managerSlug = (name: string) =>
  name.replace(/[æÆøØßłŁđĐœŒıþð]/g, (c) => TRANSLIT[c]).normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
    .toLowerCase().replace(/[^a-z]+/g, " ").trim().replace(/ /g, "-");

/** Reliability a trait needs at a team's number of matches before we call it a trait. */
export const TRAIT_REL = 0.7;

export type Trait = {
  trait: string; label: string; kind: "style" | "output"; higher_better: boolean | null;
  high: string; low: string; unit: string; season_rel: number; per_match_rel: number; matches_for_07: number;
};

/** Section a trait is drawn in, and whether "right" on the strip means more or better. */
export const traitGroup = (t: Trait) =>
  t.kind === "style" ? "Style" : t.trait.endsWith("_for") ? "Attack" : "Defence";

/** Percentile on the strip: style traits as-is (right = more), output traits flipped so
 * right = better. */
export const stripPct = (t: Trait, pct: number) => (t.higher_better === false ? 100 - pct : pct);

export const traitValue = (t: Trait, v: number) => {
  if (v == null || !Number.isFinite(v)) return "–";
  if (t.unit === "%") return `${v.toFixed(1)}%`;
  if (t.trait.startsWith("xg_shot")) return v.toFixed(3);
  if (t.trait.includes("xg")) return v.toFixed(2);
  return v.toFixed(v >= 100 ? 0 : 1);
};

export type Read = { trait: Trait; row: Row; phrase: string; pct: number };

/** Strengths, weaknesses and tendencies, only from traits that are reliable at the team's
 * number of matches and sit in the league's top or bottom fifth. */
export function readProfile(rows: Row[], traits: Trait[]) {
  const by = new Map(traits.map((t) => [t.trait, t]));
  const out = { strengths: [] as Read[], weaknesses: [] as Read[], tendencies: [] as Read[], noisy: 0 };
  for (const r of rows) {
    const t = by.get(r.trait);
    if (!t) continue;
    if (r.rel < TRAIT_REL) { if (r.pct >= 80 || r.pct <= 20) out.noisy++; continue; }
    if (t.kind === "style") {
      if (r.pct >= 80) out.tendencies.push({ trait: t, row: r, phrase: t.high, pct: r.pct });
      else if (r.pct <= 20) out.tendencies.push({ trait: t, row: r, phrase: t.low, pct: r.pct });
    } else {
      const good = stripPct(t, r.pct);
      if (good >= 80) out.strengths.push({ trait: t, row: r, phrase: t.higher_better ? t.high : t.high, pct: good });
      else if (good <= 20) out.weaknesses.push({ trait: t, row: r, phrase: t.low, pct: good });
    }
  }
  const ext = (a: Read) => Math.abs(a.pct - 50);
  out.strengths.sort((a, b) => ext(b) - ext(a));
  out.weaknesses.sort((a, b) => ext(b) - ext(a));
  out.tendencies.sort((a, b) => ext(b) - ext(a));
  return out;
}

export const ordinal = (n: number) => {
  const r = Math.round(n);
  const s = r % 100 >= 11 && r % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][r % 10] ?? "th";
  return `${r}${s}`;
};

/** Reputation verdicts (spec 12.9): badge class and short text. */
export const VERDICT: Record<string, { cls: string; text: string }> = {
  "true": { cls: "v-true", text: "True" },
  "leans that way": { cls: "v-leans", text: "Leans that way" },
  "not proven": { cls: "v-np", text: "Not proven" },
  "the opposite": { cls: "v-opp", text: "The opposite" },
  "not a repeatable trait": { cls: "v-noise", text: "Not a repeatable trait" },
  "not enough matches": { cls: "v-few", text: "Too few matches" },
};

/** Manager-formation verdicts. */
export const SHAPE_VERDICT: Record<string, string> = {
  "better than the odds": "up", "worse than the odds": "down", "no clear edge": "",
};

export const encF = (f: string) => encodeURIComponent(f);
