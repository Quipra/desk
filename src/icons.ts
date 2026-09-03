// Line icons for the tray, drawn once here so the DOM stays plain. All are
// 24x24, stroked with currentColor, so they inherit the theme's ink.

const wrap = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  hand: wrap('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 12.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.8-2.4L4.6 14.6a1.5 1.5 0 0 1 2.4-1.8L8 14"/>'),
  pen: wrap('<path d="M12 3l4 9-4 9-4-9z"/><path d="M12 12v9"/><path d="M8 12h8"/>'),
  pencil: wrap('<path d="M12 3l3.5 8L12 21l-3.5-10z"/><path d="M9.6 11h4.8"/>'),
  fineliner: wrap('<path d="M12 2l2 7-2 12-2-12z"/><path d="M10 9h4"/><path d="M12 15v6"/>'),
  marker: wrap('<rect x="8" y="3" width="8" height="10" rx="1.5"/><path d="M9 13l1.5 8h3L15 13"/>'),
  brush: wrap('<path d="M14 3l7 7-7 7-4-4z"/><path d="M10 13c-2 0-4 1-5 3-1 1-1 3-2 5 2-1 4-1 5-2 2-1 3-3 3-5"/>'),
  highlighter: wrap('<path d="M6 17l9-9 4 4-9 9H6z"/><path d="M15 8l3-3 4 4-3 3"/><path d="M4 21h6"/>'),
  eraser: wrap('<path d="M4 15l8-8 6 6-6 6H8z"/><path d="M14 21h6"/><path d="M8 11l6 6"/>'),
  ruler: wrap('<rect x="2.5" y="8" width="19" height="8" rx="1.5" transform="rotate(-30 12 12)"/><path d="M8 10l1.5 2.5M11 8.5l1.5 2.5M14 7l1.5 2.5" transform="rotate(-30 12 12)"/>'),
  compass: wrap('<path d="M12 3v3"/><circle cx="12" cy="7" r="1.5"/><path d="M11 8.5L6 21"/><path d="M13 8.5L18 21"/><path d="M8.5 15.5c2 1.4 5 1.4 7 0"/>'),
  stencil: wrap('<rect x="3" y="3" width="8" height="8" rx="1.5"/><circle cx="17" cy="7" r="4"/><path d="M7 21l4-7H3z"/>'),
  rectangle: wrap('<rect x="4" y="5" width="16" height="14" rx="2"/>'),
  triangle: wrap('<path d="M12 4l8 15H4z"/>'),
  polygon: wrap('<path d="M12 3l7.8 5.7-3 9.3H7.2l-3-9.3z"/>'),
  undo: wrap('<path d="M9 14L4 9l5-5"/><path d="M4 9h9a6 6 0 0 1 0 12H8"/>'),
  replay: wrap('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>'),
  play: wrap('<path d="M7 4l13 8-13 8z"/>', true),
  pause: wrap('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', true),
  grid: wrap('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'),
  lined: wrap('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>'),
  blank: wrap('<rect x="3" y="3" width="18" height="18" rx="2"/>'),
  dash: wrap('<path d="M3 12h4M10 12h4M17 12h4"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  minus: wrap('<path d="M5 12h14"/>'),
  fit: wrap('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  export: wrap('<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'),
  save: wrap('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3"/><rect x="8" y="14" width="8" height="5"/>'),
  library: wrap('<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="M17 5l4 15"/>'),
  trash: wrap('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  eye: wrap('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: wrap('<path d="M3 3l18 18"/><path d="M10.6 5.3A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C4 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1"/>'),
  front: wrap('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
  onion: wrap('<circle cx="10" cy="12" r="6"/><circle cx="14" cy="12" r="6" stroke-dasharray="2 2"/>'),
  loop: wrap('<path d="M17 4l3 3-3 3"/><path d="M4 11V9a2 2 0 0 1 2-2h14"/><path d="M7 20l-3-3 3-3"/><path d="M20 13v2a2 2 0 0 1-2 2H4"/>'),
  palette: wrap('<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor"/><path d="M12 21a3 3 0 0 1 0-6h2a2 2 0 0 0 0-4"/>'),
} as const;

export type IconName = keyof typeof ICONS;
