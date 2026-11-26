// Mobile UI (≤768px): app-style chart header, symbol/interval wheels, bottom tab bar,
// full-screen Watchlist / Explore / Alerts pages and the "Analysis hub" menu sheet.
import { $, $$, el, store, uid, fmtPrice, fmtPct, fmtSigned, intervalById, INTERVALS, isMobile, debounce } from './util.js';
import { SYMBOLS, findSymbol, symbolPrecision, symbolLogo, quoteCurrency } from './symbols.js';
import { hub } from './datafeed.js';
import { I, CHART_TYPES } from './icons.js';
import { menu, toast, promptText, contextMenu, closePopup } from './ui.js';
import * as D from './dialogs.js';
import * as Account from './account.js';
import { cloud } from './cloud.js';

let app;
let tab = 'chart';
const rowsById = new Map();
const ivShort = (id) => ({ '1d': '1D', '3d': '3D', '1w': '1W', '1M': '1M' }[id] || id);

export function initMobile(a) {
  app = a;
  buildNav();
  buildHeader();
  buildBar();
  extendFavBar();
  const applyInset = () => { for (const w of app.widgets) { w.chart.topInset = isMobile() ? 120 : 0; w.chart.render(); } };
  for (const w of app.widgets) if (isMobile()) { w.chart.legendCollapsed = true; w.chart._buildLegend(); }
  applyInset();
  app.on('layouts', applyInset); app.on('loaded', applyInset); window.addEventListener('resize', debounce(applyInset, 150));
  const refresh = () => { renderHeader(); renderWheels(); };
  for (const ev of ['symbol', 'interval', 'active', 'loaded', 'indicators', 'recent', 'layouts']) app.on(ev, refresh);
  app.on('alerts', () => { if (tab === 'alerts') renderPage(); });
  hub.on('quote', (id, q) => onQuote(id, q));
  window.addEventListener('resize', debounce(() => { if (!isMobile() && tab !== 'chart') setTab('chart'); }, 150));
  refresh();
}

