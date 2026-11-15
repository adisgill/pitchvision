import { lazy, Suspense, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Search, fmt } from "./components";
import { useManifest, useNewVersion } from "./db";
import Home from "./pages/Home";

const League = lazy(() => import("./pages/League"));
const Simulations = lazy(() => import("./pages/Simulations"));
const Players = lazy(() => import("./pages/Players"));
const Player = lazy(() => import("./pages/Player"));
const Team = lazy(() => import("./pages/Team"));
const Matches = lazy(() => import("./pages/Matches"));
const Match = lazy(() => import("./pages/Match"));
const Market = lazy(() => import("./pages/Market"));
const Referees = lazy(() => import("./pages/Referees"));
const Accuracy = lazy(() => import("./pages/Accuracy"));
const About = lazy(() => import("./pages/About"));

const NAV: [string, string][] = [
  ["/league", "League"], ["/simulations", "Simulations"], ["/players", "Players"], ["/matches", "Matches"],
  ["/market", "Market"], ["/referees", "Referees"], ["/accuracy", "Accuracy"], ["/about", "About"],
];

function useTheme() {
  const [theme, setTheme] = useState<string | null>(() => {
    try { return localStorage.getItem("theme"); } catch { return null; }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    try { theme ? localStorage.setItem("theme", theme) : localStorage.removeItem("theme"); } catch { /* private mode */ }
  }, [theme]);
  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return [dark, () => setTheme(dark ? "light" : "dark")] as const;
}

export default function App() {
  const [dark, toggle] = useTheme();
  const fresh = useNewVersion();
  const manifest = useManifest();
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      {fresh && (
        <div className="banner" role="status">
          New data is available. <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>Refresh</a>
        </div>
      )}
      <header className="header">
        <div className="header-inner">
          <Link to="/" className="brand">pitch<span>vision</span></Link>
          <nav className="nav" aria-label="Main">
            {NAV.map(([to, l]) => <NavLink key={to} to={to}>{l}</NavLink>)}
          </nav>
          <div className="spacer" />
          <Search />
          <button className="toggle" onClick={toggle} aria-label="Toggle dark mode">{dark ? "Light" : "Dark"}</button>
        </div>
      </header>
      <main className="main">
        <Suspense fallback={<div className="loading">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/league" element={<League />} />
            <Route path="/simulations" element={<Simulations />} />
            <Route path="/players" element={<Players />} />
            <Route path="/player/:id" element={<Player />} />
            <Route path="/team/:id" element={<Team />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/match/:id" element={<Match />} />
            <Route path="/market" element={<Market />} />
            <Route path="/referees" element={<Referees />} />
            <Route path="/accuracy" element={<Accuracy />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<p>Page not found. <Link to="/">Home</Link></p>} />
          </Routes>
        </Suspense>
      </main>
      <footer className="site">
        pitchvision · open source at <a href="https://github.com/adisgill/pitchvision">github.com/adisgill/pitchvision</a> ·
        results through {fmt.date(manifest?.data_through)} · data version {manifest?.version ?? "–"} ·
        StatsBomb (Hudl) open data, Wyscout public dataset (CC BY 4.0), Transfermarkt, football-data.co.uk · <Link to="/about">credits</Link>
      </footer>
    </>
  );
}
