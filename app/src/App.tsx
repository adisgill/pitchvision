import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { lit, useManifest, useNewVersion, useQuery } from "./db";
import { fmt, LEAGUES } from "./lib/format";
import { Icon } from "./ui/icons";

const pages = {
  Home: lazy(() => import("./pages/Home")),
  League: lazy(() => import("./pages/League")),
  Matches: lazy(() => import("./pages/Matches")),
  Match: lazy(() => import("./pages/Match")),
  Predict: lazy(() => import("./pages/Predict")),
  Team: lazy(() => import("./pages/Team")),
  Players: lazy(() => import("./pages/Players")),
  Player: lazy(() => import("./pages/Player")),
  Compare: lazy(() => import("./pages/Compare")),
  Matchup: lazy(() => import("./pages/Matchup")),
  Recruit: lazy(() => import("./pages/Recruit")),
  Report: lazy(() => import("./pages/Report")),
  Transfers: lazy(() => import("./pages/Transfers")),
  Market: lazy(() => import("./pages/Market")),
  Managers: lazy(() => import("./pages/Managers")),
  Referees: lazy(() => import("./pages/Referees")),
  Factors: lazy(() => import("./pages/Factors")),
  Insights: lazy(() => import("./pages/Insights")),
  Lab: lazy(() => import("./pages/Lab")),
  Accuracy: lazy(() => import("./pages/Accuracy")),
  About: lazy(() => import("./pages/About")),
};

type NavItem = { to: string; label: string; icon: string; badge?: string };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "", items: [{ to: "/", label: "Today", icon: "home" }] },
  { group: "Competitions", items: [
    { to: "/league", label: "Leagues", icon: "league" },
    { to: "/matches", label: "Matches", icon: "match" },
    { to: "/predict", label: "Match predictor", icon: "predict" },
  ] },
  { group: "Players & teams", items: [
    { to: "/players", label: "Player explorer", icon: "player" },
    { to: "/compare", label: "Compare", icon: "compare" },
    { to: "/matchup", label: "Pitch matchup", icon: "pitch" },
    { to: "/recruit", label: "Recruitment", icon: "target" },
    { to: "/report", label: "Opposition report", icon: "team" },
  ] },
  { group: "Business", items: [
    { to: "/transfers", label: "Transfers", icon: "transfer" },
    { to: "/market", label: "Market value", icon: "money" },
    { to: "/managers", label: "Managers", icon: "manager" },
    { to: "/referees", label: "Referees", icon: "referee" },
  ] },
  { group: "Research", items: [
    { to: "/insights", label: "What wins", icon: "predict", badge: "new" },
    { to: "/factors", label: "Hidden factors", icon: "factors" },
    { to: "/lab", label: "Model lab", icon: "lab" },
    { to: "/accuracy", label: "Accuracy", icon: "target" },
    { to: "/about", label: "About & data", icon: "info" },
  ] },
];

function useTheme() {
  const [theme, setTheme] = useState<string | null>(() => { try { return localStorage.getItem("theme"); } catch { return null; } });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    try { if (theme) localStorage.setItem("theme", theme); else localStorage.removeItem("theme"); } catch { /* private mode */ }
  }, [theme]);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return [dark, () => setTheme(dark ? "light" : "dark")] as const;
}

function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const term = q.trim();
  const res = useQuery(term.length >= 2 ? `
    select * from (
      select 'team' kind, club_id id, name, league sub, 0 o from clubs where name ilike ${lit(`%${term}%`)} and league is not null
      union all
      select 'player', p.player_id, p.name, coalesce(p.position, ''), 1 from players p
      where p.name ilike ${lit(`%${term}%`)} and p.player_id in (select player_id from players_c union select player_id from players_a
        union select player_id from fm_player_season)
      union all
      select 'player', f.player_id, f.name, coalesce(f.country, ''), 1 from fm_players f where f.name ilike ${lit(`%${term}%`)}
    ) order by o, length(name) limit 14` : null);
  const pagesHit = NAV.flatMap((g) => g.items).filter((i) => term && i.label.toLowerCase().includes(term.toLowerCase()));
  const leaguesHit = Object.entries(LEAGUES).filter(([, n]) => term && n.toLowerCase().includes(term.toLowerCase())).slice(0, 4);
  const items = [
    ...pagesHit.map((p) => ({ label: p.label, sub: "page", to: p.to })),
    ...leaguesHit.map(([k, n]) => ({ label: n, sub: "league", to: `/league?league=${k}` })),
    ...res.rows.map((r) => ({ label: r.name, sub: r.kind === "team" ? `team · ${LEAGUES[r.sub] ?? r.sub}` : `player · ${r.sub}`,
                              to: `/${r.kind}/${encodeURIComponent(r.id)}` })),
  ];
  const go = (to: string) => { nav(to); onClose(); };
  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus placeholder="Search players, teams, leagues, pages…" value={q}
               onChange={(e) => { setQ(e.target.value); setSel(0); }}
               onKeyDown={(e) => {
                 if (e.key === "Escape") onClose();
                 if (e.key === "ArrowDown") { setSel((s) => Math.min(s + 1, items.length - 1)); e.preventDefault(); }
                 if (e.key === "ArrowUp") { setSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
                 if (e.key === "Enter" && items[sel]) go(items[sel].to);
               }} />
        <ul role="listbox">
          {items.map((it, i) => (
            <li key={it.to + i} role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(it.to)}>
              {it.label}<span className="muted">{it.sub}</span>
            </li>
          ))}
          {!items.length && <li className="muted" aria-disabled>{term.length < 2 ? "Type a name: Haaland, Arsenal, La Liga…" : "No matches"}</li>}
        </ul>
      </div>
    </div>
  );
}

