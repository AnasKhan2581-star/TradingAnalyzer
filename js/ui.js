// Generic UI building blocks: popups, menus, dialogs, toasts, color picker
import { el, $ } from './util.js';
import { I } from './icons.js';

let openPopup = null;
export function closePopup() { if (openPopup) { const p = openPopup; openPopup = null; p.close(); } }

export function popup(anchor, content, opts = {}) {
  closePopup();
  const box = el('div', { class: 'popup ' + (opts.class || '') }, content);
  document.body.appendChild(box);
  const place = () => {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw <= 600 && opts.sheet !== false) { box.classList.add('sheet'); return; }
    let x, y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = opts.side === 'right' ? r.right + 4 : r.left; y = opts.side === 'right' ? r.top : r.bottom + 4;
      if (opts.alignRight) x = r.right - box.offsetWidth;
    } else { x = anchor.x; y = anchor.y; }
    const w = box.offsetWidth, h = box.offsetHeight;
    if (x + w > vw - 4) x = Math.max(4, vw - w - 4);
    if (y + h > vh - 4) y = Math.max(4, (anchor instanceof Element && opts.side !== 'right' ? anchor.getBoundingClientRect().top - h - 4 : vh - h - 4));
    box.style.left = x + 'px'; box.style.top = y + 'px';
  };
  place();
  const onDown = (e) => { if (!box.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) closePopup(); };
  const onKey = (e) => { if (e.key === 'Escape') closePopup(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey); }, 0);
  const handle = {
    el: box,
    place,
    close() { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); box.remove(); anchor?.classList?.remove('open'); opts.onClose?.(); },
  };
  anchor?.classList?.add('open');
  openPopup = handle;
  return handle;
}

export function menuList(items, onPick) {
  const list = el('div', { class: 'menu' });
  for (const it of items) {
    if (it.divider) { list.append(el('div', { class: 'menu-div' })); continue; }
    if (it.header) { list.append(el('div', { class: 'menu-hdr' }, it.header)); continue; }
    if (it.el) { list.append(it.el); continue; }
    const row = el('button', { class: 'menu-item' + (it.checked ? ' checked' : '') + (it.danger ? ' danger' : ''), disabled: it.disabled },
      el('span', { class: 'mi-icon', html: it.icon ? (I[it.icon] || it.icon) : '' }),
      el('span', { class: 'mi-label' }, it.label),
      it.shortcut ? el('span', { class: 'mi-short' }, it.shortcut) : null,
      it.star != null ? el('span', { class: 'mi-star' + (it.star ? ' on' : ''), html: it.star ? I.starFill : I.star, onclick: (e) => { e.stopPropagation(); it.onStar?.(); } }) : null,
      it.sub ? el('span', { class: 'mi-sub', html: I.chevronR }) : null,
    );
    row.addEventListener('click', (e) => {
      if (it.sub) { e.stopPropagation(); const p = popup(row, menuList(it.sub, onPick), { side: 'right', sheet: false }); void p; return; }
      closePopup(); it.onClick?.(); onPick?.(it);
    });
    list.append(row);
  }
  return list;
}

export function menu(anchor, items, opts) { return popup(anchor, menuList(items), opts); }
export function contextMenu(x, y, items) { return popup({ x, y }, menuList(items), { class: 'ctx' }); }

