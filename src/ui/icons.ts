const p = (d: string, extra = '') => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const icon = {
  check: p('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  plus: p('<path d="M12 5v14M5 12h14"/>'),
  edit: p('<path d="M4 20l4-1 11-11a2.1 2.1 0 00-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>'),
  moon: p('<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>'),
  sun: p('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>'),
  trash: p('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  list: p('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  undo: p('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  close: p('<path d="M6 6l12 12M18 6L6 18"/>'),
  menu: p('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  scroll: p('<path d="M7 4h11a2 2 0 012 2v10a3 3 0 01-3 3H7a3 3 0 01-3-3V6"/><path d="M7 4a2 2 0 00-2 2v1h3"/><path d="M9 9h7M9 13h7"/>'),
  seal: p('<circle cx="12" cy="10" r="6"/><path d="M8.5 15L7 21l5-2.5L17 21l-1.5-6"/><path d="M9.5 10l2 2 3-3.5"/>'),
  compass: p('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5L13.5 13.5 8.5 15.5 10.5 10.5z"/>'),
  chevron: p('<path d="M9 6l6 6-6 6"/>'),
  expand: p('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
};