export default function App() {
  const [dark, toggle] = useTheme();
  const fresh = useNewVersion();
  const manifest = useManifest();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [pal, setPal] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); setMenu(false); }, [loc.pathname]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !/input|textarea|select/i.test((e.target as HTMLElement).tagName))) {
        e.preventDefault(); setPal(true);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const crumb = useMemo(() => NAV.flatMap((g) => g.items).find((i) => i.to !== "/" && loc.pathname.startsWith(i.to))?.label
    ?? ({ team: "Team", player: "Player", match: "Match" } as Record<string, string>)[loc.pathname.split("/")[1]] ?? "", [loc.pathname]);
  return (
    <>
      {fresh && <div className="banner" role="status">New data is available. <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>Refresh</a></div>}
      <div className="shell">
        {menu && <div className="scrim" onClick={() => setMenu(false)} />}
        <aside className={`sidebar ${menu ? "open" : ""}`} aria-label="Main navigation">
          <Link to="/" className="brand"><svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)" /><circle cx="16" cy="16" r="6.5" fill="none" stroke="#fff" strokeWidth="2" /><path d="M16 3v26" stroke="#fff" strokeWidth="2" /></svg>pitch<b>vision</b></Link>
          {NAV.map((g) => (
            <nav className="nav-group" key={g.group || "top"} aria-label={g.group || "Home"}>
              {g.group && <div className="eyebrow">{g.group}</div>}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Icon name={i.icon} />{i.label}{i.badge && <span className="pill accent">{i.badge}</span>}
                </NavLink>
              ))}
            </nav>
          ))}
          <div style={{ marginTop: "auto", paddingTop: "1rem" }} className="xs muted">
            Results through {fmt.date(manifest?.data_through)}
          </div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <header className="topbar">
            <button className="btn ghost menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
            <span className="crumbs">{crumb}</span>
            <div className="spacer" />
            <button className="btn search-trigger" onClick={() => setPal(true)} aria-label="Search (Ctrl+K)">
              <span className="row" style={{ gap: 6 }}><Icon name="search" size={16} /><span className="label">Search players, teams…</span></span>
              <span className="kbd">Ctrl K</span>
            </button>
            <button className="btn ghost" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}><Icon name={dark ? "sun" : "moon"} /></button>
            <a className="btn ghost" href="https://github.com/adisgill/pitchvision" aria-label="Source on GitHub"><Icon name="github" /></a>
          </header>
          <main className="main">
            <Suspense fallback={<div className="loading">Loading…</div>}>
              <Routes>
                <Route path="/" element={<pages.Home />} />
                <Route path="/league" element={<pages.League />} />
                <Route path="/simulations" element={<Navigate to="/league?tab=simulator" replace />} />
                <Route path="/matches" element={<pages.Matches />} />
                <Route path="/match/:id" element={<pages.Match />} />
                <Route path="/predict" element={<pages.Predict />} />
                <Route path="/team/:id" element={<pages.Team />} />
                <Route path="/players" element={<pages.Players />} />
                <Route path="/player/:id" element={<pages.Player />} />
                <Route path="/compare" element={<pages.Compare />} />
                <Route path="/matchup" element={<pages.Matchup />} />
                <Route path="/recruit" element={<pages.Recruit />} />
                <Route path="/report" element={<pages.Report />} />
                <Route path="/transfers" element={<pages.Transfers />} />
                <Route path="/market" element={<pages.Market />} />
                <Route path="/managers" element={<pages.Managers />} />
                <Route path="/referees" element={<pages.Referees />} />
                <Route path="/factors" element={<pages.Factors />} />
                <Route path="/insights" element={<pages.Insights />} />
                <Route path="/lab" element={<pages.Lab />} />
                <Route path="/accuracy" element={<pages.Accuracy />} />
                <Route path="/about" element={<pages.About />} />
                <Route path="*" element={<p>Page not found. <Link to="/">Home</Link></p>} />
              </Routes>
            </Suspense>
          </main>
          <footer className="footer">
            pitchvision · open source at <a href="https://github.com/adisgill/pitchvision">github.com/adisgill/pitchvision</a> ·
            data version {manifest?.version ?? "–"} · StatsBomb (Hudl) open data, Wyscout public dataset (CC BY 4.0), Transfermarkt,
            football-data.co.uk · <Link to="/about">credits & methods</Link>
          </footer>
        </div>
      </div>
      {pal && <Palette onClose={() => setPal(false)} />}
    </>
  );
}
