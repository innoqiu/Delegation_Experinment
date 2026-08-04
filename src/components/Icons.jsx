export function Icon({ name, size = 20 }) {
  const paths = {
    profiles: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><circle cx="12" cy="13" r="2.2"/><path d="M9 19c.5-2 1.5-3 3-3s2.5 1 3 3"/></>,
    schema: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/><circle cx="4" cy="8" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="16" r=".6"/></>,
    models: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5"/></>,
    interaction: <><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></>,
    recaps: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    history: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M3 12H1"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/></>,
    save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
    play: <path d="m8 5 11 7-11 7z"/>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    comment: <><path d="M4 5h16v12H8l-4 4z"/><path d="M8 10h8M8 13h5"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3"/><path d="M21 20v-5h-5"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name] || paths.profiles}
    </svg>
  );
}