export function dialog({ title, body, buttons = [], width = 460, onClose, cls = '', tabs = null }) {
  const overlay = el('div', { class: 'dlg-overlay' });
  const box = el('div', { class: 'dlg ' + cls, style: { width: width + 'px' } });
  const head = el('div', { class: 'dlg-head' }, el('div', { class: 'dlg-title' }, title), el('button', { class: 'icon-btn dlg-x', html: I.close, title: 'Close' }));
  const content = el('div', { class: 'dlg-body' });
  if (tabs) {
    const bar = el('div', { class: 'dlg-tabs' });
    const panes = tabs.map((t, i) => {
      const b = el('button', { class: 'dlg-tab' + (i ? '' : ' active') }, t.label);
      const pane = el('div', { class: 'dlg-pane', style: { display: i ? 'none' : '' } }, t.body);
      b.addEventListener('click', () => { bar.querySelectorAll('.dlg-tab').forEach((x) => x.classList.remove('active')); b.classList.add('active'); panes.forEach((p) => (p.style.display = 'none')); pane.style.display = ''; });
      bar.append(b); return pane;
    });
    content.append(bar, ...panes);
  } else if (body) content.append(body);
  const foot = el('div', { class: 'dlg-foot' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  for (const b of buttons) {
    const btn = el('button', { class: 'btn ' + (b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-ghost') + (b.left ? ' left' : '') }, b.label);
    btn.addEventListener('click', () => { const r = b.onClick?.(); if (r !== false) close(); });
    foot.append(btn);
  }
  box.append(head, content);
  if (buttons.length) box.append(foot);
  overlay.append(box);
  document.body.append(overlay);
  head.querySelector('.dlg-x').addEventListener('click', close);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  const onKey = (e) => { if (e.key === 'Escape' && !openPopup) close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => box.querySelector('input:not([type=checkbox]):not([type=color]),textarea')?.focus(), 30);
  return { el: box, body: content, close };
}

export function toast(msg, type = 'info', ms = 4000) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = el('div', { id: 'toasts' }); document.body.append(wrap); }
  const t = el('div', { class: 'toast ' + type }, el('span', { class: 'toast-msg', html: msg }), el('button', { class: 'toast-x', html: '&times;' }));
  wrap.append(t);
  const rm = () => { t.classList.add('out'); setTimeout(() => t.remove(), 250); };
  t.querySelector('.toast-x').addEventListener('click', rm);
  setTimeout(rm, ms);
  return t;
}

export function promptText(title, value = '', { multiline = false, label = '' } = {}) {
  return new Promise((res) => {
    const input = multiline ? el('textarea', { class: 'inp', rows: 4 }) : el('input', { class: 'inp', type: 'text' });
    input.value = value;
    let done = false;
    const d = dialog({
      title, width: 380, body: el('div', { class: 'form' }, label ? el('label', {}, label) : null, input),
      buttons: [{ label: 'Cancel' }, { label: 'Ok', primary: true, onClick: () => { done = true; res(input.value); } }],
      onClose: () => { if (!done) res(null); },
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { done = true; res(input.value); d.close(); } });
  });
}

export function confirmDlg(msg, okLabel = 'Yes') {
  return new Promise((res) => {
    let done = false;
    dialog({ title: 'Confirm', width: 360, body: el('p', { class: 'muted' }, msg), buttons: [{ label: 'Cancel' }, { label: okLabel, primary: true, onClick: () => { done = true; res(true); } }], onClose: () => { if (!done) res(false); } });
  });
}

export const PALETTE = [
  '#FFFFFF', '#D1D4DC', '#B2B5BE', '#9598A1', '#787B86', '#5D606B', '#434651', '#2A2E39', '#131722', '#000000',
  '#F23645', '#FF9800', '#FFEB3B', '#4CAF50', '#089981', '#00BCD4', '#2962FF', '#673AB7', '#9C27B0', '#E91E63',
  '#FCCBCD', '#FFE0B2', '#FFF9C4', '#C8E6C9', '#ACE5DC', '#B2EBF2', '#BBD9FB', '#D1C4E9', '#E1BEE7', '#F8BBD0',
  '#F77C80', '#FFB74D', '#FFF176', '#81C784', '#42BDA8', '#4DD0E1', '#5B9CF6', '#9575CD', '#BA68C8', '#F06292',
  '#B22833', '#F57C00', '#FBC02D', '#388E3C', '#056656', '#0097A7', '#1848CC', '#512DA8', '#7B1FA2', '#C2185B',
];

export function parseColor(c) {
  if (!c) return { hex: '#2962FF', a: 1 };
  if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.split('').map((x) => x + x).join(''); return { hex: '#' + h.slice(0, 6).toUpperCase(), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }; }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x)); return { hex: '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase(), a: +a }; }
  return { hex: c, a: 1 };
}
export function toColor(hex, a) {
  if (a >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${+a.toFixed(2)})`;
}

export function colorPicker(anchor, color, onChange, { alpha = true } = {}) {
  let { hex, a } = parseColor(color);
  const grid = el('div', { class: 'cp-grid' });
  for (const c of PALETTE) {
    const sw = el('button', { class: 'cp-sw' + (c === hex ? ' on' : ''), style: { background: c }, title: c });
    sw.addEventListener('click', () => { hex = c; grid.querySelectorAll('.cp-sw').forEach((x) => x.classList.remove('on')); sw.classList.add('on'); emit(); });
    grid.append(sw);
  }
  const custom = el('input', { type: 'color', value: hex, class: 'cp-custom', title: 'Custom color' });
  custom.addEventListener('input', () => { hex = custom.value.toUpperCase(); emit(); });
  const range = el('input', { type: 'range', min: 0, max: 100, value: Math.round(a * 100), class: 'cp-range' });
  const pct = el('span', { class: 'cp-pct' }, Math.round(a * 100) + '%');
  range.addEventListener('input', () => { a = range.value / 100; pct.textContent = range.value + '%'; emit(); });
  const emit = () => onChange(toColor(hex, a));
  const body = el('div', { class: 'cp' }, grid, el('div', { class: 'cp-row' }, el('label', { class: 'cp-plus' }, custom, el('span', { html: '+' })), alpha ? el('span', { class: 'cp-op' }, 'Opacity') : null, alpha ? range : null, alpha ? pct : null));
  return popup(anchor, body, { sheet: false });
}

export function colorSwatch(color, onChange, opts) {
  const b = el('button', { class: 'swatch-btn', type: 'button' }, el('span', { style: { background: color } }));
  b.addEventListener('click', (e) => { e.stopPropagation(); colorPicker(b, color, (c) => { color = c; b.firstChild.style.background = c; onChange(c); }, opts); });
  return b;
}

export function switchEl(checked, onChange) {
  const i = el('input', { type: 'checkbox' }); i.checked = !!checked;
  i.addEventListener('change', () => onChange(i.checked));
  return el('label', { class: 'switch' }, i, el('span'));
}

export function selectEl(options, value, onChange) {
  const s = el('select', { class: 'inp' });
  for (const o of options) { const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o; const op = el('option', { value: v }, l); if (String(v) === String(value)) op.selected = true; s.append(op); }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function numberEl(value, onChange, { min, max, step = 1 } = {}) {
  const i = el('input', { type: 'number', class: 'inp', step, value });
  if (min != null) i.min = min; if (max != null) i.max = max;
  i.addEventListener('input', () => { const v = parseFloat(i.value); if (isFinite(v)) onChange(v); });
  return i;
}

export function formRow(label, ...ctrls) { return el('div', { class: 'frow' }, el('label', { class: 'flabel' }, label), el('div', { class: 'fctrl' }, ...ctrls)); }