/* ------------------------------------------------------------------ nav */
function buildNav() {
  const nav = $('#mobilenav'); nav.innerHTML = '';
  const tabs = [['watchlist', 'watchlist', 'Watchlist'], ['chart', 'chart2', 'Chart'], ['explore', 'explore', 'Explore'], ['alerts', 'alarm', 'Alerts'], ['menu', 'menu', 'Menu']];
  for (const [id, icon, label] of tabs) {
    const b = el('button', { dataset: { tab: id } }, el('span', { class: 'ico', html: I[icon] }), el('span', {}, label));
    if (id === 'menu') b.append(el('span', { class: 'nav-dot', hidden: !!cloud.user }));
    b.addEventListener('click', () => (id === 'menu' ? analysisHub() : setTab(id)));
    nav.append(b);
  }
  cloud.on('user', (u) => { const d = nav.querySelector('.nav-dot'); if (d) d.hidden = !!u; });
  markNav();
}
function markNav() { $$('#mobilenav [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); }
export function setTab(t) {
  tab = t;
  app.bottom.close(); app.panels.show(null); closeSheet(); document.body.classList.remove('lt-open');
  const page = $('#mpage');
  page.hidden = t === 'chart';
  document.body.classList.toggle('mpage-open', t !== 'chart');
  if (t !== 'chart') renderPage(); else { page.innerHTML = ''; app.onResize(); }
  markNav();
}

/* ------------------------------------------------------------------ chart header */
function buildHeader() {
  const h = $('#mhead');
  h.innerHTML = '';
  h.append(
    el('div', { class: 'mh-row' },
      el('button', { class: 'mh-sym', onclick: () => D.symbolSearch(app, (s) => app.active.setSymbol(s.id)) }, el('span', { class: 'mh-logo' }), el('span', { class: 'mh-name' })),
      el('button', { class: 'mh-pill', onclick: () => intervalPicker() }, el('span', { class: 'mh-mk' }), el('span', { class: 'mh-iv' })),
      el('span', { class: 'mh-sp' }),
      el('button', { class: 'mh-cur', onclick: () => detailsSheet() }, el('span', { class: 'mh-ccy' }), el('span', { html: I.chevron }))),
    el('div', { class: 'mh-px' }, el('span', { class: 'mh-last' }), el('span', { class: 'mh-chg' })),
    el('div', { class: 'mh-row3' },
      el('button', { class: 'mh-ind', onclick: () => toggleLegend() }, el('span', { class: 'mh-caret', html: I.chevron }), el('span', { class: 'mh-cnt' })),
      el('button', { class: 'mh-addind', title: 'Indicators', html: I.fx, onclick: () => D.indicatorsDialog(app) })),
  );
}
function toggleLegend() {
  const c = app.active.chart; c.legendCollapsed = !c.legendCollapsed; c._buildLegend(); c.render(); renderHeader();
}
function renderHeader() {
  const w = app.active; if (!w) return;
  const s = w.sym, h = $('#mhead');
  const logo = h.querySelector('.mh-logo'); logo.innerHTML = ''; logo.append(symbolLogo(s));
  h.querySelector('.mh-name').textContent = s.type === 'crypto' ? s.symbol : s.name;
  h.querySelector('.mh-iv').textContent = ivShort(w.cfg.interval);
  h.querySelector('.mh-ccy').textContent = quoteCurrency(s);
  const n = w.chart.indicators.length;
  h.querySelector('.mh-cnt').textContent = n;
  h.querySelector('.mh-ind').classList.toggle('open', !w.chart.legendCollapsed);
  h.querySelector('.mh-row3').style.display = n ? '' : 'none';
  const q = hub.quote(s.id); if (q) paintHeader(q);
}
function paintHeader(q) {
  const w = app.active, h = $('#mhead'); if (!w || !h) return;
  const prec = symbolPrecision(w.sym, q.last);
  const up = q.chg >= 0;
  const last = h.querySelector('.mh-last'), chg = h.querySelector('.mh-chg');
  last.textContent = fmtPrice(q.last, prec); last.className = 'mh-last ' + (up ? 'up' : 'down');
  chg.textContent = `${fmtSigned(q.chg, prec)} (${fmtPct(q.chgPct)})`; chg.className = 'mh-chg ' + (up ? 'up' : 'down');
  h.querySelector('.mh-mk').className = 'mh-mk ' + (q.open_ === false ? 'closed' : q.live ? 'live' : 'sim');
}

/* ------------------------------------------------------------------ bottom chart bar */
function buildBar() {
  const bar = $('#mbar'); bar.innerHTML = '';
  const act = (icon, title, fn, cls = '') => el('button', { class: 'mb-act ' + cls, title, html: I[icon], onclick: (e) => fn(e.currentTarget) });
  bar.append(
    el('div', { class: 'mb-wheels' }, el('div', { class: 'wheel sym-wheel' }), el('div', { class: 'wheel iv-wheel' })),
    el('div', { class: 'mb-acts' },
      act('pencil', 'Drawing tools', () => toggleDrawMode(), 'draw-btn'),
      act('trade2', 'Paper trading', () => { app.panels.show(null); app.bottom.open('trading'); }),
      act('dots', 'More', (b) => quickMenu(b)),
      el('span', { class: 'mb-sep' }),
      act('undoArrow', 'Undo', () => app.active.chart.undo())));
}
function makeWheel(box, items, sel, onPick, onTapSel) {
  const H = 30;
  box.innerHTML = '';
  const inner = el('div', { class: 'wheel-in' });
  items.forEach((it, i) => {
    const d = el('div', { class: 'wi' + (i === sel ? ' on' : '') }, it);
    d.addEventListener('click', () => { if (i === cur) onTapSel?.(); else box.scrollTo({ top: i * H, behavior: 'smooth' }); });
    inner.append(d);
  });
  box.append(inner);
  let cur = sel;
  box.scrollTop = sel * H;
  const settle = debounce(() => { const i = Math.max(0, Math.min(items.length - 1, Math.round(box.scrollTop / H))); if (i !== cur) { cur = i; onPick(i); } }, 180);
  box.onscroll = () => {
    const i = Math.round(box.scrollTop / H);
    inner.querySelectorAll('.wi').forEach((x, k) => x.classList.toggle('on', k === i));
    settle();
  };
}
function renderWheels() {
  const w = app.active; if (!w || !$('#mbar .sym-wheel')) return;
  let recent = store.get('recentSymbols', []).filter((id) => findSymbol(id));
  if (!recent.includes(w.cfg.symbol)) recent.unshift(w.cfg.symbol);
  for (const s of ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'NASDAQ:AAPL', 'SP:SPX']) if (recent.length < 4 && !recent.includes(s)) recent.push(s);
  recent = recent.slice(0, 12);
  makeWheel($('#mbar .sym-wheel'), recent.map((id) => findSymbol(id).symbol.replace(/USDT$/, '').slice(0, 8)), recent.indexOf(w.cfg.symbol),
    (i) => app.active.setSymbol(recent[i]), () => D.symbolSearch(app, (s) => app.active.setSymbol(s.id)));
  let ivs = [...new Set([...app.favIntervals, w.cfg.interval])].sort((a, b) => intervalById(a).ms - intervalById(b).ms);
  makeWheel($('#mbar .iv-wheel'), ivs.map(ivShort), ivs.indexOf(w.cfg.interval), (i) => app.setIntervalActive(ivs[i]), () => intervalPicker());
}

function intervalPicker() {
  const cur = app.active.cfg.interval;
  const H = 46;
  const ov = el('div', { class: 'ivp-ov' });
  const list = el('div', { class: 'ivp' });
  const inner = el('div', { class: 'ivp-in' });
  INTERVALS.forEach((iv, i) => {
    const d = el('div', { class: 'ivp-i' + (iv.id === cur ? ' on' : '') }, iv.label);
    d.addEventListener('click', () => { app.setIntervalActive(iv.id); ov.remove(); });
    inner.append(d);
  });
  list.append(inner); ov.append(list); document.body.append(ov);
  let idx = Math.max(0, INTERVALS.findIndex((x) => x.id === cur));
  list.scrollTop = idx * H;
  list.addEventListener('scroll', () => { idx = Math.round(list.scrollTop / H); inner.querySelectorAll('.ivp-i').forEach((x, k) => x.classList.toggle('on', k === idx)); });
  ov.addEventListener('click', (e) => { if (e.target === ov) { const iv = INTERVALS[Math.min(INTERVALS.length - 1, idx)]; if (iv.id !== cur) app.setIntervalActive(iv.id); ov.remove(); } });
}

function toggleDrawMode(force) {
  const on = force ?? !document.body.classList.contains('draw-mode');
  document.body.classList.toggle('draw-mode', on);
  if (!on) { app.setTool(null); document.body.classList.remove('lt-open'); }
  $('#mbar .draw-btn')?.classList.toggle('on', on);
  if (on && !app.favTools.length) document.body.classList.add('lt-open');
}
function extendFavBar() {
  const orig = app.renderFavBar.bind(app);
  app.renderFavBar = () => {
    orig();
    const fb = $('#favbar'); if (!fb) return;
    if (!fb.querySelector('.fb-grip')) fb.prepend(el('span', { class: 'fb-grip', html: '<svg viewBox="0 0 8 18" width="8" height="18"><g fill="currentColor"><circle cx="2" cy="3" r="1.3"/><circle cx="6" cy="3" r="1.3"/><circle cx="2" cy="9" r="1.3"/><circle cx="6" cy="9" r="1.3"/><circle cx="2" cy="15" r="1.3"/><circle cx="6" cy="15" r="1.3"/></g></svg>' }));
    fb.append(el('button', { class: 'lt-btn sm fb-more', title: 'All drawing tools', html: I.dots, onclick: () => document.body.classList.toggle('lt-open') }));
    if (isMobile()) fb.hidden = false;
  };
  app.renderFavBar();
}

function quickMenu(b) {
  const w = app.active;
  menu(b, [
    { label: 'Indicators', icon: 'fx', onClick: () => D.indicatorsDialog(app) },
    { label: 'Chart type', icon: 'candles', sub: CHART_TYPES.map((t) => ({ label: t.name, icon: t.icon, checked: t.id === w.cfg.type, onClick: () => { w.setType(t.id); app.updateTopbar(); } })) },
    { label: 'Compare symbol', icon: 'plusCircle', onClick: () => D.symbolSearch(app, (s) => w.addCompare(s.id), { compare: true }) },
    { label: 'Create alert', icon: 'alarm', onClick: () => D.alertDialog(app) },
    { label: 'Bar replay', icon: 'replay', onClick: () => app.toggleReplay() },
    { label: 'Reset chart view', icon: 'sync', onClick: () => w.chart.resetView() },
    { label: w.cfg.scaleMode === 'log' ? 'Regular scale' : 'Log scale', icon: 'chart', onClick: () => app.setScaleMode(w.cfg.scaleMode === 'log' ? 'normal' : 'log') },
    { label: 'Redo', icon: 'redo', onClick: () => w.chart.redo() },
    { label: 'Take a snapshot', icon: 'camera', onClick: () => app.screenshot() },
  ]);
}

/* ------------------------------------------------------------------ sheets */
let sheetEl = null;
function closeSheet() { if (sheetEl) { const s = sheetEl; sheetEl = null; s.classList.add('out'); setTimeout(() => s.remove(), 200); } }
function sheet(title, content, cls = '') {
  closeSheet(); closePopup();
  const panel = el('div', { class: 'msheet ' + cls }, el('div', { class: 'ms-handle' }), title ? el('div', { class: 'ms-title' }, title) : null, content);
  const ov = el('div', { class: 'msheet-ov' }, panel);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  // drag the handle down to dismiss
  const hd = panel.querySelector('.ms-handle');
  let y0 = null;
  hd.addEventListener('pointerdown', (e) => { y0 = e.clientY; hd.setPointerCapture(e.pointerId); });
  hd.addEventListener('pointermove', (e) => { if (y0 != null) panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  hd.addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 > 80) closeSheet(); else panel.style.transform = ''; y0 = null; });
  document.body.append(ov); sheetEl = ov;
  return panel;
}
const go = (fn) => () => { closeSheet(); setTimeout(fn, 60); };

