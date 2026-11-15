import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import { lit, Row, useQuery } from "../db";
import { css, fmt, LEAGUES, SHORT, SIM_LEAGUES } from "../lib/format";
import { Figure } from "../ui/Figure";
import { Card, ClubLink, DataTable, Field, Loading, PageHead, PlayerLink, Seg, Select, Tile, useParam } from "../ui/kit";
import { tLabel, tSeason } from "./match/shared";

const FLOW = [...SIM_LEAGUES, "Other"];
const lg = (code: string | null) => (code && SIM_LEAGUES.includes(code) ? code : "Other");

export default function Transfers() {
  const seasonsQ = useQuery(`select transfer_season s, count(*) n from transfers group by 1 having count(*) > 500 order by 1 desc`);
  const seasons = seasonsQ.rows.map((r) => r.s as string);
  const [sP, setS] = useParam("season", "");
  const season = sP || seasons.find((s) => tSeason(s) <= 2025) || "25/26";
  const [league, setLeague] = useParam("league", "all");
  const [scope, setScope] = useParam("scope", "season");

  const base = `select t.*, p.name, cf.league from_league, ct.league to_league, cf.name from_name, ct.name to_name
    from transfers t left join players p using (player_id) left join clubs cf on cf.club_id = t.from_club left join clubs ct on ct.club_id = t.to_club`;
  const lgCond = league === "all" ? "" : `and (cf.league = ${lit(league)} or ct.league = ${lit(league)})`;
  const t = useQuery(`${base} where t.transfer_season = ${lit(season)} ${lgCond}`);
  const flowAll = useQuery(scope === "all" ? `select cf.league fl, ct.league tl, sum(t.fee_eur) fee, count(*) n from transfers t
    left join clubs cf on cf.club_id = t.from_club left join clubs ct on ct.club_id = t.to_club where t.fee_eur > 0 group by all` : null);
  const netAll = useQuery(scope === "all" ? `
    with x as (select to_club club, fee_eur spend, 0 income from transfers where fee_eur > 0
               union all select from_club, 0, fee_eur from transfers where fee_eur > 0)
    select x.club, c.name, c.league, sum(spend) spend, sum(income) income, sum(spend) - sum(income) net from x join clubs c on c.club_id = x.club
    where c.league in (${SIM_LEAGUES.map(lit).join(", ")}) ${league === "all" ? "" : `and c.league = ${lit(league)}`} group by all` : null);
  const ptsLeague = league === "all" ? "GB1" : league;
  const pts = useQuery(`select club_id, any_value(team) team, sum(p) pts, count(*) n from (
      select home_club club_id, home_team team, case when home_goals > away_goals then 3 when home_goals = away_goals then 1 else 0 end p
      from matches where played and competition_id = ${lit(ptsLeague)} and season = ${tSeason(season)}
      union all
      select away_club, away_team, case when away_goals > home_goals then 3 when home_goals = away_goals then 1 else 0 end
      from matches where played and competition_id = ${lit(ptsLeague)} and season = ${tSeason(season)}) group by 1`);

  const rows = t.rows;
  const disclosed = rows.filter((r) => r.fee_eur != null);
  const paid = rows.filter((r) => r.fee_eur > 0);
  const total = paid.reduce((a, r) => a + r.fee_eur, 0);
  const record = [...paid].sort((a, b) => b.fee_eur - a.fee_eur)[0];

  const net: Row[] = useMemo(() => {
    if (scope === "all") return netAll.rows;
    const m = new Map<string, Row>();
    const add = (club: string, name: string, league: string, s: number, i: number) => {
      if (!club || !SIM_LEAGUES.includes(league) || (league !== ptsLeague && "all" !== (league === "all" ? "all" : league) && false)) return;
      const r = m.get(club) ?? { club, name, league, spend: 0, income: 0 };
      r.spend += s; r.income += i; m.set(club, r);
    };
    paid.forEach((r) => { add(r.to_club, r.to_name ?? r.to_club_name, r.to_league, r.fee_eur, 0); add(r.from_club, r.from_name ?? r.from_club_name, r.from_league, 0, r.fee_eur); });
    return [...m.values()].filter((r) => league === "all" || r.league === league).map((r) => ({ ...r, net: r.spend - r.income }));
  }, [paid, scope, netAll.rows, league, ptsLeague]);

  const netPlot = useMemo(() => {
    if (!net.length) return undefined;
    const sorted = [...net].sort((a, b) => b.net - a.net);
    const show = [...sorted.slice(0, 10), ...sorted.slice(-10).filter((r) => !sorted.slice(0, 10).includes(r))];
    return (width: number) => ({
      width, height: show.length * 22 + 50, marginLeft: 130,
      x: { label: "← Net seller   ·   net buyer → (€m)", grid: true, tickFormat: (v: number) => `${Math.round(v / 1e6)}` },
      y: { label: null, domain: show.map((r) => r.name) },
      marks: [
        Plot.ruleX([0], { stroke: css("--axis") }),
        Plot.barX(show, { y: "name", x: "net", fill: (r: any) => (r.net >= 0 ? css("--s1") : css("--s2")), rx: 3, insetTop: 3, insetBottom: 3 }),
        Plot.tip(show, Plot.pointerY({ y: "name", x: "net", title: (r: any) => `${r.name} (${LEAGUES[r.league] ?? r.league})\nspent ${fmt.eur(r.spend)}, received ${fmt.eur(r.income)}\nnet ${fmt.eur(r.net)}` })),
      ],
    });
  }, [net]);

  const flow = useMemo(() => {
    const src = scope === "all" ? flowAll.rows.map((r) => ({ fl: r.fl, tl: r.tl, fee: r.fee, n: r.n })) : paid.map((r) => ({ fl: r.from_league, tl: r.to_league, fee: r.fee_eur, n: 1 }));
    const m = new Map<string, { from: string; to: string; fee: number; n: number }>();
    src.forEach((r) => { const k = `${lg(r.fl)}|${lg(r.tl)}`; const c = m.get(k) ?? { from: lg(r.fl), to: lg(r.tl), fee: 0, n: 0 }; c.fee += r.fee ?? 0; c.n += r.n; m.set(k, c); });
    return [...m.values()];
  }, [paid, flowAll.rows, scope]);

  const flowPlot = useMemo(() => {
    if (!flow.length) return undefined;
    const max = Math.max(...flow.map((f) => f.fee));
    return (width: number) => ({
      width, height: 380, marginLeft: 70, marginBottom: 50, padding: 0.06,
      x: { label: "Buying league →", domain: FLOW, tickFormat: (k: string) => SHORT[k] ?? k },
      y: { label: "↑ Selling league", domain: FLOW, tickFormat: (k: string) => SHORT[k] ?? k },
      color: { type: "sqrt" as const, range: [css("--seq-100"), css("--seq-700")], domain: [0, max], legend: true, label: "Fees (€)", tickFormat: (v: number) => fmt.eur(v) },
      marks: [
        Plot.cell(flow, { x: "to", y: "from", fill: "fee", rx: 3 }),
        Plot.text(flow.filter((f) => f.fee >= max * 0.08), { x: "to", y: "from", text: (f: any) => `${Math.round(f.fee / 1e6)}`, fill: (f: any) => (f.fee > max * 0.45 ? "#fff" : css("--text")), fontSize: 10 }),
        Plot.tip(flow, Plot.pointer({ x: "to", y: "from", title: (f: any) => `${LEAGUES[f.from] ?? f.from} → ${LEAGUES[f.to] ?? f.to}\n${fmt.eur(f.fee)} across ${f.n} paid transfers` })),
      ],
    });
  }, [flow]);

  const fvPlot = useMemo(() => {
    const d = paid.filter((r) => r.value_eur > 0).map((r): Row => ({ ...r, ratio: r.fee_eur / r.value_eur }));
    if (d.length < 5) return undefined;
    const labelled = [...d].sort((a, b) => b.fee_eur - a.fee_eur).slice(0, 5);
    return (width: number) => ({
      width, height: 360, marginLeft: 56, grid: true,
      x: { type: "log" as const, label: "Market value at the time →", tickFormat: (v: number) => fmt.eur(v) },
      y: { type: "log" as const, label: "↑ Fee paid", tickFormat: (v: number) => fmt.eur(v) },
      marks: [
        Plot.line([[5e4, 5e4], [3e8, 3e8]], { stroke: css("--axis") }),
        Plot.dot(d, { x: "value_eur", y: "fee_eur", r: 3.5, fill: css("--s1"), fillOpacity: 0.6 }),
        Plot.text(labelled, { x: "value_eur", y: "fee_eur", text: (r: any) => r.name?.split(" ").slice(-1)[0] ?? "", dy: -9, fill: css("--text"), fontSize: 10.5 }),
        Plot.tip(d, Plot.pointer({ x: "value_eur", y: "fee_eur", title: (r: any) => `${r.name ?? "?"}\n${r.from_club_name ?? "?"} → ${r.to_club_name ?? "?"}\nfee ${fmt.eur(r.fee_eur)} vs value ${fmt.eur(r.value_eur)} (×${fmt.n(r.ratio, 2)})` })),
      ],
    });
  }, [paid]);

  const spendPts = useMemo(() => {
    const byClub = new Map(net.map((r) => [r.club, r]));
    return pts.rows.map((p) => ({ ...p, net: byClub.get(p.club_id)?.net ?? 0, spend: byClub.get(p.club_id)?.spend ?? 0 }));
  }, [pts.rows, net]);
  const spPlot = useMemo(() => {
    if (spendPts.length < 6 || scope === "all") return undefined;
    return (width: number) => ({
      width, height: 340, marginLeft: 46, grid: true,
      x: { label: "Net spend in the window (€m) →", tickFormat: (v: number) => `${Math.round(v / 1e6)}` },
      y: { label: "↑ League points", },
      marks: [
        Plot.ruleX([0], { stroke: css("--axis") }),
        Plot.dot(spendPts, { x: "net", y: "pts", r: 5, fill: css("--s1"), stroke: css("--surface"), strokeWidth: 2 }),
        Plot.text(spendPts, { x: "net", y: "pts", text: (r: any) => r.team, dy: -10, fill: css("--text-2"), fontSize: 10 }),
        Plot.tip(spendPts, Plot.pointer({ x: "net", y: "pts", title: (r: any) => `${r.team}\nnet spend ${fmt.eur(r.net)} (spent ${fmt.eur(r.spend)})\n${r.pts} points from ${r.n} matches` })),
      ],
    });
  }, [spendPts, scope]);

  return (
    <>
      <PageHead eyebrow={`Transfer window ${season}${league !== "all" ? ` · ${LEAGUES[league]}` : ""}`}
        title={record ? `${fmt.eur(total)} in disclosed fees, led by ${record.name ?? "?"} (${fmt.eur(record.fee_eur)})` : "Transfers"}
        lead={`Every Transfermarkt move involving a club in our database since July 2012. ${rows.length ? `${fmt.n(rows.length - disclosed.length)} of ${fmt.n(rows.length)} moves this window have no disclosed fee and count as zero; loans and free transfers carry no fee.` : ""}`} />
      <div className="filters">
        {seasons.length > 0 && <Select label="Window" value={season} onChange={(v) => setS(v)} options={seasons.map((s) => [s, `20${s.slice(0, 2)}-${s.slice(3)}`])} />}
        <Select label="League" value={league} onChange={(v) => setLeague(v)} options={[["all", "All leagues"], ...SIM_LEAGUES.map((k) => [k, LEAGUES[k]] as [string, string])]} />
        <Field label="Money flows"><Seg value={scope as any} onChange={(v) => setScope(v)} label="Scope" options={[["season", "This window"], ["all", "Since 2012"]] as any} /></Field>
      </div>
      <Loading state={t} />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile label="Moves" value={fmt.n(rows.length)} delta={`${fmt.n(paid.length)} with a fee`} />
        <Tile label="Disclosed fees" value={fmt.eur(total)} />
        <Tile label="Average paid fee" value={fmt.eur(paid.length ? total / paid.length : null)} />
        {record && <Tile label="Record move" value={fmt.eur(record.fee_eur)} delta={`${record.name ?? "?"}: ${record.from_club_name ?? "?"} → ${record.to_club_name ?? "?"}`} />}
      </div>
      <div className="grid">
        <div className="c7">
          <Card title="Biggest fees" sub="Fee vs Transfermarkt's market value for the player at the time.">
            <DataTable rows={paid} initialSort={{ key: "fee_eur", desc: true }} limit={40} rank maxHeight={560} cols={[
              { key: "name", label: "Player", fmt: (v, r) => <PlayerLink id={r.player_id} name={v ?? r.player_id} /> },
              { key: "from_club_name", label: "From", fmt: (v, r) => <ClubLink id={r.from_club} name={v ?? r.from_club} /> },
              { key: "to_club_name", label: "To", fmt: (v, r) => <ClubLink id={r.to_club} name={v ?? r.to_club} /> },
              { key: "transfer_date", label: "Date", fmt: (v) => fmt.date(v) },
              { key: "fee_eur", label: "Fee", num: true, fmt: (v) => fmt.eur(v) },
              { key: "value_eur", label: "Value", num: true, fmt: (v) => fmt.eur(v) },
            ]} />
          </Card>
        </div>
        <div className="c5">
          {netPlot && <Figure title={scope === "all" ? "The biggest net buyers and sellers since 2012" : `Who spent and who sold in ${season}`}
            subtitle="Fees paid minus fees received, for clubs in the eight leagues we cover." source="Transfermarkt" plot={netPlot} alt="Net transfer spend by club"
            table={{ rows: net, cols: [["name", "Club"], ["spend", "Spent", (v) => fmt.eur(v)], ["income", "Received", (v) => fmt.eur(v)], ["net", "Net", (v) => fmt.eur(v)]] }} />}
        </div>
        <div className="c6">
          {flowPlot && <Figure title="Where the money flows" subtitle={`Sum of fees from the selling league (rows) to the buying league (columns), in €m${scope === "all" ? ", July 2012 onward" : ""}. "Other" is every club outside our eight leagues.`}
            source="Transfermarkt" plot={flowPlot} alt="League-to-league transfer fee matrix"
            table={{ rows: flow, cols: [["from", "Selling league"], ["to", "Buying league"], ["fee", "Fees", (v) => fmt.eur(v)], ["n", "Transfers"]] }} />}
        </div>
        <div className="c6">
          {fvPlot && <Figure title="Fee against market value" subtitle="Log scales. Above the diagonal: paid more than Transfermarkt's valuation." source="Transfermarkt" plot={fvPlot}
            alt="Transfer fee against market value" table={{ rows: paid.filter((r) => r.value_eur > 0), cols: [["name", "Player"], ["fee_eur", "Fee", (v) => fmt.eur(v)], ["value_eur", "Value", (v) => fmt.eur(v)]] }} />}
        </div>
        <div className="c12">
          {spPlot && <Figure title={`Did the spending buy points? ${LEAGUES[ptsLeague]} ${tLabel(tSeason(season)).replace("/", "-")}`}
            subtitle={`Each club's net spend in the ${season} window against its league points that season${league === "all" ? " (choose a league to change it)" : ""}. Squad value built up over earlier windows isn't counted.`}
            source="Transfermarkt, football-data.co.uk" plot={spPlot} alt="Net spend against league points"
            table={{ rows: spendPts, cols: [["team", "Club"], ["net", "Net spend", (v) => fmt.eur(v)], ["pts", "Points"]] }} />}
        </div>
      </div>
    </>
  );
}
