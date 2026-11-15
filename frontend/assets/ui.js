// Share accessible icons, safe markup, formatting, downloads, and focus handling.
const glyphs = {
  scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3m-8 0H5a2 2 0 0 1-2-2v-3M7 12h10"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 4-5 5 6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.3"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  tune: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/><rect x="10" y="10" width="4" height="4" rx="1"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  outside: '<path d="M6 18 18 6M8 6h10v10"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  leaf: '<path d="M20 4c-8 0-14 4-14 10a4 4 0 0 0 4 4c6 0 10-6 10-14ZM4 20l8-8"/>',
  alert: '<path d="M11 4a1.2 1.2 0 0 1 2 0l8 14a1.2 1.2 0 0 1-1 2H4a1.2 1.2 0 0 1-1-2Zm1 5v4m0 3h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3m4 0-1 14H6L5 6m5 4v6m4-6v6"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4m-12 5v4h16v-4"/>',
  eye: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 12-2l2 3M4 15l2 3a7 7 0 0 0 12-2"/>',
};

// Render a local SVG glyph with an accessible decorative wrapper.
export function icon(name, size = 20) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyphs[name] ?? glyphs.info}</svg>`;
}

// Escape user-visible values before inserting HTML markup.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[char]);
}

// Allow same-origin photos and locally generated image previews.
export function photoUrl(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)) return value;
  try {
    const parsed = new URL(value, location.href);
    return parsed.origin === location.origin || parsed.protocol === 'blob:' && parsed.origin === location.origin
    ? parsed.href : '';
  } catch { return ''; }
}

// Format a known timestamp or label an unavailable date explicitly.
export function formatDate(value) {
  if (value == null || value === '') return 'Not available';
  const parsed = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(parsed.getTime()) ? 'Not available' : new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(parsed);
}

// Format a finite confidence value as a percentage.
export function formatScore(value) {
  return typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(value)
  : 'Not available';
}

// Download a supplied file and release its temporary object URL.
export function saveDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Refresh markup while retaining focused controls and open details.
export function preserveFocus(container, markup) {
  if (container.innerHTML === markup) return;
  const active = document.activeElement;
  const key = container.contains(active) ? active.dataset.focus : undefined;
  const open = new Set([...container.querySelectorAll('details[open][data-detail]')].map(item => item.dataset.detail));
  container.innerHTML = markup;
  for (const item of container.querySelectorAll('details[data-detail]')) {
    item.open = open.has(item.dataset.detail);
  }
  if (key) container.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