function analysisHub() {
  const w = app.active;
  const tile = (icon, label, fn, cls = '') => el('button', { class: 'hub-tile ' + cls, onclick: go(fn) }, el('span', { class: 'ht-i', html: I[icon] }), el('span', { class: 'ht-l' }, label));
  const grid = (cols, ...tiles) => el('div', { class: 'hub-grid c' + cols }, ...tiles);
  const curName = app.savedLayouts.find((l) => l.id === store.get('currentLayout', null))?.name || 'Unnamed';
  const openPanel = (id) => () => { setTab('chart'); app.panels.show(id); };
  const openBottom = (id) => () => { setTab('chart'); app.bottom.open(id); };
  const content = el('div', { class: 'hub' },
    grid(3, tile('square', 'Layout setup', () => app.layoutMenu($('#mbar .mb-acts'))), tile('manage', `Manage ${curName}`, () => app.layoutsDialog()), tile('gearHex', 'Chart settings', () => D.chartSettings(app))),
    grid(3, tile('newChart', 'New', () => app.newLayout()), tile('cloudUp', 'Save', () => app.saveLayoutAs()), tile('folder', 'Open', () => app.layoutsDialog())),
    el('div', { class: 'hub-div' }),
    el('button', { class: 'hub-trade', onclick: go(openBottom('trading')) }, el('span', { html: I.trade2 }), el('span', {}, 'Trade with paper trading')),
    el('div', { class: 'hub-h' }, 'TOOLS'),
    grid(2, tile('indicatorsBars', 'Indicators', () => D.indicatorsDialog(app)), tile('plusCircle', 'Compare', () => D.symbolSearch(app, (s) => w.addCompare(s.id), { compare: true })),
      tile('alarm', 'Alerts', () => D.alertDialog(app)), tile('rewind', 'Bar Replay', () => { setTab('chart'); app.toggleReplay(); })),
    grid(3, tile('templates', 'Indicator templates', () => app.templatesMenu($('#mbar .mb-acts'))), tile('candles', 'Chart type', () => quickTypes()), tile('layers', 'Object Tree', openPanel('objtree'))),
    el('div', { class: 'hub-h' }, 'INFO'),
    grid(2, tile('details', 'Symbol details', () => detailsSheet()), tile('datawindow', 'Data Window', openPanel('datawindow')),
      tile('screener', 'Stock Screener', openBottom('screener')), tile('strategy', 'Strategy Tester', openBottom('strategy')),
      tile('code', 'Script Editor', openBottom('editor')), tile('hotlist', 'Hotlists', openPanel('hotlist'))),
    el('div', { class: 'hub-h' }, 'ACCOUNT & APP'),
    grid(2, cloud.user ? tile('user', cloud.user.name || 'Account', () => Account.menu(app, $('#mobilenav [data-tab=menu]'))) : tile('user', 'Sign in with Google', () => Account.signInDialog(app), 'accent'),
      tile(app.theme === 'dark' ? 'sun' : 'moon', app.theme === 'dark' ? 'Light theme' : 'Dark theme', () => app.toggleTheme()),
      tile('camera', 'Snapshot', () => app.screenshot()), tile('download', 'Export / backup', () => app.saveMenu($('#mbar .mb-acts')))),
  );
  sheet('Analysis hub', content, 'tall');
}
function quickTypes() {
  const w = app.active;
  const box = el('div', { class: 'type-grid' }, ...CHART_TYPES.map((t) => el('button', { class: 'hub-tile' + (t.id === w.cfg.type ? ' on' : ''), onclick: go(() => { w.setType(t.id); app.updateTopbar(); }) }, el('span', { class: 'ht-i', html: I[t.icon] }), el('span', { class: 'ht-l' }, t.name))));
  sheet('Chart type', box);
}
function detailsSheet() {
  const box = el('div', { class: 'details m-details' });
  sheet(null, box);
  app.panels.detEl = box; app.panels.renderDetails();
}

