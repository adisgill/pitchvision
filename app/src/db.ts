// Data layer: DuckDB-WASM over the published Parquet files.
//
// The manifest names every table's immutable, content-addressed file. Views are created
// lazily the first time a query mentions a table, so a page only downloads what it uses
// (DuckDB reads Parquet over HTTP range requests). The manifest is re-checked every
// 10 minutes; a new version is announced, never swapped in under a page that's showing data.
import * as duckdb from "@duckdb/duckdb-wasm";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import { useEffect, useState } from "react";

export type Manifest = {
  version: string;
  built_at: string;
  data_through: string | null;
  files: Record<string, string>;
  rows: Record<string, number>;
  attribution: Record<string, string>;
};

export type Row = Record<string, any>;

const dataUrl = (file: string) =>
  new URL(`${import.meta.env.BASE_URL}data/${file}`, window.location.href).toString();

let ready: Promise<{ conn: duckdb.AsyncDuckDBConnection; manifest: Manifest }> | null = null;
const created = new Set<string>();

async function init() {
  const res = await fetch(dataUrl("manifest.json"), { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const manifest: Manifest = await res.json();
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  // sum() over integers returns HUGEINT and decimals arrive as 128-bit words: have DuckDB
  // hand both over as doubles so every page gets plain numbers
  await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
  for (const file of Object.values(manifest.files)) {
    await db.registerFileURL(file, dataUrl(file), duckdb.DuckDBDataProtocol.HTTP, false);
  }
  const conn = await db.connect();
  return { conn, manifest };
}

export function getDb() {
  if (!ready) ready = init();
  return ready;
}

function toPlain(v: any): any {
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v;
  return v;
}

async function ensureViews(sql: string) {
  const { conn, manifest } = await getDb();
  for (const [name, file] of Object.entries(manifest.files)) {
    if (!created.has(name) && new RegExp(`\\b${name}\\b`).test(sql)) {
      await conn.query(`create view if not exists ${name} as select * from read_parquet('${file}')`);
      created.add(name);
    }
  }
  return conn;
}

export async function query(sql: string): Promise<Row[]> {
  const conn = await ensureViews(sql);
  const table = await conn.query(sql);
  const fields = table.schema.fields;
  const out: Row[] = [];
  for (const r of table.toArray()) {
    const o: Row = {};
    for (const f of fields) {
      let v = r[f.name];
      // DuckDB dates arrive as epoch milliseconds
      if (v != null && (f.type.toString().startsWith("Date") || f.type.toString().startsWith("Timestamp"))) {
        v = new Date(Number(v));
      }
      o[f.name] = toPlain(v);
    }
    out.push(o);
  }
  return out;
}

/** Run ``sql`` (null = skip) and re-run when it changes. */
export function useQuery(sql: string | null) {
  const [state, setState] = useState<{ rows: Row[]; loading: boolean; error: string | null }>({
    rows: [],
    loading: !!sql,
    error: null,
  });
  useEffect(() => {
    if (!sql) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    query(sql)
      .then((rows) => live && setState({ rows, loading: false, error: null }))
      .catch((e) => live && setState({ rows: [], loading: false, error: String(e?.message ?? e) }));
    return () => {
      live = false;
    };
  }, [sql]);
  return state;
}

export function useManifest() {
  const [m, setM] = useState<Manifest | null>(null);
  useEffect(() => {
    getDb().then(({ manifest }) => setM(manifest)).catch(() => setM(null));
  }, []);
  return m;
}

/** True once the published manifest's version differs from the one this page loaded. */
export function useNewVersion() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const check = async () => {
      try {
        const { manifest } = await getDb();
        const r = await fetch(dataUrl("manifest.json"), { cache: "no-store" });
        const latest: Manifest = await r.json();
        setFresh(latest.version !== manifest.version);
      } catch {
        /* offline or between deploys: try again next time */
      }
    };
    const id = window.setInterval(check, 10 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);
  return fresh;
}

/** SQL string literal. */
export const lit = (s: string | number) => `'${String(s).replace(/'/g, "''")}'`;
