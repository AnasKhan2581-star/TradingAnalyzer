// Main application controller
import { $, $$, el, store, Emitter, intervalById, INTERVALS, DAY, HOUR, MIN, WEEK, fmtPrice, uid, download, isMobile, TimeZone, pad2, debounce, TIMEZONES, condLabel } from './util.js';
import { hub } from './datafeed.js';
import { SYMBOLS, findSymbol, symbolPrecision, SYMBOL_COLORS } from './symbols.js';
import { Chart } from './chart.js';
import { indicatorById, defaultInputs } from './indicators.js';
import { TOOLS, TOOL_GROUPS, EMOJIS } from './drawings.js';
import { I, TOOL_ICON, CHART_TYPES } from './icons.js';
import { popup, menu, menuList, closePopup, contextMenu, toast, promptText, colorPicker, confirmDlg, dialog } from './ui.js';
import * as D from './dialogs.js';
import { Panels } from './panels.js';
import { Bottom } from './bottom.js';

const COMPARE_COLORS = ['#FF9800', '#E91E63', '#00BCD4', '#9C27B0', '#4CAF50', '#795548'];
const LAYOUTS = [
  { id: '1', name: '1 chart', n: 1 }, { id: '2v', name: '2 charts — vertical split', n: 2 }, { id: '2h', name: '2 charts — horizontal split', n: 2 },
  { id: '3', name: '3 charts', n: 3 }, { id: '3v', name: '3 charts — columns', n: 3 }, { id: '4', name: '4 charts — grid', n: 4 }, { id: '6', name: '6 charts — grid', n: 6 },
];
const RANGES = [
  { id: '1D', iv: '1m', span: DAY }, { id: '5D', iv: '5m', span: 5 * DAY }, { id: '1M', iv: '30m', span: 30 * DAY }, { id: '3M', iv: '1h', span: 91 * DAY },
  { id: '6M', iv: '2h', span: 182 * DAY }, { id: 'YTD', iv: '1d', span: 'ytd' }, { id: '1Y', iv: '1d', span: 365 * DAY }, { id: '5Y', iv: '1w', span: 5 * 365 * DAY }, { id: 'All', iv: '1M', span: 'all' },
];

const defaultWidget = (symbol = 'BINANCE:BTCUSDT', interval = '1h') => ({ symbol, interval, type: 'candles', indicators: [{ id: 'vol', inputs: defaultInputs(indicatorById('vol')), styles: {}, visible: true }], compares: [], scaleMode: 'normal' });

/* ============================== Chart widget ============================== */
class ChartWidget {
  constructor(app, cfg) {
    this.app = app; this.cfg = cfg;
    this.el = el('div', { class: 'cw' });
    this.chart = new Chart(this.el, { theme: app.theme, settings: app.settings });
    this.chart.scaleMode = cfg.scaleMode || 'normal';
    this.chart.type = cfg.type || 'candles';
    this.unsubs = []; this.cmpUnsubs = new Map(); this.token = 0; this.noMore = false;
    for (const ind of cfg.indicators || []) {
      const def = this.app.resolveDef(ind.id); if (!def) continue;
      const inst = this.chart.addIndicator(def, { ...defaultInputs(def), ...ind.inputs }, ind.styles || {}, { visible: ind.visible !== false });
      inst.cfg = ind;
    }
    this._bind();
  }
  get sym() { return findSymbol(this.cfg.symbol) || SYMBOLS[0]; }
  get iv() { return intervalById(this.cfg.interval); }
  _bind() {
    const c = this.chart, app = this.app;
    c.on('activate', () => app.setActive(this));
    c.on('needMore', () => this.loadMore());
    c.on('legend', (act, id) => this.onLegend(act, id));
    c.on('drawings', (list) => { store.set('drawings.' + this.cfg.symbol, list); for (const w of app.widgets) if (w !== this && w.cfg.symbol === this.cfg.symbol) w.chart.setDrawings(list); app.emit('drawings', this); });
    c.on('select', (d) => app.showDrawingToolbar(this, d));
    c.on('tool', (t) => app.setToolUI(t));
    c.on('requestText', async (d) => {
      const tool = TOOLS[d.type];
      if (tool.needsEmoji) return;
      const v = await promptText('Text', d.style.text, { multiline: true });
      if (v != null) { d.style.text = v; c._changed(); }
    });
    c.on('editDrawing', (d) => D.drawingSettings(this, d));
    c.on('crosshair', (x) => { app.onCrosshair(this, x); });
    c.on('contextmenu', (e) => app.chartContextMenu(this, e));
    c.on('click', (e) => app.onChartClick(this, e));
  }
  async load() {
    const tok = ++this.token;
    for (const u of this.unsubs) u(); this.unsubs = [];
    const sym = this.sym, iv = this.iv;
    const prec = symbolPrecision(sym, hub.quote(sym.id)?.last || sym.price);
    const info = { symbol: sym.symbol, title: sym.symbol, exchange: sym.exchange, ivLabel: iv.short, intervalMs: iv.ms, precision: prec, live: hub.isLive(sym), tradeButtons: this.app.settings.tradeButtons !== false };
    this.chart.loading = true; this.noMore = false;
    this.chart.setReplay(null);
    this.chart.setData([], info);
    this.chart.setDrawings(store.get('drawings.' + sym.id, []));
    let bars = [];
    try { bars = await hub.getBars(sym, iv.id); } catch (e) { toast('Failed to load data: ' + e.message, 'error'); }
    if (tok !== this.token) return;
    this.chart.loading = false;
    info.live = hub.isLive(sym);
    if (bars.length) info.precision = symbolPrecision(sym, bars[bars.length - 1].c);
    this.chart.setData(bars, info);
    this.chart.setDrawings(store.get('drawings.' + sym.id, []));
    const q = hub.quote(sym.id); this.chart.prevClose = q?.prev;
    this.unsubs.push(hub.subscribeBars(sym, iv.id, (bar) => { if (tok === this.token) { this.chart.update(bar); this.app.emit('bar', this); } }));
    for (const cmp of this.cfg.compares || []) this.loadCompare(cmp, tok);
    this.app.refreshAlertLines(); this.app.emit('loaded', this);
    if (this.pendingRange) { const r = this.pendingRange; this.pendingRange = null; this.applyRange(r); }
  }
  async loadMore() {
    if (this.loadingMore || this.noMore || !this.chart.bars.length) return;
    this.loadingMore = true; this.chart.loading = true;
    const tok = this.token;
    try {
      const older = await hub.getBars(this.sym, this.iv.id, this.chart.bars[0].t);
      if (tok === this.token) { if (!older.length) this.noMore = true; else this.chart.prepend(older); }
    } catch { this.noMore = true; }
    this.loadingMore = false; this.chart.loading = false;
  }
  async loadCompare(cmp, tok = this.token) {
    const sym = findSymbol(cmp.symbol); if (!sym) return;
    const bars = await hub.getBars(sym, this.iv.id).catch(() => []);
    if (tok !== this.token) return;
    const entry = { id: cmp.symbol, label: sym.symbol, bars, color: cmp.color, precision: symbolPrecision(sym, sym.price) };
    this.chart.addCompare(entry);
    const un = hub.subscribeBars(sym, this.iv.id, (bar) => { const b = entry.bars; if (!b.length) return; if (bar.t === b[b.length - 1].t) b[b.length - 1] = bar; else if (bar.t > b[b.length - 1].t) b.push(bar); this.chart.render(); });
    this.unsubs.push(un);
  }
  addCompare(symbolId) {
    if (this.cfg.compares.some((c) => c.symbol === symbolId) || symbolId === this.cfg.symbol) return;
    const cmp = { symbol: symbolId, color: COMPARE_COLORS[this.cfg.compares.length % COMPARE_COLORS.length] };
    this.cfg.compares.push(cmp); this.loadCompare(cmp); this.app.save();
  }
  removeCompare(id) { this.cfg.compares = this.cfg.compares.filter((c) => c.symbol !== id); this.chart.removeCompare(id); this.app.save(); }
  setSymbol(id) {
    if (!findSymbol(id)) return;
    this.cfg.symbol = id; this.cfg.compares = []; this.chart.compares = []; this.chart.setMarkers([]); this.chart._bidAsk = null;
    this.load(); this.app.save(); this.app.emit('symbol', this);
    if (this === this.app.active) this.app.updateTopbar();
    if (this.app.sync.symbol && this === this.app.active) for (const w of this.app.widgets) if (w !== this && w.cfg.symbol !== id) w.setSymbol(id);
  }
  setInterval(iv) { this.cfg.interval = iv; this.load(); this.app.save(); this.app.emit('interval', this); }
  setType(t) { this.cfg.type = t; this.chart.setType(t); this.app.save(); }
  addIndicator(def, inputs, styles) {
    const ind = { id: def.id, inputs: inputs || defaultInputs(def), styles: styles || {}, visible: true };
    const inst = this.chart.addIndicator(def, { ...defaultInputs(def), ...ind.inputs }, ind.styles);
    inst.cfg = ind; this.cfg.indicators.push(ind); this.app.save(); this.app.emit('indicators', this);
    return inst;
  }
  removeIndicator(uidv) {
    const inst = this.chart.indicators.find((i) => i.uid === uidv); if (!inst) return;
    this.cfg.indicators = this.cfg.indicators.filter((x) => x !== inst.cfg);
    this.chart.removeIndicator(uidv); this.app.save(); this.app.emit('indicators', this);
  }
  syncIndicatorCfg(inst) { if (inst.cfg) { inst.cfg.inputs = { ...inst.inputs }; inst.cfg.styles = JSON.parse(JSON.stringify(inst.styles)); inst.cfg.visible = inst.visible; } this.app.save(); }
  onLegend(act, id) {
    const c = this.chart;
    if (act === 'symbol') return D.symbolSearch(this.app, (s) => this.setSymbol(s.id));
    if (act === 'buy' || act === 'sell') return this.app.bottom.trading.ticket(this.cfg.symbol, act);
    if (act === 'cmpremove') return this.removeCompare(id);
    const inst = c.indicators.find((i) => i.uid === id); if (!inst) return;
    if (act === 'remove') this.removeIndicator(id);
    else if (act === 'toggle') { inst.visible = !inst.visible; c._buildLegend(); c.render(); this.syncIndicatorCfg(inst); }
    else if (act === 'settings') D.indicatorSettings(this, inst);
  }
  applyRange(r) {
    const now = Date.now();
    if (r.span === 'all') { const b = this.chart.disp; if (b.length) this.chart.setVisibleRange(b[0].t, now); return; }
    const from = r.span === 'ytd' ? Date.UTC(new Date().getUTCFullYear(), 0, 1) : now - r.span;
    this.chart.setVisibleRange(from, now);
  }
  destroy() { this.token++; for (const u of this.unsubs) u(); this.chart.destroy(); this.el.remove(); }
}

