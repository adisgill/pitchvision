import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { lit, useManifest, useNewVersion, useQuery } from "./db";
import { fmt, LEAGUES } from "./lib/format";
import { Icon } from "./ui/icons";

const Ticker = lazy(() => import("./ui/Ticker"));

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
  Manager: lazy(() => import("./pages/Manager")),
  Tactics: lazy(() => import("./pages/Tactics")),
  Referees: lazy(() => import("./pages/Referees")),
  Factors: lazy(() => import("./pages/Factors")),
  Insights: lazy(() => import("./pages/Insights")),
  Lab: lazy(() => import("./pages/Lab")),
  Accuracy: lazy(() => import("./pages/Accuracy")),
  About: lazy(() => import("./pages/About")),
};

type NavItem = { to: string; label: string; icon: string; badge?: string; desc: string };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Matchday", items: [
    { to: "/", label: "Today", icon: "home", desc: "Fixtures, results, title races and movers" },
    { to: "/matches", label: "Matches", icon: "match", desc: "Every result and fixture, with match centres" },
    { to: "/predict", label: "Match predictor", icon: "predict", desc: "Any two clubs: every score, every market" },
    { to: "/league", label: "Leagues", icon: "league", desc: "Tables, ratings and 10,000 simulated seasons" },
  ] },
  { group: "Scouting", items: [
    { to: "/players", label: "Player explorer", icon: "player", desc: "Any metric against any metric" },
    { to: "/compare", label: "Compare", icon: "compare", desc: "Up to three players on percentile radars" },
    { to: "/recruit", label: "Recruitment", icon: "target", desc: "Role fits, replacements and value for money" },
    { to: "/matchup", label: "Pitch matchup", icon: "pitch", desc: "Where one attack meets the other's leaks" },
    { to: "/report", label: "Opposition report", icon: "team", desc: "A printable pre-match dossier on any club" },
  ] },
  { group: "Business", items: [
    { to: "/transfers", label: "Transfers", icon: "transfer", desc: "Fees, flows and who overpaid" },
    { to: "/market", label: "Market value", icon: "money", desc: "What drives a valuation, and the outliers" },
    { to: "/managers", label: "Managers", icon: "manager", desc: "Results above expectation, by tenure" },
    { to: "/referees", label: "Referees", icon: "referee", desc: "Real differences, and a lot of noise" },
  ] },
  { group: "Research", items: [
    { to: "/tactics", label: "Tactics", icon: "pitch", badge: "new", desc: "Shapes, styles, managers: what's real" },
    { to: "/insights", label: "What wins", icon: "predict", desc: "Which stats predict future points" },
    { to: "/factors", label: "Hidden factors", icon: "factors", desc: "Overlooked factors tested against the market" },
    { to: "/lab", label: "Model lab", icon: "lab", desc: "Win probability, xT and score matrices" },
    { to: "/accuracy", label: "Accuracy", icon: "target", desc: "Every model scored in the open, plus the ledger" },
    { to: "/about", label: "About & data", icon: "info", desc: "Sources, methods and limits" },
  ] },
];

const isActive = (to: string, path: string) => (to === "/" ? path === "/" : path.startsWith(to.split("?")[0]));

/** Top navigation: one button per group, each opening a two-column panel of tools. */
function NavBar() {
  const loc = useLocation();
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => setOpen(null), [loc.pathname, loc.search]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const enter = (g: string) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(g), 90); };
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(null), 160); };
  return (
    <nav className="navbar" aria-label="Main">
      {NAV.map((g) => {
        const act = g.items.some((i) => isActive(i.to, loc.pathname));
        return (
          <div key={g.group} className={`navtop ${open === g.group ? "open" : ""} ${act ? "active" : ""}`}
               onPointerEnter={(e) => { if (e.pointerType === "mouse") enter(g.group); }} onPointerLeave={leave}>
            <button aria-expanded={open === g.group} onClick={() => setOpen(open === g.group ? null : g.group)}>
              {g.group}<Icon name="chev" />
            </button>
            {open === g.group && (
              <div className="mega" onPointerEnter={() => window.clearTimeout(timer.current)}>
                {g.items.map((i) => (
                  <Link key={i.to} to={i.to} className={isActive(i.to, loc.pathname) ? "active" : ""}>
                    <Icon name={i.icon} /><b>{i.label}{i.badge && <span className="pill accent">{i.badge}</span>}</b><span>{i.desc}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Sheet({ onClose }: { onClose: () => void }) {
  const loc = useLocation();
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Menu">
        <div className="row between">
          <Brand />
          <button className="btn ghost" onClick={onClose} aria-label="Close menu"><Icon name="close" /></button>
        </div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="eyebrow">{g.group}</div>
            {g.items.map((i) => (
              <Link key={i.to} to={i.to} onClick={onClose} className={isActive(i.to, loc.pathname) ? "active" : ""}><Icon name={i.icon} />{i.label}</Link>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

const Brand = () => (
  <Link to="/" className="brand" aria-label="pitchvision home">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16 1v30" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.6" fill="var(--hi)" />
    </svg>
    pitch<b>vision</b>
  </Link>
);


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
  return (
    <>
      {fresh && <div className="banner" role="status">New data is available. <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>Refresh</a></div>}
      <header className="mast">
        <Brand />
        <NavBar />
        <div className="spacer" />
        <button className="btn search-trigger" onClick={() => setPal(true)} aria-label="Search (Ctrl+K)">
          <span className="row" style={{ gap: 6 }}><Icon name="search" size={16} /><span className="label">Players, teams, pages</span></span>
          <span className="kbd">Ctrl K</span>
        </button>
        <button className="btn ghost" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}><Icon name={dark ? "sun" : "moon"} /></button>
        <a className="btn ghost" href="https://github.com/adisgill/pitchvision" aria-label="Source on GitHub"><Icon name="github" /></a>
        <button className="btn ghost menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
      </header>
      <Suspense fallback={<div className="ticker" />}><Ticker /></Suspense>
      {menu && <Sheet onClose={() => setMenu(false)} />}
      <main className="main">
        <Suspense fallback={<div className="loading">Loading</div>}>
          <div className="route" key={loc.pathname}>
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
              <Route path="/manager/:slug" element={<pages.Manager />} />
              <Route path="/tactics" element={<pages.Tactics />} />
              <Route path="/referees" element={<pages.Referees />} />
              <Route path="/factors" element={<pages.Factors />} />
              <Route path="/insights" element={<pages.Insights />} />
              <Route path="/lab" element={<pages.Lab />} />
              <Route path="/accuracy" element={<pages.Accuracy />} />
              <Route path="/about" element={<pages.About />} />
              <Route path="*" element={<p>Page not found. <Link to="/">Home</Link></p>} />
            </Routes>
          </div>
        </Suspense>
      </main>
      <footer className="footer">
        <Brand />
        <div>
          Open source at <a href="https://github.com/adisgill/pitchvision">github.com/adisgill/pitchvision</a> ·
          results through {fmt.dayYear(manifest?.data_through)} · data version <span className="mono">{manifest?.version ?? "–"}</span><br />
          StatsBomb (Hudl) open data, Wyscout public dataset (CC BY 4.0), Transfermarkt, FotMob, football-data.co.uk ·{" "}
          <Link to="/about">credits & methods</Link> · <Link to="/accuracy">public forecast ledger</Link>
        </div>
      </footer>
      {pal && <Palette onClose={() => setPal(false)} />}
    </>
  );
}
