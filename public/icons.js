const paths={
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  compact:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  collection:'<rect x="7" y="7" width="14" height="14" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12"/>',
  settings:'<path d="m9 3-.7 2.2-2 .9-2.1-.5-1.6 2.8 1.5 1.7-.2 2.2-1.4 1.8 1.6 2.8 2.2-.4 1.9 1L9 20h3l.8-2.1 2-1 2.2.4 1.6-2.8-1.4-1.8-.1-2.2 1.4-1.7-1.6-2.8-2.2.5-1.9-.9L12 3Z"/><circle cx="10.5" cy="11.5" r="3"/>',
  tag:'<path d="M20.5 13.5 13 21l-10-10V3h8l9.5 9.5a.7.7 0 0 1 0 1Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  'chevron-right':'<path d="m9 6 6 6-6 6"/>',
  'chevron-down':'<path d="m6 9 6 6 6-6"/>',
  'arrow-up-right':'<path d="M7 17 17 7M7 7h10v10"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5M21 12H9"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 16 5-5 5 5 3-3 5 5"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  drive:'<path d="m9 3 6 0 7 12-3 6H5l-3-6L9 3Zm0 0 10 18M15 3 5 21M2 15h20"/>',
  aperture:'<circle cx="12" cy="12" r="9"/><path d="m14.5 3.4 4.8 8.3M20.6 9.5l-4.8 8.3M18.1 18.6H8.5M9.5 20.6l-4.8-8.3M3.4 14.5l4.8-8.3M5.9 5.4h9.6"/>'
};
export function icon(name,size=18){if(name==='drive')return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path fill="#83a78f" d="M9 2 0 17l3 5L12 7Z"/><path fill="#d9c386" d="M9 2h6l9 15h-6Z"/><path fill="#a99dc7" d="M6 17h18l-3 5H3Z"/></svg>`;return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.image}</svg>`}
export function folderNavIcon(expandable,collapsed){
  return expandable ? icon(collapsed ? 'chevron-right' : 'chevron-down') : icon('folder');
}
export function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon,Number(el.dataset.iconSize)||18))}