/* ============================== App ============================== */
class App extends Emitter {
  constructor() {
    super();
    this.theme = store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    this.settings = store.get('settings', {});
    this.layout = store.get('layout', '1');
    this.cfgs = store.get('widgets', null) || [defaultWidget()];
    this.activeIdx = Math.min(store.get('active', 0), this.cfgs.length - 1);
    this.favIntervals = store.get('favIntervals', ['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
    this.favTools = store.get('favTools', ['trendline', 'hline', 'fibretrace', 'rect', 'long']);
    this.lastTool = store.get('lastTool', {});
    this.sync = store.get('sync', { symbol: false, interval: false, crosshair: true, time: false });
    this.customScripts = store.get('scripts', []);
    this.templates = store.get('templates', []);
    this.tool = null; this.cursorMode = 'cross'; this.magnet = 0; this.stay = false; this.lockAll = false; this.hideAll = false;
    this.widgets = [];
    this.save = debounce(() => this._save(), 300);
  }
  _save() {
    store.set('widgets', this.widgets.map((w) => w.cfg)); store.set('layout', this.layout); store.set('active', this.activeIdx);
    store.set('settings', this.settings); store.set('theme', this.theme); store.set('favIntervals', this.favIntervals); store.set('sync', this.sync);
    store.set('favTools', this.favTools); store.set('lastTool', this.lastTool);
  }
  get active() { return this.widgets[this.activeIdx] || this.widgets[0]; }
  resolveDef(id) {
    if (id.startsWith('script_')) { const s = this.customScripts.find((x) => x.id === id); return s ? this.bottom.editor.compile(s.code, s.id) : null; }
    return indicatorById(id);
  }

  init() {
    document.documentElement.dataset.theme = this.theme;
    this.buildTopbar();
    this.buildLeftToolbar();
    this.buildBottomBar();
    this.panels = new Panels(this);
    this.bottom = new Bottom(this);
    this.buildLayout();
    this.bindKeys();
    hub.on('status', (s) => { $('#feedStatus').className = 'feed-status ' + (s.live ? 'live' : 'sim'); $('#feedStatus').title = s.live ? 'Connected to real-time crypto data (Binance)' : 'Real-time feed unavailable — simulated data'; });
    hub.startQuotes();
    hub.on('quote', (id, q) => this.onQuote(id, q));
    window.addEventListener('resize', debounce(() => this.onResize(), 100));
    this.onResize();
    if (Notification?.permission === 'default') { /* asked on first alert creation */ }
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.widgets.forEach((w) => w.chart.resize()), 50));
    setTimeout(() => $('#splash')?.remove(), 200);
  }