/* ------------------------------------------------------------------ pages */
function renderPage() {
  const page = $('#mpage'); page.innerHTML = ''; rowsById.clear();
  if (tab === 'watchlist') watchlistPage(page);
  else if (tab === 'explore') explorePage(page);
  else if (tab === 'alerts') alertsPage(page);
}
function pageHead(title, left, right) { return el('div', { class: 'mp-head' }, el('div', { class: 'mp-l' }, left || ''), el('div', { class: 'mp-title' }, title), el('div', { class: 'mp-r' }, right || '')); }
const iconBtn = (icon, title, fn) => el('button', { class: 'mp-ib', title, html: I[icon], onclick: (e) => fn(e.currentTarget) });

function symRow(id, opt = {}) {
  const s = findSymbol(id); if (!s) return null;
  const px = el('div', { class: 'mr-px' }), ch = el('div', { class: 'mr-ch' });
  const row = el('div', { class: 'mrow' + (id === app.active?.cfg.symbol ? ' active' : '') }, symbolLogo(s, 'xl'),
    el('div', { class: 'mr-sym' }, el('b', {}, s.symbol, hub.isLive(s) ? el('span', { class: 'mr-live' }) : el('span', { class: 'mr-sim' }, 'SIM')), el('span', {}, s.name)),
    el('div', { class: 'mr-right' }, px, ch));
  row.addEventListener('click', () => { app.active.setSymbol(id); setTab('chart'); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); opt.menu?.(e); });
  rowsById.set(id, { px, ch, s });
  const q = hub.quote(id); if (q) paintRow(id, q);
  return row;
}
function paintRow(id, q) {
  const r = rowsById.get(id); if (!r) return;
  const prec = symbolPrecision(r.s, q.last), prev = r.last;
  r.px.textContent = fmtPrice(q.last, prec);
  r.ch.textContent = `${fmtSigned(q.chg, prec)}  ${fmtPct(q.chgPct)}`;
  r.ch.className = 'mr-ch ' + (q.chg >= 0 ? 'up' : 'down');
  if (prev != null && prev !== q.last) { r.px.classList.remove('fl-up', 'fl-dn'); void r.px.offsetWidth; r.px.classList.add(q.last > prev ? 'fl-up' : 'fl-dn'); }
  r.last = q.last;
}
function onQuote(id, q) {
  if (id === app.active?.cfg.symbol) { paintHeader(q); if (sheetEl && app.panels.detEl?.classList.contains('m-details')) app.panels.paintDetails(q); }
  if (tab !== 'chart') paintRow(id, q);
}

