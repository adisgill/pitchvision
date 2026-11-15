// Small stroke icons (24 x 24 grid, 1.8 stroke), drawn for this app.
const P: Record<string, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  league: "M4 5h16M4 10h16M4 15h10M4 20h7",
  match: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7l4 3-1.5 4.5h-5L8 10z",
  predict: "M4 19l5-6 4 3 7-9M15 7h5v5",
  team: "M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
  player: "M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  compare: "M8 3v18M16 3v18M3 8h5M16 16h5M3 16h5M16 8h5",
  pitch: "M3 5h18v14H3zM12 5v14M3 9h3v6H3M21 9h-3v6h3",
  transfer: "M4 8h13l-3-3M20 16H7l3 3",
  money: "M12 3v18M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7",
  manager: "M8 21v-6l-3-2 3-8h8l3 8-3 2v6M10 9h4",
  referee: "M6 3h7l-1 7H5zM12 10l1 11M9 21h7",
  factors: "M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 9V3M8 3h8M7 15h10",
  lab: "M12 3a9 9 0 1 0 9 9M12 7v5l3 3M17 3h4v4",
  target: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0",
  info: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v6M12 7.5v.5",
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4",
  menu: "M4 7h16M4 12h16M4 17h16",
  sun: "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  sim: "M4 4h16v16H4zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01",
  github: "M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.8 2.8 5.8 3.1 5.8 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21",
};

export function Icon({ name, size }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.info} />
    </svg>
  );
}