  /* ---------------------------- layout ---------------------------- */
  buildLayout() {
    const box = $('#charts');
    for (const w of this.widgets) w.destroy();
    this.widgets = [];
    const n = LAYOUTS.find((l) => l.id === this.layout)?.n || 1;
    while (this.cfgs.length < n) { const base = this.cfgs[this.cfgs.length - 1]; this.cfgs.push({ ...defaultWidget(base.symbol, base.interval) }); }
    box.className = 'layout-' + this.layout;
    box.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const w = new ChartWidget(this, this.cfgs[i]);
      this.widgets.push(w); box.append(w.el);
      w.chart.themeName = this.theme;
      w.load();
    }
    this.activeIdx = Math.min(this.activeIdx, n - 1);
    this.setActive(this.active, true);
    this.applyToolState();
    this.save();
  }
  setLayout(id) { this.cfgs = this.widgets.map((w) => w.cfg).concat(this.cfgs.slice(this.widgets.length)); this.layout = id; this.buildLayout(); }
  setActive(w, force) {
    const idx = this.widgets.indexOf(w); if (idx < 0) return;
    if (idx === this.activeIdx && !force) return;
    this.activeIdx = idx;
    this.widgets.forEach((x, i) => x.el.classList.toggle('active', i === idx && this.widgets.length > 1));
    this.updateTopbar(); this.save(); this.emit('active', w);
  }
  onResize() {
    document.body.classList.toggle('is-mobile', isMobile());
    this.widgets.forEach((w) => w.chart.resize());
  }

  /* ---------------------------- top bar ---------------------------- */
  buildTopbar() {
    $('#logo').innerHTML = I.logo + '<span>TradingAnalyzer</span>';
    const bind = (id, fn, icon, label) => { const b = $('#' + id); if (!b) return; if (icon) b.innerHTML = I[icon] + (label ? `<span class="lbl">${label}</span>` : ''); b.addEventListener('click', (e) => fn(e, b)); return b; };
    bind('btnMenu', (e, b) => this.mainMenu(b), 'menu');
    $('#btnSymbol').addEventListener('click', () => D.symbolSearch(this, (s) => this.active.setSymbol(s.id)));
    bind('btnCompare', () => D.symbolSearch(this, (s) => this.active.addCompare(s.id), { compare: true }), 'plusCircle');
    bind('btnType', (e, b) => this.typeMenu(b));
    bind('btnIndicators', () => D.indicatorsDialog(this), 'fx', 'Indicators');
    bind('btnTemplates', (e, b) => this.templatesMenu(b), 'templates');
    bind('btnAlert', () => D.alertDialog(this), 'alarm', 'Alert');
    bind('btnReplay', () => this.toggleReplay(), 'replay', 'Replay');
    bind('btnUndo', () => this.active.chart.undo(), 'undo');
    bind('btnRedo', () => this.active.chart.redo(), 'redo');
    bind('btnLayout', (e, b) => this.layoutMenu(b), 'layout');
    bind('btnSave', (e, b) => this.saveMenu(b), 'save', 'Save');
    bind('btnSettings', () => D.chartSettings(this), 'gear');
    bind('btnFullscreen', () => this.toggleFullscreen(), 'fullscreen');
    bind('btnShot', (e, b) => this.shotMenu(b), 'camera');
    bind('btnTheme', () => this.toggleTheme(), this.theme === 'dark' ? 'sun' : 'moon');
    bind('btnTrade', () => this.bottom.open('trading'), 'trade', 'Trade');
    this.renderIntervals();
    // replay bar
    $('#replayPlay').innerHTML = I.play; $('#replayStep').innerHTML = I.stepfwd; $('#replayBack').innerHTML = I.stepback; $('#replayExit').innerHTML = I.close;
    $('#replayPlay').addEventListener('click', () => this.replayPlay());
    $('#replayStep').addEventListener('click', () => this.replayStep(1));
    $('#replayBack').addEventListener('click', () => this.replayStep(-1));
    $('#replayExit').addEventListener('click', () => this.exitReplay());
    $('#replaySpeed').addEventListener('change', () => { if (this.replayTimer) { this.replayPlay(); this.replayPlay(); } });
    $('#replaySelect').addEventListener('click', () => { this.replaySelecting = true; toast('Click on the chart to choose a new start point', 'info'); });
  }
  renderIntervals() {
    const box = $('#intervals'); box.innerHTML = '';
    const cur = this.active?.cfg.interval || this.cfgs[this.activeIdx]?.interval;
    for (const id of this.favIntervals) {
      const iv = intervalById(id);
      const b = el('button', { class: 'tb-btn iv' + (id === cur ? ' on' : ''), title: iv.label }, iv.short);
      b.addEventListener('click', () => this.setIntervalActive(id));
      box.append(b);
    }
    const more = el('button', { class: 'tb-btn iv-more' + (this.favIntervals.includes(cur) ? '' : ' on'), title: 'Intervals', html: (this.favIntervals.includes(cur) ? '' : `<span>${intervalById(cur).short}</span>`) + I.chevron });
    more.addEventListener('click', () => {
      const items = [];
      let g = '';
      for (const iv of INTERVALS) {
        if (iv.group !== g) { g = iv.group; items.push({ header: g.toUpperCase() }); }
        items.push({ label: iv.label, checked: iv.id === cur, star: this.favIntervals.includes(iv.id), onStar: () => this.toggleFavInterval(iv.id), onClick: () => this.setIntervalActive(iv.id) });
      }
      menu(more, items, { class: 'iv-menu' });
    });
    box.append(more);
  }
  toggleFavInterval(id) {
    const i = this.favIntervals.indexOf(id);
    if (i >= 0) this.favIntervals.splice(i, 1); else { this.favIntervals.push(id); this.favIntervals.sort((a, b) => intervalById(a).ms - intervalById(b).ms); }
    this.save(); this.renderIntervals(); closePopup();
  }
  setIntervalActive(id) {
    const targets = this.sync.interval ? this.widgets : [this.active];
    for (const w of targets) w.setInterval(id);
    this.renderIntervals();
  }
  updateTopbar() {
    const w = this.active; if (!w) return;
    const s = w.sym;
    $('#symName').textContent = s.symbol;
    $('#symIcon').style.background = SYMBOL_COLORS[s.type];
    $('#symIcon').textContent = s.symbol[0];
    const t = CHART_TYPES.find((x) => x.id === w.cfg.type) || CHART_TYPES[1];
    $('#btnType').innerHTML = I[t.icon]; $('#btnType').title = t.name;
    this.renderIntervals();
    this.updateBottomBar();
    document.title = `${s.symbol} ${fmtPrice(hub.quote(s.id)?.last, symbolPrecision(s, s.price))} — TradingAnalyzer`;
  }
  typeMenu(b) {
    const cur = this.active.cfg.type;
    menu(b, CHART_TYPES.map((t) => ({ label: t.name, icon: t.icon, checked: t.id === cur, onClick: () => { this.active.setType(t.id); this.updateTopbar(); } })));
  }
  templatesMenu(b) {
    const T = [
      { name: 'Trend Trader', ind: [['vol'], ['ema', { length: 20 }], ['ema', { length: 50 }, { ma: { color: '#2962FF' } }], ['sma', { length: 200 }, { ma: { color: '#F23645' } }]] },
      { name: 'Momentum', ind: [['vol'], ['rsi'], ['macd']] },
      { name: 'Volatility', ind: [['vol'], ['bb'], ['atr']] },
      { name: 'Ichimoku Trader', ind: [['ichimoku'], ['vol']] },
      { name: 'Scalper', ind: [['vwap'], ['ema', { length: 9 }], ['stochrsi'], ['vol']] },
      { name: 'Swing', ind: [['supertrend'], ['ema', { length: 21 }], ['adx'], ['vol']] },
      { name: 'Clean chart', ind: [] },
    ];
    const apply = (list) => {
      const w = this.active;
      for (const i of w.chart.indicators.slice()) w.removeIndicator(i.uid);
      for (const [id, inp, st] of list) { const def = this.resolveDef(id); if (def) w.addIndicator(def, { ...defaultInputs(def), ...(inp || {}) }, st || {}); }
    };
    const items = [{ header: 'BUILT-IN TEMPLATES' }, ...T.map((t) => ({ label: t.name, icon: 'templates', onClick: () => apply(t.ind) }))];
    if (this.templates.length) items.push({ divider: true }, { header: 'MY TEMPLATES' }, ...this.templates.map((t) => ({ label: t.name, icon: 'star', onClick: () => apply(t.ind.map((x) => [x.id, x.inputs, x.styles])) })));
    items.push({ divider: true }, {
      label: 'Save indicator template…', icon: 'save', onClick: async () => {
        const name = await promptText('Save indicator template', 'My template'); if (!name) return;
        this.templates.push({ name, ind: this.active.cfg.indicators.map((x) => ({ id: x.id, inputs: x.inputs, styles: x.styles })) });
        store.set('templates', this.templates); toast('Template saved', 'success');
      },
    });
    if (this.templates.length) items.push({ label: 'Delete all my templates', icon: 'trash', danger: true, onClick: () => { this.templates = []; store.set('templates', []); } });
    menu(b, items);
  }
  layoutMenu(b) {
    const items = [{ header: 'LAYOUT' }, ...LAYOUTS.map((l) => ({ label: l.name, icon: 'layout', checked: l.id === this.layout, onClick: () => this.setLayout(l.id) })), { divider: true }, { header: 'SYNC IN LAYOUT' }];
    for (const [k, label] of [['symbol', 'Symbol'], ['interval', 'Interval'], ['crosshair', 'Crosshair'], ['time', 'Time']]) items.push({ label, checked: this.sync[k], icon: 'sync', onClick: () => { this.sync[k] = !this.sync[k]; this.save(); } });
    menu(b, items);
  }
  saveMenu(b) {
    menu(b, [
      { label: 'Save layout', icon: 'save', shortcut: 'Ctrl+S', onClick: () => { this._save(); toast('Chart layout saved', 'success'); } },
      { label: 'Export layout (JSON)', icon: 'download', onClick: () => this.exportLayout() },
      { label: 'Import layout…', icon: 'upload', onClick: () => this.importLayout() },
      { divider: true },
      { label: 'Export chart data (CSV)', icon: 'download', onClick: () => this.exportCSV() },
      { divider: true },
      { label: 'Reset everything', icon: 'trash', danger: true, onClick: async () => { if (await confirmDlg('Reset all layouts, drawings, alerts and settings?', 'Reset')) { localStorage.clear(); location.reload(); } } },
    ]);
  }
  exportLayout() {
    const data = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('ta.')) data[k] = localStorage.getItem(k); }
    download('tradinganalyzer-layout.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data)));
  }
  importLayout() {
    const inp = el('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      try { const data = JSON.parse(await inp.files[0].text()); for (const k in data) if (k.startsWith('ta.')) localStorage.setItem(k, data[k]); location.reload(); } catch { toast('Invalid layout file', 'error'); }
    });
    inp.click();
  }
  exportCSV() {
    const c = this.active.chart; const rows = ['time,open,high,low,close,volume', ...c.bars.map((b) => `${new Date(b.t).toISOString()},${b.o},${b.h},${b.l},${b.c},${b.v}`)];
    download(`${c.info.symbol}_${this.active.cfg.interval}.csv`, 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n')));
  }
  shotMenu(b) {
    menu(b, [
      { label: 'Download image', icon: 'download', shortcut: 'Alt+S', onClick: () => this.screenshot() },
      { label: 'Copy image', icon: 'copy', onClick: () => this.copyShot() },
      { label: 'Open in new tab', icon: 'link', onClick: () => { const w = window.open(); if (w) w.document.write(`<img src="${this.active.chart.screenshot()}" style="max-width:100%">`); } },
    ]);
  }
  screenshot() { const c = this.active.chart; download(`${c.info.symbol}_${Date.now()}.png`, c.screenshot()); toast('Snapshot saved', 'success'); }
  async copyShot() {
    try { const blob = await (await fetch(this.active.chart.screenshot())).blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copied to clipboard', 'success'); }
    catch { toast('Clipboard not available — downloading instead'); this.screenshot(); }
  }
  toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = this.theme;
    $('#btnTheme').innerHTML = this.theme === 'dark' ? I.sun : I.moon;
    for (const w of this.widgets) w.chart.setTheme(this.theme);
    $('meta[name=theme-color]').content = this.theme === 'dark' ? '#131722' : '#ffffff';
    this.save(); this.emit('theme');
  }
  applySettings(s) { Object.assign(this.settings, s); for (const w of this.widgets) w.chart.setSettings(s); if ('tradeButtons' in s) this.widgets.forEach((w) => { w.chart.info.tradeButtons = s.tradeButtons; w.chart._buildLegend(); }); this.updateBottomBar(); this.save(); }
  mainMenu(b) {
    const items = [
      { label: 'Indicators', icon: 'fx', onClick: () => D.indicatorsDialog(this) },
      { label: 'Compare symbol', icon: 'plusCircle', onClick: () => D.symbolSearch(this, (s) => this.active.addCompare(s.id), { compare: true }) },
      { label: 'Indicator templates', icon: 'templates', onClick: () => this.templatesMenu($('#btnType')) },
      { label: 'Create alert', icon: 'alarm', onClick: () => D.alertDialog(this) },
      { label: 'Bar replay', icon: 'replay', onClick: () => this.toggleReplay() },
      { divider: true },
      { label: 'Layout', icon: 'layout', onClick: () => this.layoutMenu($('#btnType')) },
      { label: 'Chart settings', icon: 'gear', onClick: () => D.chartSettings(this) },
      { label: 'Take a snapshot', icon: 'camera', onClick: () => this.screenshot() },
      { label: this.theme === 'dark' ? 'Light theme' : 'Dark theme', icon: this.theme === 'dark' ? 'sun' : 'moon', onClick: () => this.toggleTheme() },
      { label: 'Fullscreen', icon: 'fullscreen', onClick: () => this.toggleFullscreen() },
      { divider: true },
      { label: 'Save / export', icon: 'save', onClick: () => this.saveMenu($('#btnType')) },
      { label: 'Keyboard shortcuts', icon: 'code', onClick: () => D.shortcutsDialog() },
    ];
    menu(b, items);
  }

  /* ---------------------------- left toolbar ---------------------------- */
  buildLeftToolbar() {
    const bar = $('#lefttb'); bar.innerHTML = '';
    const cursorBtn = this.groupButton('cursor', [
      { id: 'cross', name: 'Cross', icon: 'cross' }, { id: 'dot', name: 'Dot', icon: 'dot' }, { id: 'arrow', name: 'Arrow', icon: 'arrow' }, { id: 'eraser', name: 'Eraser', icon: 'eraser' },
    ], (it) => this.setCursor(it.id), () => this.cursorMode);
    bar.append(cursorBtn);
    for (const g of TOOL_GROUPS) {
      bar.append(this.groupButton(g.id, g.tools.map((t) => ({ id: t, name: TOOLS[t].name, icon: TOOL_ICON[t] || 'trendline' })), (it) => this.setTool(it.id), () => this.tool, g.name));
    }
    const emo = el('button', { class: 'lt-btn', title: 'Icons & emoji', html: I.emoji });
    emo.addEventListener('click', () => {
      const grid = el('div', { class: 'emoji-grid' });
      for (const e of EMOJIS) { const b = el('button', {}, e); b.addEventListener('click', () => { this.lastTool.emojiChar = e; this.setTool('emoji'); closePopup(); }); grid.append(b); }
      popup(emo, grid, { side: 'right' });
    });
    emo.dataset.tool = 'emoji';
    bar.append(emo, el('div', { class: 'lt-sep' }));
    const simple = (id, icon, title, fn) => { const b = el('button', { class: 'lt-btn', title, html: I[icon], dataset: { k: id } }); b.addEventListener('click', () => fn(b)); bar.append(b); return b; };
    simple('measure', 'ruler', 'Measure (Shift + Click)', () => this.setTool(this.tool === 'measure' ? null : 'measure'));
    simple('zoom', 'zoomin', 'Zoom In', () => this.setTool(this.tool === 'zoom' ? null : 'zoom'));
    bar.append(el('div', { class: 'lt-sep' }));
    simple('magnet', 'magnet', 'Magnet Mode', (b) => menu(b, [
      { label: 'Weak Magnet', icon: 'magnet', checked: this.magnet === 1, onClick: () => this.setMagnet(this.magnet === 1 ? 0 : 1) },
      { label: 'Strong Magnet', icon: 'magnet', checked: this.magnet === 2, onClick: () => this.setMagnet(this.magnet === 2 ? 0 : 2) },
    ], { side: 'right' }));
    simple('stay', 'stay', 'Stay in Drawing Mode', () => { this.stay = !this.stay; this.applyToolState(); });
    simple('lock', 'lock', 'Lock All Drawings', () => { this.lockAll = !this.lockAll; this.applyToolState(); });
    simple('hide', 'eye', 'Hide All Drawings', () => { this.hideAll = !this.hideAll; this.applyToolState(); });
    simple('remove', 'trash', 'Remove objects', (b) => menu(b, [
      { label: 'Remove drawings', icon: 'trash', onClick: () => this.active.chart.removeAllDrawings() },
      { label: 'Remove indicators', icon: 'fx', onClick: () => { for (const i of this.active.chart.indicators.slice()) this.active.removeIndicator(i.uid); } },
      { label: 'Remove drawings & indicators', icon: 'trash', danger: true, onClick: () => { this.active.chart.removeAllDrawings(); for (const i of this.active.chart.indicators.slice()) this.active.removeIndicator(i.uid); } },
    ], { side: 'right' }));
    bar.append(el('div', { class: 'lt-sep' }));
    simple('fav', 'star', 'Favorite drawing tools', (b) => menu(b, this.favTools.filter((t) => TOOLS[t]).map((t) => ({ label: TOOLS[t].name, icon: TOOL_ICON[t], onClick: () => this.setTool(t), star: true, onStar: () => this.toggleFavTool(t) })).concat(this.favTools.length ? [] : [{ label: 'Star tools in any menu to add them here', disabled: true }]), { side: 'right' }));
    this.renderFavBar();
  }
  groupButton(gid, items, onPick, getCur, title) {
    const wrap = el('div', { class: 'lt-group' });
    const last = items.find((x) => x.id === this.lastTool[gid]) || items[0];
    const main = el('button', { class: 'lt-btn', title: last.name, html: I[last.icon], dataset: { group: gid, tool: last.id } });
    const arrow = el('button', { class: 'lt-arrow', title: title || 'More', html: I.chevronR });
    main.addEventListener('click', () => {
      const id = main.dataset.tool;
      if (gid === 'cursor') onPick({ id }); else if (this.tool === id) this.setTool(null); else onPick({ id });
    });
    arrow.addEventListener('click', () => {
      const cur = getCur();
      menu(arrow, [{ header: (title || 'Cursors').toUpperCase() }, ...items.map((it) => ({
        label: it.name, icon: it.icon, checked: it.id === cur,
        star: gid === 'cursor' ? null : this.favTools.includes(it.id), onStar: () => this.toggleFavTool(it.id),
        onClick: () => { this.lastTool[gid] = it.id; main.dataset.tool = it.id; main.innerHTML = I[it.icon]; main.title = it.name; this.save(); onPick(it); },
      }))], { side: 'right' });
    });
    wrap.append(main, arrow);
    return wrap;
  }
  toggleFavTool(t) { const i = this.favTools.indexOf(t); if (i >= 0) this.favTools.splice(i, 1); else this.favTools.push(t); this.save(); this.renderFavBar(); closePopup(); }
  renderFavBar() {
    let fb = $('#favbar');
    if (!fb) {
      fb = el('div', { id: 'favbar', title: 'Favorite drawing tools (drag to move)' }); $('#charts').parentElement.append(fb);
      const pos = store.get('favPos', null); if (pos) { fb.style.left = pos.x + 'px'; fb.style.top = pos.y + 'px'; fb.style.bottom = 'auto'; }
      fb.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault(); fb.setPointerCapture(e.pointerId);
        const r = fb.getBoundingClientRect(), pr = fb.parentElement.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const mv = (ev) => { const x = Math.max(0, Math.min(pr.width - r.width, ev.clientX - pr.left - dx)), y = Math.max(0, Math.min(pr.height - r.height, ev.clientY - pr.top - dy)); fb.style.left = x + 'px'; fb.style.top = y + 'px'; fb.style.bottom = 'auto'; };
        const up = () => { fb.removeEventListener('pointermove', mv); fb.removeEventListener('pointerup', up); store.set('favPos', { x: parseFloat(fb.style.left), y: parseFloat(fb.style.top) }); };
        fb.addEventListener('pointermove', mv); fb.addEventListener('pointerup', up);
      });
    }
    fb.innerHTML = '';
    fb.hidden = !this.favTools.length || this.settings.showFavBar === false;
    for (const t of this.favTools) { if (!TOOLS[t]) continue; const b = el('button', { class: 'lt-btn sm', title: TOOLS[t].name, html: I[TOOL_ICON[t]], dataset: { tool: t } }); b.addEventListener('click', () => this.setTool(this.tool === t ? null : t)); fb.append(b); }
    this.setToolUI(this.tool);
  }
  setTool(t) {
    this.tool = t;
    for (const w of this.widgets) {
      w.chart.setTool(t);
      if (t === 'emoji') w.chart.lastStyles = { ...(w.chart.lastStyles || {}), emoji: { text: this.lastTool.emojiChar || '🚀' } };
    }
    if (t) for (const g of TOOL_GROUPS) if (g.tools.includes(t)) { this.lastTool[g.id] = t; const m = $(`#lefttb [data-group="${g.id}"]`); if (m) { m.dataset.tool = t; m.innerHTML = I[TOOL_ICON[t]]; m.title = TOOLS[t].name; } }
    this.setToolUI(t); this.save();
    if (isMobile()) document.body.classList.remove('lt-open');
  }
  setToolUI(t) {
    this.tool = t;
    $$('#lefttb .lt-btn, #favbar .lt-btn').forEach((b) => {
      const tool = b.dataset.tool, g = b.dataset.group, k = b.dataset.k;
      let on = false;
      if (g === 'cursor') on = !t;
      else if (tool) on = tool === t;
      else if (k === 'measure') on = t === 'measure';
      else if (k === 'zoom') on = t === 'zoom';
      else if (k === 'magnet') on = !!this.magnet;
      else if (k === 'stay') on = this.stay;
      else if (k === 'lock') on = this.lockAll;
      else if (k === 'hide') on = this.hideAll;
      b.classList.toggle('on', on);
    });
    const hide = $('#lefttb [data-k="hide"]'); if (hide) hide.innerHTML = this.hideAll ? I.eyeOff : I.eye;
    const lock = $('#lefttb [data-k="lock"]'); if (lock) lock.innerHTML = this.lockAll ? I.lock : I.unlock;
    $('#mnDraw')?.classList.toggle('on', !!t);
  }
  setCursor(m) {
    this.cursorMode = m; this.lastTool.cursor = m;
    const b = $('#lefttb [data-group="cursor"]'); const icon = { cross: 'cross', dot: 'dot', arrow: 'arrow', eraser: 'eraser' }[m]; b.innerHTML = I[icon]; b.dataset.tool = m;
    this.setTool(null); this.applyToolState();
  }
  setMagnet(m) { this.magnet = m; this.applyToolState(); }
  applyToolState() {
    for (const w of this.widgets) Object.assign(w.chart, { cursorMode: this.cursorMode, magnet: this.magnet, stayDrawing: this.stay, lockAll: this.lockAll, hideAll: this.hideAll });
    this.widgets.forEach((w) => w.chart.render());
    this.setToolUI(this.tool);
  }

  /* ---------------------------- drawing floating toolbar ---------------------------- */
  showDrawingToolbar(w, d) {
    $('.draw-tb')?.remove();
    if (!d || !TOOLS[d.type]) return;
    const tool = TOOLS[d.type], c = w.chart;
    const tb = el('div', { class: 'draw-tb' });
    const props = tool.props || [];
    const colorKey = props.includes('color') ? 'color' : props.includes('textColor') ? 'textColor' : null;
    if (colorKey) {
      const sw = el('button', { class: 'dtb-btn', title: 'Color' }, el('span', { class: 'dtb-color', style: { background: d.style[colorKey] } }));
      sw.addEventListener('click', () => colorPicker(sw, d.style[colorKey], (col) => { c.updateDrawing(d, { [colorKey]: col }); sw.firstChild.style.background = col; }));
      tb.append(sw);
    }
    if (props.includes('fill')) {
      const sw = el('button', { class: 'dtb-btn', title: 'Background' }, el('span', { class: 'dtb-fill', style: { background: d.style.fill } }));
      sw.addEventListener('click', () => colorPicker(sw, d.style.fill, (col) => { c.updateDrawing(d, { fill: col, fillOn: true }); sw.firstChild.style.background = col; }));
      tb.append(sw);
    }
    if (props.includes('width')) {
      const b = el('button', { class: 'dtb-btn txt', title: 'Line width' }, `${d.style.width}px`);
      b.addEventListener('click', () => menu(b, [1, 2, 3, 4].map((n) => ({ label: `${n}px`, checked: d.style.width === n, onClick: () => { c.updateDrawing(d, { width: n }); b.textContent = `${n}px`; } })), { sheet: false }));
      tb.append(b);
    }
    if (props.includes('lineStyle')) {
      const b = el('button', { class: 'dtb-btn txt', title: 'Line style' }, d.style.lineStyle === 'dashed' ? '- -' : d.style.lineStyle === 'dotted' ? '···' : '—');
      b.addEventListener('click', () => menu(b, [['solid', '—  Solid'], ['dashed', '- -  Dashed'], ['dotted', '···  Dotted']].map(([v, l]) => ({ label: l, checked: d.style.lineStyle === v, onClick: () => { c.updateDrawing(d, { lineStyle: v }); b.textContent = l.split('  ')[0]; } })), { sheet: false }));
      tb.append(b);
    }
    if (props.includes('text')) {
      const b = el('button', { class: 'dtb-btn', title: 'Text', html: I.text });
      b.addEventListener('click', async () => { const v = await promptText('Text', d.style.text, { multiline: true }); if (v != null) c.updateDrawing(d, { text: v }); });
      tb.append(b);
    }
    const act = (icon, title, fn, cls = '') => { const b = el('button', { class: 'dtb-btn ' + cls, title, html: I[icon] }); b.addEventListener('click', fn); tb.append(b); return b; };
    act('gear', 'Settings', () => D.drawingSettings(w, d));
    act(d.locked ? 'lock' : 'unlock', d.locked ? 'Unlock' : 'Lock', () => { d.locked = !d.locked; c._changed(); this.showDrawingToolbar(w, d); });
    act('copy', 'Clone', () => c.cloneDrawing(d));
    act('alarm', 'Add alert on this drawing level', () => { const p = d.points[d.points.length > 1 && d.type !== 'hline' ? 1 : 0].p; D.alertDialog(this, { price: p }); });
    act('trash', 'Remove', () => c.removeDrawing(d), 'danger');
    tb.addEventListener('pointerdown', (e) => e.stopPropagation());
    w.el.append(tb);
  }

  /* ---------------------------- bottom bar ---------------------------- */
  buildBottomBar() {
    const bb = $('#rangebar');
    for (const r of RANGES) {
      const b = el('button', { class: 'bb-btn', title: `${r.id} range` }, r.id);
      b.addEventListener('click', () => {
        const w = this.active;
        if (w.cfg.interval !== r.iv) { w.pendingRange = r; w.setInterval(r.iv); this.renderIntervals(); } else w.applyRange(r);
      });
      bb.append(b);
    }
    const go = el('button', { class: 'bb-btn icon', title: 'Go to date… (Alt+G)', html: I.calendar });
    go.addEventListener('click', () => D.gotoDialog(this));
    bb.append(el('span', { class: 'bb-sep' }), go);
    const clock = $('#clock');
    const tick = () => {
      const tz = new TimeZone(this.settings.timezone || 'local');
      const d = tz.shift(Date.now());
      const name = (this.settings.timezone || 'local') === 'local' ? 'UTC' + fmtOffset(-new Date().getTimezoneOffset()) : this.settings.timezone === 'UTC' ? 'UTC' : this.settings.timezone.split('/').pop().replace('_', ' ');
      clock.textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} (${name})`;
    };
    setInterval(tick, 1000); tick();
    clock.addEventListener('click', () => menu(clock, TIMEZONES.map((z) => ({ label: z === 'local' ? 'Exchange / Local' : z, checked: (this.settings.timezone || 'local') === z, onClick: () => { this.applySettings({ timezone: z }); tick(); } }))));
    $('#btnPct').addEventListener('click', () => this.setScaleMode(this.active.cfg.scaleMode === 'percent' ? 'normal' : 'percent'));
    $('#btnLog').addEventListener('click', () => this.setScaleMode(this.active.cfg.scaleMode === 'log' ? 'normal' : 'log'));
    $('#btnAuto').addEventListener('click', () => { const c = this.active.chart; c.panes.forEach((p) => (p.scale.auto = true)); c.render(); this.updateBottomBar(); });
  }
  setScaleMode(m) { const w = this.active; w.cfg.scaleMode = m; w.chart.scaleMode = m; w.chart.panes[0].scale.auto = true; w.chart.render(); this.updateBottomBar(); this.save(); }
  updateBottomBar() {
    const w = this.active; if (!w) return;
    $('#btnPct').classList.toggle('on', w.cfg.scaleMode === 'percent');
    $('#btnLog').classList.toggle('on', w.cfg.scaleMode === 'log');
    $('#btnAuto').classList.toggle('on', w.chart.panes[0].scale.auto);
  }

  /* ---------------------------- events ---------------------------- */
  onCrosshair(w, x) {
    if (this.sync.crosshair && this.widgets.length > 1) {
      for (const o of this.widgets) {
        if (o === w) continue;
        if (!x) { o.chart.cross = null; o.chart.render(); continue; }
        const idx = Math.round(o.chart.tIdx(x.t));
        o.chart.cross = { idx, y: o.chart.cross?.y ?? -100, pane: o.chart.panes[0], ext: true };
        o.chart.render();
      }
    }
    this.emit('crosshair', w, x);
  }
  onQuote(id, q) {
    this.checkAlerts(id, q);
    for (const w of this.widgets) if (w.cfg.symbol === id) { const sp = Math.max(q.last * 0.00005, Math.pow(10, -w.chart.info.precision)); w.chart.setTradePrices(q.last - sp / 2, q.last + sp / 2); w.chart.prevClose = q.prev; }
    if (this.active?.cfg.symbol === id) document.title = `${this.active.sym.symbol} ${fmtPrice(q.last, this.active.chart.info.precision)} ${q.chgPct >= 0 ? '▲' : '▼'} ${q.chgPct.toFixed(2)}% — TradingAnalyzer`;
  }
  onChartClick(w, e) {
    if (this.replaySelecting && w === this.active) {
      this.replaySelecting = false;
      const realIdx = Math.max(10, Math.min(w.chart.bars.length - 1, Math.round(e.idx)));
      w.chart.setReplay(realIdx); $('#replaybar').hidden = false; document.body.classList.add('replaying');
    }
  }
  chartContextMenu(w, e) {
    const c = w.chart;
    if (e.drawing) {
      const d = e.drawing;
      return contextMenu(e.clientX, e.clientY, [
        { label: 'Settings…', icon: 'gear', onClick: () => D.drawingSettings(w, d) },
        { label: 'Clone', icon: 'copy', onClick: () => c.cloneDrawing(d) },
        { label: d.locked ? 'Unlock' : 'Lock', icon: 'lock', onClick: () => { d.locked = !d.locked; c._changed(); } },
        { label: 'Hide', icon: 'eyeOff', onClick: () => { d.hidden = true; c._changed(); } },
        { label: 'Bring to front', icon: 'layout', onClick: () => { c.drawings = c.drawings.filter((x) => x !== d).concat(d); c._changed(); } },
        { label: 'Send to back', icon: 'layout', onClick: () => { c.drawings = [d].concat(c.drawings.filter((x) => x !== d)); c._changed(); } },
        { divider: true },
        { label: 'Remove', icon: 'trash', danger: true, shortcut: 'Del', onClick: () => c.removeDrawing(d) },
      ]);
    }
    const p = e.price, isMain = e.pane?.id === 'main';
    const items = [
      { label: 'Reset chart view', icon: 'sync', shortcut: 'Alt+R', onClick: () => c.resetView() },
      { divider: true },
    ];
    if (isMain && p != null) {
      const fp = c.fmt(p);
      items.push(
        { label: `Add alert on ${c.info.symbol} at ${fp}`, icon: 'alarm', shortcut: 'Alt+A', onClick: () => D.alertDialog(this, { price: p }) },
        { label: `Buy 1 ${c.info.symbol} @ ${fp} limit`, icon: 'trade', onClick: () => this.bottom.trading.ticket(w.cfg.symbol, 'buy', { type: 'limit', price: p }) },
        { label: `Sell 1 ${c.info.symbol} @ ${fp} limit`, icon: 'trade', onClick: () => this.bottom.trading.ticket(w.cfg.symbol, 'sell', { type: 'limit', price: p }) },
        { label: `Draw horizontal line at ${fp}`, icon: 'hline', onClick: () => { c.snapshot(); c.drawings.push({ id: uid(), type: 'hline', pane: 'main', points: [{ t: e.t, p }], style: { ...TOOLS.hline.defaults } }); c._changed(); } },
        { divider: true },
      );
    }
    items.push(
      { label: 'Add indicator…', icon: 'fx', onClick: () => D.indicatorsDialog(this) },
      { label: 'Compare symbol…', icon: 'plusCircle', onClick: () => D.symbolSearch(this, (s) => w.addCompare(s.id), { compare: true }) },
      { label: 'Chart type', icon: 'candles', sub: CHART_TYPES.map((t) => ({ label: t.name, icon: t.icon, checked: t.id === w.cfg.type, onClick: () => { w.setType(t.id); this.updateTopbar(); } })) },
      { label: 'Scale', icon: 'chart', sub: [
        { label: 'Auto (fits data to screen)', checked: c.panes[0].scale.auto, onClick: () => { c.panes[0].scale.auto = true; c.render(); this.updateBottomBar(); } },
        { label: 'Regular', checked: w.cfg.scaleMode === 'normal', onClick: () => this.setScaleMode('normal') },
        { label: 'Percent', checked: w.cfg.scaleMode === 'percent', onClick: () => this.setScaleMode('percent') },
        { label: 'Logarithmic', checked: w.cfg.scaleMode === 'log', onClick: () => this.setScaleMode('log') },
        { label: 'Invert scale', checked: !!c.scaleInverted, shortcut: 'Alt+I', onClick: () => { c.scaleInverted = !c.scaleInverted; c.render(); } },
      ] },
      { label: 'Remove all drawings', icon: 'trash', onClick: () => c.removeAllDrawings() },
      { label: 'Remove all indicators', icon: 'trash', onClick: () => { for (const i of c.indicators.slice()) w.removeIndicator(i.uid); } },
      { divider: true },
      { label: 'Take a snapshot', icon: 'camera', onClick: () => this.screenshot() },
      { label: 'Settings…', icon: 'gear', onClick: () => D.chartSettings(this) },
    );
    contextMenu(e.clientX, e.clientY, items);
  }

  /* ---------------------------- replay ---------------------------- */
  toggleReplay() {
    if (document.body.classList.contains('replaying')) return this.exitReplay();
    const c = this.active.chart; if (!c.bars.length) return;
    const start = Math.max(10, Math.round(c.xToIdx(c.plotW * 0.5)));
    c.setReplay(Math.min(start, c.bars.length - 1));
    $('#replaybar').hidden = false; document.body.classList.add('replaying');
    toast('Bar Replay: use ▶ to play, ⏭ to step. Click “Select bar” to choose a different start.', 'info', 5000);
  }
  replayPlay() {
    if (this.replayTimer) { clearInterval(this.replayTimer); this.replayTimer = null; $('#replayPlay').innerHTML = I.play; return; }
    const sp = +$('#replaySpeed').value || 1;
    this.replayTimer = setInterval(() => this.replayStep(1), 1000 / sp);
    $('#replayPlay').innerHTML = I.pause;
  }
  replayStep(n) {
    const c = this.active.chart; if (c.replayEnd == null) return;
    const next = c.replayEnd + n;
    if (next >= c.bars.length) { this.exitReplay(); toast('Replay reached real-time', 'info'); return; }
    c.replayEnd = Math.max(1, next); c._rebuild();
    if (c.rightIdx < c.disp.length - 1 + 2) c.rightIdx = c.disp.length - 1 + c.settings.rightMargin; else if (n > 0) c.rightIdx += 0;
    c.render(); this.emit('bar', this.active);
  }
  exitReplay() {
    clearInterval(this.replayTimer); this.replayTimer = null; $('#replayPlay').innerHTML = I.play;
    for (const w of this.widgets) if (w.chart.replayEnd != null) { w.chart.setReplay(null); w.chart.scrollToEnd(); }
    $('#replaybar').hidden = true; document.body.classList.remove('replaying');
  }

  /* ---------------------------- alerts ---------------------------- */
  get alerts() { return (this._alerts ||= store.get('alerts', [])); }
  saveAlerts() { store.set('alerts', this.alerts); this.refreshAlertLines(); this.emit('alerts'); }
  addAlert(a) {
    this.alerts.push({ id: uid(), created: Date.now(), active: true, ...a });
    this.saveAlerts(); toast(`Alert created on ${a.symbol.split(':')[1]}`, 'success');
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }
  checkAlerts(id, q) {
    const last = this._lastPx ||= {};
    const prev = last[id]; last[id] = q.last;
    if (prev == null) return;
    let changed = false;
    for (const a of this.alerts) {
      if (!a.active || a.symbol !== id) continue;
      const p = a.price, x = q.last;
      const up = prev < p && x >= p, dn = prev > p && x <= p;
      const hit = a.cond === 'crossing' ? up || dn : a.cond === 'crossing_up' ? up : a.cond === 'crossing_down' ? dn : a.cond === 'greater' ? x > p : a.cond === 'less' ? x < p : a.cond === 'entering' ? false : false;
      if (!hit) continue;
      const sym = findSymbol(id);
      const msg = a.message || `${sym.symbol} ${condLabel(a.cond)} ${fmtPrice(p, symbolPrecision(sym, p))}`;
      (this._alertLog ||= store.get('alertLog', [])).unshift({ id: uid(), alert: a.id, symbol: id, msg, price: x, t: Date.now() });
      this._alertLog.splice(200); store.set('alertLog', this._alertLog);
      toast(`<b>🔔 Alert:</b> ${msg}<br><small>Price: ${fmtPrice(x, symbolPrecision(sym, x))}</small>`, 'alert', 10000);
      if (a.sound !== false) { import('./util.js').then((u) => { u.beep(880); setTimeout(() => u.beep(1175), 180); }); }
      if (window.Notification && Notification.permission === 'granted') try { new Notification('TradingAnalyzer alert', { body: msg }); } catch { /* */ }
      if (a.freq !== 'every') a.active = false;
      a.triggered = (a.triggered || 0) + 1; a.lastT = Date.now();
      changed = true;
    }
    if (changed) this.saveAlerts();
  }
  refreshAlertLines() {
    for (const w of this.widgets) {
      const lines = this.alerts.filter((a) => a.active && a.symbol === w.cfg.symbol).map((a) => ({
        id: a.id, price: a.price, color: '#FF9800', text: '⏰ ' + (a.message ? a.message.slice(0, 24) : condLabel(a.cond)), draggable: true, closable: true,
        onMove: (p) => { a.price = p; this.saveAlerts(); toast('Alert price updated', 'info', 1500); },
        onClose: () => { this._alerts = this.alerts.filter((x) => x !== a); this.saveAlerts(); },
        onClick: () => D.alertDialog(this, { edit: a }),
        onDblClick: () => D.alertDialog(this, { edit: a }),
      }));
      w.alertLines = lines;
      w.chart.setPriceLines([...(w.alertLines || []), ...(w.tradeLines || [])]);
    }
  }
  setTradeLines(w, lines) { w.tradeLines = lines; w.chart.setPriceLines([...(w.alertLines || []), ...lines]); }

  /* ---------------------------- keyboard ---------------------------- */
  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (document.querySelector('.dlg-overlay')) return;
      const c = this.active?.chart; if (!c) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const code = e.code;
      const toolKeys = { KeyT: 'trendline', KeyH: 'hline', KeyV: 'vline', KeyC: 'crossline', KeyF: 'fibretrace', KeyJ: 'hray', KeyB: 'brush', KeyX: 'rect', KeyP: 'path' };
      if (alt && toolKeys[code] && !ctrl) { e.preventDefault(); this.setTool(toolKeys[code]); return; }
      if (alt && code === 'KeyR') { e.preventDefault(); c.resetView(); return; }
      if (alt && code === 'KeyA') { e.preventDefault(); D.alertDialog(this); return; }
      if (alt && code === 'KeyS') { e.preventDefault(); this.screenshot(); return; }
      if (alt && code === 'KeyI') { e.preventDefault(); c.scaleInverted = !c.scaleInverted; c.render(); return; }
      if (alt && code === 'KeyL') { e.preventDefault(); this.setScaleMode(this.active.cfg.scaleMode === 'log' ? 'normal' : 'log'); return; }
      if (alt && code === 'KeyG') { e.preventDefault(); D.gotoDialog(this); return; }
      if (alt && code === 'KeyW') { e.preventDefault(); this.panels.toggle('watchlist'); return; }
      if (ctrl && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) c.redo(); else c.undo(); return; }
      if (ctrl && code === 'KeyY') { e.preventDefault(); c.redo(); return; }
      if (ctrl && code === 'KeyS') { e.preventDefault(); this._save(); toast('Chart layout saved', 'success'); return; }
      if (ctrl && code === 'KeyK') { e.preventDefault(); D.symbolSearch(this, (s) => this.active.setSymbol(s.id)); return; }
      if (ctrl && k === 'ArrowUp') { e.preventDefault(); c.zoom(1.2); return; }
      if (ctrl && k === 'ArrowDown') { e.preventDefault(); c.zoom(1 / 1.2); return; }
      if (k === 'Escape') { c.cancel(); this.setToolUI(null); closePopup(); if (this.replaySelecting) this.replaySelecting = false; return; }
      if (k === 'Enter') { c.finishPath(); return; }
      if ((k === 'Delete' || k === 'Backspace') && c.selected) { e.preventDefault(); c.removeDrawing(c.selected); return; }
      if (k === 'ArrowLeft') { c.scrollBars(e.shiftKey ? -20 : -2); return; }
      if (k === 'ArrowRight') { c.scrollBars(e.shiftKey ? 20 : 2); return; }
      if (k === 'ArrowUp' && !ctrl) { c.zoom(1.15); return; }
      if (k === 'ArrowDown' && !ctrl) { c.zoom(1 / 1.15); return; }
      if (k === '+' || k === '=') { c.zoom(1.2); return; }
      if (k === '-' || k === '_') { c.zoom(1 / 1.2); return; }
      if (k === '/') { e.preventDefault(); D.indicatorsDialog(this); return; }
      if (k === ',' && !ctrl && !alt) { e.preventDefault(); D.intervalPrompt(this, ''); return; }
      if (!ctrl && !alt && /^[0-9]$/.test(k)) { e.preventDefault(); D.intervalPrompt(this, k); return; }
      if (!ctrl && !alt && /^[a-zA-Z]$/.test(k)) { e.preventDefault(); D.symbolSearch(this, (s) => this.active.setSymbol(s.id), { initial: k }); }
    });
  }
}

function fmtOffset(min) { const s = min >= 0 ? '+' : '-'; min = Math.abs(min); return `${s}${Math.floor(min / 60)}${min % 60 ? ':' + pad2(min % 60) : ''}`; }

export const app = new App();
window.app = app;
app.init();
void MIN; void HOUR; void WEEK; void menuList; void dialog;