/* ---- watchlist with multiple lists ---- */
function wlState() {
  let st = store.get('wlLists', null);
  if (!st || !st.lists?.length) st = { active: 'main', lists: [{ id: 'main', name: 'Watchlist' }] };
  return st;
}
function switchList(id) {
  const st = wlState(), cur = st.lists.find((l) => l.id === st.active), next = st.lists.find((l) => l.id === id);
  if (!next || id === st.active) return;
  if (cur) cur.data = app.panels.wl;
  app.panels.wl = next.data || [{ name: 'MY LIST', open: true, items: [] }];
  app.panels.saveWl(); st.active = id; store.set('wlLists', st);
  if (app.panels.cur === 'watchlist') app.panels.render();
  renderPage();
}
function watchlistPage(page) {
  const P = app.panels, st = wlState();
  const head = pageHead('Watchlist',
    iconBtn('dots', 'More', (b) => menu(b, [
      { label: 'Add symbol', icon: 'plus', onClick: () => D.symbolSearch(app, (s) => { P.addSymbol(s.id); renderPage(); }) },
      { label: 'Add section', icon: 'plus', onClick: async () => { const n = await promptText('Section name', 'NEW SECTION'); if (n) { P.wl.push({ name: n.toUpperCase(), open: true, items: [] }); P.saveWl(); renderPage(); } } },
      { label: 'Sort by change %', icon: 'chart', onClick: () => { for (const s of P.wl) s.items.sort((a, b) => (hub.quote(b)?.chgPct || 0) - (hub.quote(a)?.chgPct || 0)); P.saveWl(); renderPage(); } },
      { label: 'Sort by symbol', icon: 'menu', onClick: () => { for (const s of P.wl) s.items.sort(); P.saveWl(); renderPage(); } },
      { label: 'Expand all', icon: 'chevron', onClick: () => { P.wl.forEach((s) => (s.open = true)); P.saveWl(); renderPage(); } },
      { label: 'Collapse all', icon: 'chevron', onClick: () => { P.wl.forEach((s) => (s.open = false)); P.saveWl(); renderPage(); } },
    ])),
    iconBtn('search', 'Add symbol', () => D.symbolSearch(app, (s) => { P.addSymbol(s.id); renderPage(); })));
  const lists = el('div', { class: 'wl-lists' },
    iconBtn('menu', 'Manage lists', (b) => {
      const cur = st.lists.find((l) => l.id === st.active);
      menu(b, [
        ...st.lists.map((l) => ({ label: l.name, checked: l.id === st.active, onClick: () => switchList(l.id) })),
        { divider: true },
        { label: 'Rename list', icon: 'pencil', onClick: async () => { const n = await promptText('Rename list', cur.name); if (n) { cur.name = n; store.set('wlLists', st); renderPage(); } } },
        st.lists.length > 1 ? { label: 'Delete list', icon: 'trash', danger: true, onClick: () => { const other = st.lists.find((l) => l.id !== st.active); switchList(other.id); const s2 = wlState(); s2.lists = s2.lists.filter((l) => l.id !== cur.id); store.set('wlLists', s2); renderPage(); } } : { label: 'Delete list', disabled: true },
      ]);
    }),
    el('span', { class: 'wl-vsep' }),
    ...st.lists.map((l) => el('button', { class: 'wl-chip' + (l.id === st.active ? ' on' : ''), onclick: () => switchList(l.id) }, l.name)),
    el('button', { class: 'wl-chip add', onclick: async () => {
      const n = await promptText('New watchlist', `List ${st.lists.length + 1}`); if (!n) return;
      const s2 = wlState(); const cur = s2.lists.find((l) => l.id === s2.active); if (cur) cur.data = P.wl;
      const id = uid(); s2.lists.push({ id, name: n, data: [{ name: 'MY LIST', open: true, items: [app.active.cfg.symbol] }] }); store.set('wlLists', s2); switchList(id);
    } }, el('span', { html: I.plus }), 'Add list'));
  const body = el('div', { class: 'mp-body' });
  P.wl.forEach((sec, si) => {
    const h = el('div', { class: 'ms-sec' + (sec.open ? ' open' : '') }, el('span', { class: 'ms-caret', html: I.chevronR }), el('span', {}, titleCase(sec.name)), el('span', { class: 'ms-n' }, sec.items.length));
    h.addEventListener('click', () => { sec.open = !sec.open; P.saveWl(); renderPage(); });
    h.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, [
      { label: 'Rename section', icon: 'pencil', onClick: async () => { const n = await promptText('Rename section', sec.name); if (n) { sec.name = n.toUpperCase(); P.saveWl(); renderPage(); } } },
      { label: 'Add symbol here', icon: 'plus', onClick: () => D.symbolSearch(app, (s) => { P.addSymbol(s.id, sec); renderPage(); }) },
      { label: 'Remove section', icon: 'trash', danger: true, onClick: () => { P.wl.splice(si, 1); P.saveWl(); renderPage(); } },
    ]); });
    body.append(h);
    if (!sec.open) return;
    for (const id of sec.items) {
      const r = symRow(id, { menu: (e) => contextMenu(e.clientX, e.clientY, [
        { label: 'Open chart', icon: 'chart', onClick: () => { app.active.setSymbol(id); setTab('chart'); } },
        { label: 'Add alert', icon: 'alarm', onClick: () => { app.active.setSymbol(id); setTab('chart'); D.alertDialog(app); } },
        { label: 'Trade', icon: 'trade', onClick: () => app.bottom.trading.ticket(id, 'buy') },
        { label: 'Remove from watchlist', icon: 'trash', danger: true, onClick: () => { sec.items = sec.items.filter((x) => x !== id); P.saveWl(); renderPage(); } },
      ]) });
      if (r) body.append(r);
    }
  });
  body.append(el('button', { class: 'mp-add', onclick: () => D.symbolSearch(app, (s) => { P.addSymbol(s.id); renderPage(); }) }, el('span', { html: I.plus }), 'Add symbol'));
  page.append(head, lists, body);
}
const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/* ---- explore ---- */
const sparkCache = new Map();
function spark(s, cv) {
  const draw = (bars) => {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 120, h = cv.clientHeight || 36;
    cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const v = bars.slice(-48).map((b) => b.c); if (v.length < 2) return;
    const lo = Math.min(...v), hi = Math.max(...v), up = v[v.length - 1] >= v[0];
    const col = up ? '#089981' : '#F23645';
    const X = (i) => (i / (v.length - 1)) * w, Y = (x) => 3 + (1 - (x - lo) / (hi - lo || 1)) * (h - 6);
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, up ? 'rgba(8,153,129,.3)' : 'rgba(242,54,69,.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.beginPath(); v.forEach((x, i) => (i ? c.lineTo(X(i), Y(x)) : c.moveTo(X(i), Y(x)))); c.lineTo(w, h); c.lineTo(0, h); c.fillStyle = g; c.fill();
    c.beginPath(); v.forEach((x, i) => (i ? c.lineTo(X(i), Y(x)) : c.moveTo(X(i), Y(x)))); c.strokeStyle = col; c.lineWidth = 1.5; c.stroke();
  };
  const b = sparkCache.get(s.id);
  if (b) requestAnimationFrame(() => draw(b));
  else hub.getBars(s, '1h').then((bars) => { sparkCache.set(s.id, bars); draw(bars); }).catch(() => {});
}
function explorePage(page) {
  const head = pageHead('Explore', '', iconBtn('search', 'Search', () => D.symbolSearch(app, (s) => { app.active.setSymbol(s.id); setTab('chart'); })));
  const body = el('div', { class: 'mp-body' });
  const card = (id) => {
    const s = findSymbol(id); const q = hub.quote(id); const cv = el('canvas', { class: 'ex-spark' });
    const prec = symbolPrecision(s, q?.last || s.price);
    const c = el('button', { class: 'ex-card', onclick: () => { app.active.setSymbol(id); setTab('chart'); } },
      el('div', { class: 'ex-top' }, symbolLogo(s), el('b', {}, s.symbol.replace(/USDT$/, ''))),
      el('div', { class: 'ex-name' }, s.name),
      cv,
      el('div', { class: 'ex-px' }, q ? fmtPrice(q.last, prec) : '—'),
      el('div', { class: 'ex-ch ' + (q && q.chg >= 0 ? 'up' : 'down') }, q ? fmtPct(q.chgPct) : ''));
    setTimeout(() => spark(s, cv), 0);
    return c;
  };
  const section = (title, more) => el('div', { class: 'ex-h' }, el('b', {}, title), more ? el('button', { class: 'ex-more', onclick: more }, 'See all ', el('span', { html: I.chevronR })) : '');
  const movers = (type, dir, n = 5) => SYMBOLS.filter((s) => s.type === type).map((s) => ({ s, q: hub.quote(s.id) })).filter((x) => x.q).sort((a, b) => dir * (b.q.chgPct - a.q.chgPct)).slice(0, n).map((x) => symRow(x.s.id));
  const openScreener = () => { setTab('chart'); app.bottom.open('screener'); };
  let stockTab = 1;
  const stockBox = el('div');
  const seg = el('div', { class: 'seg ex-seg' }, ...[[1, 'Top gainers'], [-1, 'Top losers']].map(([d, l]) => el('button', { class: d === stockTab ? 'on' : '', onclick: (e) => { stockTab = d; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === e.currentTarget)); stockBox.innerHTML = ''; stockBox.append(...movers('stock', d)); } }, l)));
  stockBox.append(...movers('stock', 1));
  body.append(
    section('Market summary'),
    el('div', { class: 'ex-cards' }, ...['SP:SPX', 'NASDAQ:NDX', 'DJ:DJI', 'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'OANDA:XAUUSD', 'XETR:DAX', 'TVC:NI225'].map(card)),
    section('Stocks', openScreener), seg, stockBox,
    section('Crypto movers', openScreener), ...movers('crypto', 1, 6),
    section('Forex & commodities'), ...['FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'OANDA:XAUUSD', 'NYMEX:USOIL'].map((id) => symRow(id)),
    section('Tools'),
    el('div', { class: 'hub-grid c2' }, ...[['screener', 'Stock Screener', 'screener'], ['strategy', 'Strategy Tester', 'strategy'], ['code', 'Script Editor', 'editor'], ['trade2', 'Paper Trading', 'trading']].map(([icon, l, id]) =>
      el('button', { class: 'hub-tile', onclick: () => { setTab('chart'); app.bottom.open(id); } }, el('span', { class: 'ht-i', html: I[icon] }), el('span', { class: 'ht-l' }, l)))),
  );
  page.append(head, body);
}

/* ---- alerts ---- */
function alertsPage(page) {
  const head = pageHead('Alerts', '', iconBtn('plus', 'Create alert', () => D.alertDialog(app)));
  const body = el('div', { class: 'mp-body alerts-page' });
  app.panels.renderAlerts(body);
  page.append(head, body);
}
