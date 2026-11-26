// Canvas charting engine: panes, price/time scales, chart types, indicators, drawings, interaction.
import { Emitter, clamp, niceStep, decimalsOf, fmtPrice, fmtVol, fmtNum, fmtPct, TimeZone, MONTHS, pad2, fmtDateTime, fmtDuration, uid, hexToRgba, DAY, HOUR, MIN, el } from './util.js';
import { TOOLS, hitDrawing, FONT, textBox } from './drawings.js';
import { sources } from './indicators.js';

export const THEMES = {
  dark: {
    bg: '#0F0F0F', grid: 'rgba(242,242,242,0.06)', text: '#B2B5BE', strong: '#DBDBDB', border: '#2E2E2E', cross: '#9598A1', crossLabel: '#4A4A4A',
    labelBg: '#2E2E2E', labelText: '#DBDBDB', watermark: 'rgba(219,219,219,0.06)', handle: '#0F0F0F', level: 'rgba(120,123,134,0.6)', scaleBg: '#0F0F0F',
  },
  light: {
    bg: '#FFFFFF', grid: 'rgba(42,46,57,0.07)', text: '#131722', strong: '#131722', border: '#E0E3EB', cross: '#9598A1', crossLabel: '#131722',
    labelBg: '#F0F3FA', labelText: '#131722', watermark: 'rgba(19,23,34,0.05)', handle: '#FFFFFF', level: 'rgba(120,123,134,0.6)', scaleBg: '#FFFFFF',
  },
};

export function defaultSettings() {
  return {
    upColor: '#089981', downColor: '#F23645', borderUp: '#089981', borderDown: '#F23645', wickUp: '#089981', wickDown: '#F23645',
    showBody: true, showBorders: true, showWicks: true, lineColor: '#2962FF', lineWidth: 2,
    bg: '', gridV: true, gridH: true, gridColor: '', crossStyle: 'dashed', crossColor: '',
    watermark: true, showLastPrice: true, showCountdown: true, showIndLabels: true, showHighLow: true, showPrevClose: false,
    showOHLC: true, showChange: true, showIndValues: true, showIndInputs: true, rightMargin: 8, timezone: 'local', scaleText: 11,
    renkoBox: 0, lbLines: 3,
  };
}

const TIME_H = 28;
const MIN_PANE = 40;
const TRANSFORMS = new Set(['heikinashi', 'renko', 'linebreak']);
const CANDLE_TYPES = new Set(['candles', 'hollow', 'heikinashi', 'bars', 'highlow', 'renko', 'linebreak']);

class Scale {
  constructor() { this.auto = true; this.mode = 'normal'; this.inverted = false; this.min = 0; this.max = 1; this.base = 1; this.mt = 0.1; this.mb = 0.1; }
  tf(v) { return this.mode === 'log' ? Math.log10(Math.max(v, 1e-12)) : this.mode === 'percent' ? (v / this.base - 1) * 100 : v; }
  inv(v) { return this.mode === 'log' ? Math.pow(10, v) : this.mode === 'percent' ? (v / 100 + 1) * this.base : v; }
}

function toHA(bars) {
  const out = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], c = (b.o + b.h + b.l + b.c) / 4;
    const o = i ? (out[i - 1].o + out[i - 1].c) / 2 : (b.o + b.c) / 2;
    out[i] = { t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v };
  }
  return out;
}
function toRenko(bars, box) {
  if (!bars.length) return [];
  if (!(box > 0)) {
    let s = 0, n = 0;
    for (let i = Math.max(1, bars.length - 14); i < bars.length; i++) { s += Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)); n++; }
    box = n ? s / n : bars[0].c * 0.01;
  }
  const out = []; let last = bars[0].c, dir = 0, vol = 0;
  for (const b of bars) {
    vol += b.v;
    for (;;) {
      if (b.c >= last + box && dir >= 0 || b.c >= last + 2 * box) {
        const o = dir < 0 ? last + box : last; const c = o + box;
        out.push({ t: b.t, o, h: c, l: o, c, v: vol }); vol = 0; last = c; dir = 1;
      } else if (b.c <= last - box && dir <= 0 || b.c <= last - 2 * box) {
        const o = dir > 0 ? last - box : last; const c = o - box;
        out.push({ t: b.t, o, h: o, l: c, c, v: vol }); vol = 0; last = c; dir = -1;
      } else break;
    }
  }
  // make times strictly increasing for index lookups
  for (let i = 1; i < out.length; i++) if (out[i].t <= out[i - 1].t) out[i].t = out[i - 1].t + 1;
  return out;
}
function toLineBreak(bars, n = 3) {
  const out = [];
  for (const b of bars) {
    if (!out.length) { out.push({ t: b.t, o: b.o, h: Math.max(b.o, b.c), l: Math.min(b.o, b.c), c: b.c, v: b.v }); continue; }
    const last = out[out.length - 1], up = last.c > last.o;
    const recent = out.slice(-n);
    const hi = Math.max(...recent.map((x) => Math.max(x.o, x.c))), lo = Math.min(...recent.map((x) => Math.min(x.o, x.c)));
    let nb = null;
    if (up) { if (b.c > last.c) nb = { o: last.c }; else if (b.c < lo) nb = { o: last.o }; }
    else { if (b.c < last.c) nb = { o: last.c }; else if (b.c > hi) nb = { o: last.o }; }
    if (nb) out.push({ t: Math.max(b.t, last.t + 1), o: nb.o, h: Math.max(nb.o, b.c), l: Math.min(nb.o, b.c), c: b.c, v: b.v });
    else last.v += b.v;
  }
  return out;
}

export class Chart extends Emitter {
  constructor(root, opts = {}) {
    super();
    this.root = root;
    root.classList.add('chart-root');
    this.canvas = el('canvas', { class: 'chart-canvas' });
    this.legendLayer = el('div', { class: 'legend-layer' });
    this.navEl = el('div', { class: 'chart-nav' });
    root.append(this.canvas, this.legendLayer, this.navEl);
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1; this.axisW = 64; this.plotW = 0; this.plotH = 0;
    this.settings = { ...defaultSettings(), ...(opts.settings || {}) };
    this.themeName = opts.theme || 'dark';
    this.tz = new TimeZone(this.settings.timezone);
    this.bars = []; this.disp = []; this.info = { symbol: '', title: '', exchange: '', ivLabel: '', intervalMs: HOUR, precision: 2 };
    this.type = 'candles';
    this.spacing = 8; this.rightIdx = 0;
    this.panes = [{ id: 'main', ratio: 1, scale: new Scale(), top: 0, h: 0 }];
    this.indicators = []; this.compares = []; this.priceLines = []; this.markers = []; this.drawings = [];
    this.replayEnd = null;
    this.tool = null; this.cursorMode = 'cross'; this.magnet = 0; this.stayDrawing = false; this.lockAll = false; this.hideAll = false;
    this.selected = null; this.hoverDrawing = null; this.creating = null; this.drag = null;
    this.cross = null; this.pointers = new Map();
    this.undoStack = []; this.redoStack = [];
    this.loading = false;
    this._buildNav();
    this._bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(root);
    this.resize();
    this._timer = setInterval(() => { if (this.settings.showCountdown && this.disp.length) this.render(); }, 1000);
  }
  destroy() { clearInterval(this._timer); this.ro.disconnect(); this.root.innerHTML = ''; }
  get theme() {
    const t = { ...THEMES[this.themeName] };
    if (this.settings.bg) t.bg = this.settings.bg;
    if (this.settings.gridColor) t.grid = this.settings.gridColor;
    if (this.settings.crossColor) t.cross = this.settings.crossColor;
    return t;
  }
  setTheme(n) { this.themeName = n; this.render(); }
  setSettings(s) {
    Object.assign(this.settings, s);
    if (s.timezone) this.tz.set(s.timezone);
    if ('renkoBox' in s || 'lbLines' in s) this._rebuild();
    this._buildLegend(); this.render();
  }

  /* ----------------------------- data ----------------------------- */
  setData(bars, info, keepView = false) {
    const prevT = keepView && this.disp.length ? this.idxT(this.rightIdx) : null;
    this.bars = bars;
    Object.assign(this.info, info);
    this._rebuild();
    if (prevT != null) this.rightIdx = this.tIdx(prevT);
    else this.scrollToEnd();
    this.selected = null; this.creating = null;
    this._buildLegend();
    this.render();
  }
  _rebuild() {
    let src = this.replayEnd != null ? this.bars.slice(0, this.replayEnd + 1) : this.bars;
    if (this.type === 'heikinashi') src = toHA(src);
    else if (this.type === 'renko') src = toRenko(src, +this.settings.renkoBox);
    else if (this.type === 'linebreak') src = toLineBreak(src, +this.settings.lbLines || 3);
    this.disp = src;
    this._calcDirty = true;
  }
  update(bar) {
    const b = this.bars, n = b.length;
    if (!n) return;
    const last = b[n - 1];
    const follow = this.rightIdx >= this.disp.length - 1;
    if (bar.t === last.t) b[n - 1] = bar;
    else if (bar.t > last.t) b.push(bar);
    else return;
    if (this.replayEnd != null) return;
    const before = this.disp.length;
    if (!TRANSFORMS.has(this.type)) { this.disp = this.bars; this._calcDirty = true; }
    else this._rebuild();
    if (follow && this.disp.length > before) this.rightIdx += this.disp.length - before;
    this.render();
  }
  prepend(older) {
    if (!older.length || !this.bars.length) return;
    const first = this.bars[0].t;
    const add = older.filter((b) => b.t < first);
    if (!add.length) return;
    const before = this.disp.length;
    this.bars = add.concat(this.bars);
    if (this.replayEnd != null) this.replayEnd += add.length;
    this._rebuild();
    this.rightIdx += this.disp.length - before;
    this.render();
  }
  setType(t) {
    const prevT = this.disp.length ? this.idxT(this.rightIdx) : null;
    this.type = t; this._rebuild();
    if (prevT != null) this.rightIdx = this.tIdx(prevT);
    if (t === 'renko' || t === 'linebreak') this.scrollToEnd();
    this._buildLegend(); this.render();
  }
  setReplay(i) {
    this.replayEnd = i == null ? null : clamp(i, 0, this.bars.length - 1);
    this._rebuild();
    if (i != null) this.rightIdx = this.disp.length - 1 + this.settings.rightMargin;
    this.render();
  }

  /* ---------------------------- view ---------------------------- */
  scrollToEnd() { this.rightIdx = this.disp.length - 1 + this.settings.rightMargin; this.panes[0].scale.auto = true; this.render(); }
  resetView() { this.spacing = 8; for (const p of this.panes) p.scale.auto = true; this.scrollToEnd(); }
  zoom(f, anchorX) {
    const x = anchorX ?? this.plotW - this.settings.rightMargin * this.spacing;
    const i = this.xToIdx(x);
    this.spacing = clamp(this.spacing * f, 0.6, 80);
    this.rightIdx = i + (this.plotW - x) / this.spacing;
    this._clampView(); this.render();
  }
  scrollBars(n) { this.rightIdx += n; this._clampView(); this.render(); }
  setVisibleRange(t0, t1) {
    const i0 = this.tIdx(t0), i1 = Math.min(this.tIdx(t1), this.disp.length - 1);
    if (!(i1 > i0)) return;
    this.spacing = clamp(this.plotW / (i1 - i0 + 1 + this.settings.rightMargin), 0.6, 80);
    this.rightIdx = i1 + this.settings.rightMargin;
    this.panes[0].scale.auto = true;
    this._clampView(); this.render();
  }
  goToTime(t) {
    const i = this.tIdx(t);
    this.rightIdx = i + this.plotW / this.spacing / 2; this._clampView(); this.render();
  }
  _clampView() {
    const n = this.disp.length, vis = this.plotW / this.spacing;
    this.rightIdx = clamp(this.rightIdx, Math.min(5, n - 1), n - 1 + Math.max(5, vis - 5));
    if (this.xToIdx(0) < 30 && n && !this.loading) this.emit('needMore');
  }
  xToIdx(x) { return this.rightIdx - (this.plotW - x) / this.spacing; }
  idxToX(i) { return this.plotW - (this.rightIdx - i) * this.spacing; }
  tIdx(t) {
    const b = this.disp, n = b.length; if (!n) return 0;
    const iv = this.info.intervalMs;
    if (t >= b[n - 1].t) return n - 1 + (t - b[n - 1].t) / iv;
    if (t <= b[0].t) return (t - b[0].t) / iv;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
    return lo + (t - b[lo].t) / (b[hi].t - b[lo].t || 1);
  }
  idxT(i) {
    const b = this.disp, n = b.length, iv = this.info.intervalMs; if (!n) return Date.now();
    if (i >= n - 1) return Math.round(b[n - 1].t + (i - (n - 1)) * iv);
    if (i <= 0) return Math.round(b[0].t + i * iv);
    const lo = Math.floor(i); return Math.round(b[lo].t + (i - lo) * (b[lo + 1].t - b[lo].t));
  }
  p2y(pane, p, sc = pane.scale) {
    const r = (sc.tf(p) - sc.min) / (sc.max - sc.min || 1);
    return pane.top + (sc.inverted ? r : 1 - r) * pane.h;
  }
  y2p(pane, y, sc = pane.scale) {
    let r = (y - pane.top) / pane.h; if (!sc.inverted) r = 1 - r;
    return sc.inv(sc.min + r * (sc.max - sc.min));
  }
  visRange() {
    const n = this.disp.length;
    return [Math.max(0, Math.floor(this.xToIdx(0)) - 1), Math.min(n - 1, Math.ceil(this.xToIdx(this.plotW)) + 1)];
  }
  fmt(p) { return fmtPrice(p, this.info.precision); }
  paneOf(id) { return this.panes.find((p) => p.id === id); }

  /* ------------------------- indicators ------------------------- */
  addIndicator(def, inputs, styles = {}, opt = {}) {
    const inst = { uid: opt.uid || uid(), def, inputs: { ...inputs }, styles: JSON.parse(JSON.stringify(styles)), visible: opt.visible ?? true, result: null, scale: def.ownScale ? new Scale() : null, pane: 'main' };
    for (const pl of def.plots) inst.styles[pl.id] = { color: pl.color, width: pl.width || 1, visible: true, ...(inst.styles[pl.id] || {}) };
    if (!def.overlay) {
      const pane = { id: inst.uid, ratio: opt.ratio || 0.28, scale: new Scale(), top: 0, h: 0 };
      pane.scale.mt = 0.08; pane.scale.mb = 0.08;
      this.panes.push(pane); inst.pane = pane.id;
    }
    this.indicators.push(inst);
    this._calcDirty = true; this._buildLegend(); this.render();
    return inst;
  }
  removeIndicator(id) {
    const i = this.indicators.findIndex((x) => x.uid === id);
    if (i < 0) return;
    const inst = this.indicators[i];
    this.indicators.splice(i, 1);
    if (inst.pane !== 'main') {
      this.panes = this.panes.filter((p) => p.id !== inst.pane);
      this.drawings = this.drawings.filter((d) => d.pane !== inst.pane);
    }
    this._buildLegend(); this.render();
  }
  updateIndicator(inst) { inst.result = null; this._calcDirty = true; this._buildLegend(); this.render(); }
  movePane(id, dir) {
    const i = this.panes.findIndex((p) => p.id === id), j = i + dir;
    if (i <= 0 || j <= 0 || j >= this.panes.length) return;
    [this.panes[i], this.panes[j]] = [this.panes[j], this.panes[i]];
    this._buildLegend(); this.render();
  }
  _calc() {
    if (!this._calcDirty) return;
    this._calcDirty = false;
    const S = sources(this.disp);
    for (const inst of this.indicators) {
      try { inst.result = inst.def.calc(S, inst.inputs, this.disp); inst.error = null; } catch (e) { inst.result = {}; inst.error = e.message; console.warn(e); }
    }
  }
  plotOffset(inst, pl) { return pl.offsetInput ? (inst.inputs[pl.offsetInput] || 0) * (pl.offsetSign || 1) : 0; }

  /* --------------------------- compare --------------------------- */
  addCompare(cmp) { this.compares.push(cmp); this._buildLegend(); this.render(); }
  removeCompare(id) { this.compares = this.compares.filter((c) => c.id !== id); this._buildLegend(); this.render(); }
  compareValue(cmp, t) {
    const b = cmp.bars; if (!b.length || t < b[0].t) return NaN;
    let lo = 0, hi = b.length - 1;
    if (t >= b[hi].t) return b[hi].c;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
    return b[lo].c;
  }

  /* --------------------------- drawings --------------------------- */
  snapshot() { this.undoStack.push(JSON.stringify(this.drawings.map(this._ser))); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; }
  _ser(d) { const { _hit, ...r } = d; return r; }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(JSON.stringify(this.drawings.map(this._ser))); this.drawings = JSON.parse(this.undoStack.pop()); this.selected = null; this._changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(JSON.stringify(this.drawings.map(this._ser))); this.drawings = JSON.parse(this.redoStack.pop()); this.selected = null; this._changed(); }
  getDrawings() { return this.drawings.filter((d) => !TOOLS[d.type]?.temp).map(this._ser); }
  setDrawings(list) { this.drawings = (list || []).filter((d) => TOOLS[d.type]).map((d) => ({ ...d, style: { ...TOOLS[d.type].defaults, ...d.style } })); this.selected = null; this.undoStack = []; this.redoStack = []; this.emit('select', null); this.render(); }
  _changed() { this.emit('drawings', this.getDrawings()); this.emit('select', this.selected); this.render(); }
  removeDrawing(d) { if (!d) return; this.snapshot(); this.drawings = this.drawings.filter((x) => x !== d); if (this.selected === d) this.selected = null; this._changed(); }
  removeAllDrawings() { if (!this.drawings.length) return; this.snapshot(); this.drawings = []; this.selected = null; this._changed(); }
  cloneDrawing(d) {
    if (!d) return; this.snapshot();
    const c = JSON.parse(JSON.stringify(this._ser(d))); c.id = uid();
    const off = 5 * this.info.intervalMs; c.points.forEach((p) => { p.t += off; });
    this.drawings.push(c); this.selected = c; this._changed();
  }
  updateDrawing(d, style) { this.snapshot(); Object.assign(d.style, style); this._changed(); }
  select(d) { this.selected = d; this.emit('select', d); this.render(); }
  setTool(t) {
    if (this.creating) { this.drawings = this.drawings.filter((d) => d !== this.creating.d); this.creating = null; }
    this.tool = t; this.selected = null; this.emit('select', null);
    this.canvas.style.cursor = t ? 'crosshair' : '';
    this.render();
  }
  cancel() {
    if (this.creating) {
      const tool = TOOLS[this.creating.d.type];
      if (tool.n === -1 && this.creating.d.points.length > 2) { this.creating.d.points.pop(); this._finish(); return; }
      this.drawings = this.drawings.filter((d) => d !== this.creating.d); this.creating = null;
    }
    this.drawings = this.drawings.filter((d) => !TOOLS[d.type]?.temp);
    if (this.tool) { this.tool = null; this.emit('tool', null); }
    this.selected = null; this.emit('select', null); this.render();
  }
  finishPath() { if (this.creating && TOOLS[this.creating.d.type].n === -1) { this.creating.d.points.pop(); this._finish(); } }
  _paneCtx(pane) {
    const self = this, sc = pane.scale;
    return {
      ctx: this.ctx, L: 0, R: this.plotW, T: pane.top, B: pane.top + pane.h, theme: this.theme, bars: this.disp, spacing: this.spacing,
      pRange: Math.abs(sc.inv(sc.max) - sc.inv(sc.min)),
      toX: (t) => self.idxToX(self.tIdx(t)), toY: (p) => self.p2y(pane, p), toT: (x) => self.idxT(self.xToIdx(x)), toP: (y) => self.y2p(pane, y), idx: (t) => self.tIdx(t),
      fmt: (p) => (pane.id === 'main' ? self.fmt(p) : fmtNum(p, 2)), fmtVol, fmtSpan: (bars) => self._fmtSpan(bars),
    };
  }
  _fmtSpan(bars) {
    const ms = Math.abs(bars) * this.info.intervalMs;
    const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN);
    return [d && d + 'd', h && h + 'h', m && m + 'm'].filter(Boolean).join(' ') || '0m';
  }
  _pt(pane, x, y, snap = true) {
    let i = this.xToIdx(x);
    const ri = Math.round(i);
    if (snap) i = ri;
    let p = this.y2p(pane, y);
    if (this.magnet && pane.id === 'main' && this.disp[ri]) {
      const b = this.disp[ri];
      let best = null, bd = Infinity;
      for (const v of [b.o, b.h, b.l, b.c]) { const dy = Math.abs(this.p2y(pane, v) - y); if (dy < bd) { bd = dy; best = v; } }
      if (this.magnet === 2 || bd < 30) p = best;
    }
    return { t: this.idxT(i), p };
  }

  /* --------------------------- markers / price lines --------------------------- */
  setMarkers(m) { this.markers = m || []; this.render(); }
  setPriceLines(l) { this.priceLines = l || []; this.render(); }

  /* --------------------------- layout --------------------------- */
  resize() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
    const dpr = window.devicePixelRatio || 1;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    const wasEnd = this.disp.length && this.rightIdx >= this.disp.length - 1;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this._layout();
    if (wasEnd) this.rightIdx = Math.max(this.rightIdx, this.disp.length - 1 + this.settings.rightMargin);
    this._draw();
  }
  _layout() {
    this.plotW = Math.max(10, this.w - this.axisW);
    this.plotH = Math.max(10, this.h - TIME_H);
    const tot = this.panes.reduce((a, p) => a + p.ratio, 0);
    let y = 0;
    this.panes.forEach((p, i) => {
      p.top = Math.round(y);
      const hh = i === this.panes.length - 1 ? this.plotH - p.top : Math.max(MIN_PANE, Math.round((p.ratio / tot) * this.plotH));
      p.h = hh; y += hh;
    });
  }
  render() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); }); }

  /* --------------------------- scale fitting --------------------------- */
  _fit() {
    const [from, to] = this.visRange();
    const D = this.disp;
    for (const pane of this.panes) {
      const sc = pane.scale;
      const isMain = pane.id === 'main';
      if (isMain) {
        sc.mode = this.compares.length ? 'percent' : this.scaleMode || 'normal';
        sc.inverted = !!this.scaleInverted;
        if (sc.mode === 'percent') {
          const f = Math.max(0, Math.min(from + 1, D.length - 1));
          sc.base = D[f] ? D[f].c : 1;
        }
      }
      if (!sc.auto) continue;
      let lo = Infinity, hi = -Infinity;
      const add = (v) => { if (v == null || !isFinite(v)) return; const t = sc.tf(v); if (t < lo) lo = t; if (t > hi) hi = t; };
      if (isMain) {
        const useHL = CANDLE_TYPES.has(this.type);
        for (let i = from; i <= to; i++) { const b = D[i]; if (!b) continue; if (useHL) { add(b.h); add(b.l); } else add(b.c); }
        for (const cmp of this.compares) {
          const f = D[Math.max(0, Math.min(from + 1, D.length - 1))]; if (!f) continue;
          const base = this.compareValue(cmp, f.t);
          for (let i = from; i <= to; i++) { if (!D[i]) continue; const v = this.compareValue(cmp, D[i].t); if (isFinite(v) && base) add(sc.base * (v / base)); }
        }
      }
      for (const inst of this.indicators) {
        if (inst.pane !== pane.id || !inst.visible || !inst.result || inst.scale) continue;
        for (const pl of inst.def.plots) {
          const st = inst.styles[pl.id]; if (st && !st.visible) continue;
          const a = inst.result[pl.id]; if (!a) continue;
          const off = this.plotOffset(inst, pl);
          for (let i = from; i <= to; i++) add(a[i - off]);
        }
        if (!isMain) for (const l of inst.def.levels || []) if (inst.styles._levels !== false) add(l.v);
      }
      if (lo === Infinity) { lo = 0; hi = 1; }
      if (hi - lo < Math.abs(hi) * 1e-6 || hi === lo) { const d = Math.abs(hi) * 0.01 || 1; lo -= d; hi += d; }
      const r = hi - lo;
      const inset = isMain && this.topInset ? this.topInset / Math.max(40, pane.h - this.topInset) : 0;
      sc.min = lo - r * sc.mb; sc.max = hi + r * (sc.mt + inset);
      if (isMain && this.indicators.some((i) => i.scale && i.visible && i.pane === 'main')) sc.min = lo - r * 0.25;
    }
    for (const inst of this.indicators) {
      if (!inst.scale || !inst.result) continue;
      let hi = 0; const a = inst.result[inst.def.plots[0].id] || [];
      for (let i = from; i <= to; i++) if (a[i] > hi) hi = a[i];
      inst.scale.min = 0; inst.scale.max = (hi || 1) / 0.2;
    }
  }

  /* --------------------------- ticks --------------------------- */
  _priceTicks(pane) {
    const sc = pane.scale, out = [];
    const target = Math.max(2, Math.floor(pane.h / 36));
    if (sc.mode === 'log') {
      const pmin = sc.inv(sc.min), pmax = sc.inv(sc.max);
      if (!(pmin > 0)) return out;
      let step = niceStep((pmax - pmin) / target);
      const mags = [];
      for (let e = Math.floor(Math.log10(pmin)); e <= Math.ceil(Math.log10(pmax)); e++) for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9]) mags.push(m * Math.pow(10, e));
      let last = -Infinity;
      for (const v of mags) { if (v < pmin || v > pmax) continue; const y = this.p2y(pane, v); if (Math.abs(y - last) >= 28) { out.push({ v, y }); last = y; } }
      void step;
      return out;
    }
    const step = niceStep((sc.max - sc.min) / target);
    const start = Math.ceil(sc.min / step) * step;
    for (let t = start; t <= sc.max + 1e-9; t += step) {
      const v = sc.inv(t);
      out.push({ v, t, y: this.p2y(pane, v), dec: decimalsOf(step) });
      if (out.length > 60) break;
    }
    return out;
  }
  _timeTicks(from, to) {
    const D = this.disp, tz = this.tz, iv = this.info.intervalMs;
    const cands = [];
    let prev = from > 0 && D[from - 1] ? tz.shift(D[from - 1].t) : null;
    for (let i = from; i <= to; i++) {
      const b = D[i]; if (!b) continue;
      const d = tz.shift(b.t);
      let w = 0, label = '';
      if (!prev || d.getUTCFullYear() !== prev.getUTCFullYear()) { w = 100; label = String(d.getUTCFullYear()); }
      else if (d.getUTCMonth() !== prev.getUTCMonth()) { w = 90; label = MONTHS[d.getUTCMonth()]; }
      else if (d.getUTCDate() !== prev.getUTCDate()) { w = iv >= DAY ? 80 - (d.getUTCDate() % 5 ? 2 : 0) : 80; label = String(d.getUTCDate()); }
      else {
        const hh = d.getUTCHours(), mm = d.getUTCMinutes();
        const ph = prev.getUTCHours();
        if (hh !== ph) w = hh % 12 === 0 ? 70 : hh % 6 === 0 ? 66 : hh % 3 === 0 ? 63 : 60;
        else w = mm % 30 === 0 ? 50 : mm % 15 === 0 ? 45 : mm % 5 === 0 ? 40 : 30;
        label = `${pad2(hh)}:${pad2(mm)}`;
      }
      cands.push({ i, w, label, x: this.idxToX(i) });
      prev = d;
    }
    const minGap = 78;
    const accepted = [];
    const order = cands.slice().sort((a, b) => b.w - a.w || a.i - b.i);
    const xs = [];
    for (const c of order) {
      let lo = 0, hi = xs.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < c.x) lo = m + 1; else hi = m; }
      if ((lo > 0 && c.x - xs[lo - 1] < minGap) || (lo < xs.length && xs[lo] - c.x < minGap)) continue;
      xs.splice(lo, 0, c.x); accepted.push(c);
      if (accepted.length > 40) break;
    }
    return accepted.sort((a, b) => a.x - b.x);
  }

  /* --------------------------- drawing --------------------------- */
  _draw() {
    const ctx = this.ctx, th = this.theme, S = this.settings;
    this._calc();
    // axis width from current price range
    ctx.font = FONT(S.scaleText);
    this._layout();
    this._fit();
    const main = this.panes[0];
    const sample = [main.scale.inv(main.scale.max), main.scale.inv(main.scale.min)].map((v) => (main.scale.mode === 'percent' ? fmtPct((v / main.scale.base - 1) * 100) : this.fmt(v)));
    let aw = Math.max(56, ...sample.map((s) => ctx.measureText(s).width + 22));
    for (const p of this.panes.slice(1)) aw = Math.max(aw, ctx.measureText(fmtNum(p.scale.max, 2)).width + 22);
    aw = Math.ceil(aw / 4) * 4;
    if (aw !== this.axisW) { this.axisW = aw; this._layout(); this._fit(); }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg; ctx.fillRect(0, 0, this.w, this.h);
    const [from, to] = this.visRange();
    const tticks = this.disp.length ? this._timeTicks(from, to) : [];

    // grid
    ctx.lineWidth = 1; ctx.strokeStyle = th.grid; ctx.setLineDash([]);
    if (S.gridV) { ctx.beginPath(); for (const t of tticks) { const x = Math.round(t.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, this.plotH); } ctx.stroke(); }
    const pticks = new Map();
    for (const pane of this.panes) {
      const tk = this._priceTicks(pane); pticks.set(pane.id, tk);
      if (S.gridH) { ctx.beginPath(); for (const t of tk) { const y = Math.round(t.y) + 0.5; if (y < pane.top + 2 || y > pane.top + pane.h - 2) continue; ctx.moveTo(0, y); ctx.lineTo(this.plotW, y); } ctx.stroke(); }
    }
    // watermark
    if (S.watermark && this.info.symbol) {
      ctx.save(); ctx.fillStyle = th.watermark; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = clamp(Math.min(this.plotW / 8, main.h / 4), 18, 72);
      ctx.font = FONT(fs, true); ctx.fillText(`${this.info.symbol}, ${this.info.ivLabel}`, this.plotW / 2, main.top + main.h / 2 - fs * 0.2);
      ctx.font = FONT(Math.max(12, fs / 3.2)); ctx.fillText(this.info.title || '', this.plotW / 2, main.top + main.h / 2 + fs * 0.6);
      ctx.restore();
    }

    for (const pane of this.panes) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, pane.top, this.plotW, pane.h); ctx.clip();
      // bands & levels
      for (const inst of this.indicators) {
        if (inst.pane !== pane.id || !inst.visible) continue;
        for (const b of inst.def.bands || []) { const y1 = this.p2y(pane, b.from), y2 = this.p2y(pane, b.to); ctx.fillStyle = inst.styles._bandColor || b.color; ctx.fillRect(0, Math.min(y1, y2), this.plotW, Math.abs(y2 - y1)); }
        ctx.strokeStyle = th.level; ctx.lineWidth = 1;
        for (const l of inst.def.levels || []) { const y = Math.round(this.p2y(pane, l.v)) + 0.5; ctx.setLineDash(l.dash || [5, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW, y); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // ownScale indicators (volume) under price
      for (const inst of this.indicators) if (inst.pane === pane.id && inst.visible && inst.scale) this._drawIndicator(pane, inst, from, to);
      if (pane.id === 'main') {
        this._drawSeries(pane, from, to);
        for (const cmp of this.compares) this._drawCompare(pane, cmp, from, to);
      }
      for (const inst of this.indicators) if (inst.pane === pane.id && inst.visible && !inst.scale) this._drawIndicator(pane, inst, from, to);
      if (pane.id === 'main') { this._drawMarkers(pane); if (S.showHighLow) this._drawHighLow(pane, from, to); this._drawPriceLines(pane); }
      if (!this.hideAll) this._drawDrawings(pane);
      ctx.restore();
    }
    // pane separators
    ctx.strokeStyle = th.border; ctx.lineWidth = 1;
    for (const p of this.panes.slice(1)) { ctx.beginPath(); ctx.moveTo(0, p.top + 0.5); ctx.lineTo(this.w, p.top + 0.5); ctx.stroke(); }
    // axes
    this._drawPriceAxis(pticks);
    this._drawTimeAxis(tticks);
    this._drawCross();
    if (!this.disp.length) {
      ctx.fillStyle = th.text; ctx.font = FONT(14); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.loading ? 'Loading…' : 'No data', this.plotW / 2, this.plotH / 2);
    }
    this._updateLegend();
    this._updateNav();
  }

  _drawSeries(pane, from, to) {
    const ctx = this.ctx, S = this.settings, D = this.disp, th = this.theme;
    if (!D.length) return;
    const t = this.type;
    if (CANDLE_TYPES.has(t)) return this._drawCandles(pane, from, to, t);
    const ys = [];
    for (let i = from; i <= to; i++) if (D[i]) ys.push([this.idxToX(i), this.p2y(pane, D[i].c), i]);
    if (!ys.length) return;
    ctx.lineJoin = 'round';
    if (t === 'columns') {
      const w = Math.max(1, this.spacing * 0.7), base = pane.top + pane.h;
      for (const [x, y, i] of ys) { const up = i === 0 || D[i].c >= D[i - 1].c; ctx.fillStyle = hexToRgba(up ? S.upColor : S.downColor, 0.8); ctx.fillRect(x - w / 2, y, w, base - y); }
      return;
    }
    if (t === 'area' || t === 'hlcarea') {
      const g = ctx.createLinearGradient(0, pane.top, 0, pane.top + pane.h);
      g.addColorStop(0, hexToRgba(S.lineColor, 0.35)); g.addColorStop(1, hexToRgba(S.lineColor, 0.02));
      ctx.beginPath(); ctx.moveTo(ys[0][0], pane.top + pane.h);
      for (const [x, y] of ys) ctx.lineTo(x, y);
      ctx.lineTo(ys[ys.length - 1][0], pane.top + pane.h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    }
    if (t === 'baseline') {
      const sc = pane.scale, baseY = this.p2y(pane, sc.inv((sc.min + sc.max) / 2));
      const path = new Path2D(); path.moveTo(ys[0][0], baseY); for (const [x, y] of ys) path.lineTo(x, y); path.lineTo(ys[ys.length - 1][0], baseY); path.closePath();
      ctx.save(); ctx.beginPath(); ctx.rect(0, pane.top, this.plotW, baseY - pane.top); ctx.clip(); ctx.fillStyle = hexToRgba(S.upColor, 0.2); ctx.fill(path);
      ctx.strokeStyle = S.upColor; ctx.lineWidth = S.lineWidth; ctx.beginPath(); ys.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(0, baseY, this.plotW, pane.top + pane.h - baseY); ctx.clip(); ctx.fillStyle = hexToRgba(S.downColor, 0.2); ctx.fill(path);
      ctx.strokeStyle = S.downColor; ctx.lineWidth = S.lineWidth; ctx.beginPath(); ys.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = th.level; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, baseY); ctx.lineTo(this.plotW, baseY); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    ctx.strokeStyle = S.lineColor; ctx.lineWidth = S.lineWidth; ctx.beginPath();
    ys.forEach(([x, y], k) => {
      if (!k) ctx.moveTo(x, y);
      else if (t === 'step') { ctx.lineTo(x, ys[k - 1][1]); ctx.lineTo(x, y); }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (t === 'linemarkers') { ctx.fillStyle = S.lineColor; for (const [x, y] of ys) { ctx.beginPath(); ctx.arc(x, y, Math.min(3, Math.max(1.5, this.spacing / 4)), 0, Math.PI * 2); ctx.fill(); } }
  }

  _drawCandles(pane, from, to, type) {
    const ctx = this.ctx, S = this.settings, D = this.disp, dpr = this.dpr, th = this.theme;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    let bw = Math.max(1, Math.floor(this.spacing * 0.78 * dpr));
    if (bw > 2 && bw % 2 === 0) bw -= 1;
    const ww = Math.max(1, Math.floor(dpr));
    const layers = [new Map(), new Map(), new Map()];
    const add = (layer, color, x, y, w, h) => { let p = layers[layer].get(color); if (!p) { p = new Path2D(); layers[layer].set(color, p); } p.rect(x, y, w, h); };
    const Y = (v) => Math.round(this.p2y(pane, v) * dpr);
    const half = Math.floor(bw / 2), wh = Math.floor(ww / 2);
    for (let i = from; i <= to; i++) {
      const b = D[i]; if (!b) continue;
      const xc = Math.round(this.idxToX(i) * dpr);
      const yo = Y(b.o), yc = Y(b.c), yh = Y(b.h), yl = Y(b.l);
      let up = b.c >= b.o;
      if (type === 'hollow') up = i === 0 || b.c >= D[i - 1].c;
      const body = up ? S.upColor : S.downColor, border = up ? S.borderUp : S.borderDown, wick = up ? S.wickUp : S.wickDown;
      if (type === 'bars') {
        const lw = Math.max(1, Math.min(Math.floor(bw / 3), Math.floor(2 * dpr)));
        add(0, body, xc - Math.floor(lw / 2), yh, lw, Math.max(1, yl - yh));
        const tick = Math.max(lw, half);
        add(0, body, xc - tick, yo - Math.floor(lw / 2), tick, lw);
        add(0, body, xc, yc - Math.floor(lw / 2), tick + 1, lw);
        continue;
      }
      if (type === 'highlow') { add(1, body, xc - half, yh, bw, Math.max(1, yl - yh)); continue; }
      const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
      if (S.showWicks && type !== 'renko' && type !== 'linebreak') add(0, wick, xc - wh, yh, ww, Math.max(1, yl - yh));
      const hollowBody = type === 'hollow' && b.c > b.o;
      if (bw >= 3 && (S.showBorders || hollowBody)) {
        add(1, hollowBody ? body : border, xc - half, top, bw, bh);
        if (bh > 2) add(2, hollowBody ? th.bg : (S.showBody ? body : th.bg), xc - half + 1, top + 1, bw - 2, bh - 2);
      } else if (S.showBody || hollowBody) add(1, body, xc - half, top, bw, bh);
    }
    for (const L of layers) for (const [c, p] of L) { ctx.fillStyle = c; ctx.fill(p); }
    ctx.restore();
  }

  _drawCompare(pane, cmp, from, to) {
    const ctx = this.ctx, D = this.disp;
    const f = D[Math.max(0, Math.min(from + 1, D.length - 1))]; if (!f) return;
    const base = this.compareValue(cmp, f.t), sc = pane.scale; if (!base) return;
    ctx.strokeStyle = cmp.color; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
    for (let i = from; i <= to; i++) {
      if (!D[i]) continue; const v = this.compareValue(cmp, D[i].t); if (!isFinite(v)) continue;
      const y = this.p2y(pane, sc.base * (v / base)), x = this.idxToX(i);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawIndicator(pane, inst, from, to) {
    const ctx = this.ctx, R = inst.result, S = this.settings; if (!R) return;
    const sc = inst.scale || pane.scale;
    const Y = (v) => this.p2y(pane, v, sc);
    // fills
    for (const f of inst.def.fills || []) {
      const sa = inst.styles[f.a], sb = inst.styles[f.b];
      if ((sa && !sa.visible) || (sb && !sb.visible) || inst.styles._fills === false) continue;
      const pa = inst.def.plots.find((p) => p.id === f.a), A = R[f.a], B = R[f.b]; if (!A || !B) continue;
      const off = this.plotOffset(inst, pa);
      let run = [], runCol = null;
      const flush = () => {
        if (run.length > 1) {
          ctx.fillStyle = runCol; ctx.beginPath();
          run.forEach(([x, ya], k) => (k ? ctx.lineTo(x, ya) : ctx.moveTo(x, ya)));
          for (let k = run.length - 1; k >= 0; k--) ctx.lineTo(run[k][0], run[k][2]);
          ctx.closePath(); ctx.fill();
        }
        run = [];
      };
      for (let i = from - off - 1; i <= to - off + 1; i++) {
        const a = A[i], b = B[i];
        if (!isFinite(a) || !isFinite(b)) { flush(); continue; }
        const col = f.colorDown && a < b ? f.colorDown : f.color;
        const pt = [this.idxToX(i + off), Y(a), Y(b)];
        if (runCol && col !== runCol) { run.push(pt); flush(); }
        runCol = col; run.push(pt);
      }
      flush();
    }
    for (const pl of inst.def.plots) {
      const st = inst.styles[pl.id]; if (!st.visible) continue;
      if (pl.type === 'boxes') {
        // Boxes span from the centre of bar i0 to the centre of bar i1 (Pine box.new semantics)
        const lw = st.width || 1;
        for (const bx of R._boxes || []) {
          if (bx.i1 < from - 1 || bx.i0 > to + 1) continue;
          const x0 = this.idxToX(bx.i0), x1 = this.idxToX(bx.i1), y0 = Y(bx.top), y1 = Y(bx.bottom);
          const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
          ctx.fillStyle = hexToRgba(st.color, pl.fillAlpha ?? 0.05); ctx.fillRect(x0, y0, w, h);
          ctx.strokeStyle = st.color; ctx.lineWidth = lw; ctx.setLineDash([]);
          ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, Math.max(0, w - lw), Math.max(0, h - lw));
        }
        continue;
      }
      const A = R[pl.id]; if (!A) continue;
      const off = this.plotOffset(inst, pl), cols = R._colors && R._colors[pl.id];
      const type = st.type || pl.type || 'line';
      const color = st.color;
      if (type === 'histogram' || type === 'columns') {
        const w = Math.max(1, type === 'columns' ? this.spacing * 0.78 : Math.max(1, this.spacing * 0.5));
        const y0 = clamp(Y(0), pane.top, pane.top + pane.h);
        for (let i = from - off; i <= to - off; i++) {
          const v = A[i]; if (!isFinite(v)) continue;
          let c = cols ? cols[i] : color;
          if (c === 'up') c = hexToRgba(st.color || S.upColor, pl.alpha ?? 1); else if (c === 'down') c = hexToRgba(st.colorDown || pl.colorDown || S.downColor, pl.alpha ?? 1);
          ctx.fillStyle = c; const y = Y(v), x = this.idxToX(i + off);
          ctx.fillRect(Math.round(x - w / 2), Math.min(y, y0), Math.max(1, Math.round(w)), Math.max(1, Math.abs(y0 - y)));
        }
        continue;
      }
      if (type === 'circles' || type === 'cross') {
        ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1;
        const r = clamp(this.spacing / 4, 1.2, 3);
        for (let i = from - off; i <= to - off; i++) {
          const v = A[i]; if (!isFinite(v)) continue; const x = this.idxToX(i + off), y = Y(v);
          if (type === 'circles') { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
          else { ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); }
        }
        continue;
      }
      ctx.strokeStyle = color; ctx.lineWidth = st.width || 1; ctx.setLineDash(st.dash ? [5, 4] : []); ctx.lineJoin = 'round';
      ctx.beginPath(); let pen = false, px = 0, py = 0; const pts = [];
      for (let i = from - off - 1; i <= to - off + 1; i++) {
        const v = A[i];
        if (!isFinite(v)) { if (!pl.connectGaps) pen = false; continue; }
        const x = this.idxToX(i + off), y = Y(v);
        if (pen && pl.breaks && v !== A[i - 1]) pen = false;
        if (!pen) ctx.moveTo(x, y);
        else if (type === 'step') { ctx.lineTo(x, py); ctx.lineTo(x, y); }
        else ctx.lineTo(x, y);
        pen = true; px = x; py = y; pts.push([x, y]);
      }
      void px;
      // for connectGaps look-back / forward to the nearest points outside range
      if (pl.connectGaps) {
        ctx.beginPath(); const P = [];
        let k = from - off - 1; while (k >= 0 && !isFinite(A[k])) k--; if (k >= 0) P.push([this.idxToX(k + off), Y(A[k])]);
        P.push(...pts);
        k = to - off + 2; while (k < A.length && !isFinite(A[k])) k++; if (k < A.length) P.push([this.idxToX(k + off), Y(A[k])]);
        P.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (type === 'area' && pts.length) {
        const y0 = clamp(Y(0), pane.top, pane.top + pane.h);
        ctx.fillStyle = hexToRgba(color, 0.2); ctx.beginPath(); ctx.moveTo(pts[0][0], y0); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.lineTo(pts[pts.length - 1][0], y0); ctx.fill();
      }
    }
    if (inst.error) { ctx.fillStyle = '#F23645'; ctx.font = FONT(12); ctx.fillText('⚠ ' + inst.error, 10, pane.top + pane.h - 10); }
  }

  _drawMarkers(pane) {
    if (!this.markers.length) return;
    const ctx = this.ctx, [from, to] = this.visRange();
    for (const m of this.markers) {
      const i = Math.round(this.tIdx(m.t)); if (i < from || i > to) continue;
      const b = this.disp[i]; if (!b) continue;
      const x = this.idxToX(i), above = m.pos === 'above';
      const y = above ? this.p2y(pane, b.h) - 6 : this.p2y(pane, b.l) + 6;
      ctx.fillStyle = m.color; ctx.beginPath();
      const s = clamp(this.spacing / 2, 4, 7);
      if (m.shape === 'arrowDown') { ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 1.4); ctx.lineTo(x + s, y - s * 1.4); }
      else { ctx.moveTo(x, y); ctx.lineTo(x - s, y + s * 1.4); ctx.lineTo(x + s, y + s * 1.4); }
      ctx.fill();
      if (m.text && this.spacing > 3) { ctx.font = FONT(10); ctx.textAlign = 'center'; ctx.textBaseline = above ? 'bottom' : 'top'; ctx.fillText(m.text, x, above ? y - s * 1.6 : y + s * 1.6); }
    }
  }
  _drawHighLow(pane, from, to) {
    if (!CANDLE_TYPES.has(this.type) || !this.disp.length) return;
    let hi = -Infinity, lo = Infinity, hiI = -1, loI = -1;
    const a = Math.max(from, Math.ceil(this.xToIdx(0))), b = Math.min(to, Math.floor(this.xToIdx(this.plotW)));
    for (let i = a; i <= b; i++) { const d = this.disp[i]; if (!d) continue; if (d.h > hi) { hi = d.h; hiI = i; } if (d.l < lo) { lo = d.l; loI = i; } }
    if (hiI < 0) return;
    const ctx = this.ctx; ctx.font = FONT(11); ctx.fillStyle = this.theme.text; ctx.strokeStyle = this.theme.text; ctx.lineWidth = 1;
    const mark = (i, v, top) => {
      const x = this.idxToX(i), y = this.p2y(pane, v), right = x < this.plotW - 120;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (right ? 14 : -14), y); ctx.stroke();
      ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = top ? 'bottom' : 'top';
      ctx.fillText(`${top ? 'High' : 'Low'} ${this.fmt(v)}`, x + (right ? 17 : -17), y + (top ? 5 : -5));
    };
    mark(hiI, hi, true); mark(loI, lo, false);
  }
  _drawPriceLines(pane) {
    const ctx = this.ctx;
    for (const pl of this.priceLines) {
      const y = Math.round(this.p2y(pane, pl.price)) + 0.5;
      ctx.strokeStyle = pl.color; ctx.lineWidth = pl.width || 1; ctx.setLineDash(pl.style === 'solid' ? [] : [6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.plotW, y); ctx.stroke(); ctx.setLineDash([]);
      if (pl.text) {
        const r = textBox(ctx, pl.text, this.plotW - 10 - (pl.offset || 0), y, { bg: pl.color, color: '#fff', size: 11, baseline: 'middle', pad: 4, align: 'right' });
        pl._box = r;
        if (pl.closable) {
          const bx = r[0] - r[3] - 2;
          ctx.fillStyle = pl.color; ctx.fillRect(bx, r[1], r[3], r[3]);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; const c = r[3] / 2, m = 4;
          ctx.beginPath(); ctx.moveTo(bx + m, r[1] + m); ctx.lineTo(bx + r[3] - m, r[1] + r[3] - m); ctx.moveTo(bx + r[3] - m, r[1] + m); ctx.lineTo(bx + m, r[1] + r[3] - m); ctx.stroke();
          pl._close = [bx, r[1], r[3], r[3]]; void c;
        }
      }
    }
  }
  _drawDrawings(pane) {
    const ctx = this.ctx, c = this._paneCtx(pane);
    for (const d of this.drawings) {
      if (d.pane !== pane.id || d.hidden) continue;
      const tool = TOOLS[d.type]; if (!tool) continue;
      const P = d.points.map((p) => ({ x: c.toX(p.t), y: c.toY(p.p) }));
      d._hit = [];
      ctx.save();
      try { tool.draw(c, d, P); } catch (e) { console.warn(e); }
      ctx.restore();
      if ((d === this.selected || d === this.hoverDrawing) && !d.locked) {
        const H = tool.handles ? tool.handles(c, d, P) : P;
        ctx.lineWidth = 1.5; ctx.setLineDash([]);
        for (const h of H) {
          ctx.beginPath(); ctx.arc(h.x, h.y, d === this.selected ? 6.3 : 5.2, 0, Math.PI * 2);
          ctx.fillStyle = this.theme.handle; ctx.fill(); ctx.strokeStyle = '#2962FF'; ctx.stroke();
        }
      }
    }
  }

  _drawPriceAxis(pticks) {
    const ctx = this.ctx, th = this.theme, S = this.settings, x0 = this.plotW;
    ctx.fillStyle = th.bg; ctx.fillRect(x0, 0, this.axisW, this.h);
    ctx.strokeStyle = th.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0 + 0.5, 0); ctx.lineTo(x0 + 0.5, this.h); ctx.stroke();
    ctx.font = FONT(S.scaleText); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const label = (pane, y, text, bg, fg = '#fff', sub) => {
      if (y < pane.top - 8 || y > pane.top + pane.h + 8) return;
      y = clamp(y, pane.top + 9, pane.top + pane.h - 9);
      const h = sub ? 30 : 18;
      ctx.fillStyle = bg; ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0 + 1, y - 9, this.axisW - 2, h, 2); else ctx.rect(x0 + 1, y - 9, this.axisW - 2, h);
      ctx.fill(); ctx.fillStyle = fg; ctx.fillText(text, x0 + 7, y);
      if (sub) { ctx.font = FONT(S.scaleText - 1); ctx.fillText(sub, x0 + 7, y + 12); ctx.font = FONT(S.scaleText); }
    };
    for (const pane of this.panes) {
      const sc = pane.scale, isMain = pane.id === 'main';
      ctx.save(); ctx.beginPath(); ctx.rect(x0, pane.top, this.axisW, pane.h); ctx.clip();
      ctx.fillStyle = th.text;
      for (const t of pticks.get(pane.id)) {
        if (t.y < pane.top + 6 || t.y > pane.top + pane.h - 6) continue;
        const txt = isMain
          ? (sc.mode === 'percent' ? fmtPct(t.t ?? (t.v / sc.base - 1) * 100, 2) : fmtPrice(t.v, sc.mode === 'log' ? this.info.precision : Math.min(8, Math.max(this.info.precision, t.dec ?? 0))))
          : fmtNum(t.v, Math.min(4, Math.max(0, t.dec ?? 2)));
        ctx.strokeStyle = th.border; ctx.beginPath(); ctx.moveTo(x0, Math.round(t.y) + 0.5); ctx.lineTo(x0 + 4, Math.round(t.y) + 0.5); ctx.stroke();
        ctx.fillText(txt, x0 + 8, t.y);
      }
      ctx.restore();
      const fmtv = (v) => (isMain ? (sc.mode === 'percent' ? fmtPct((v / sc.base - 1) * 100) : this.fmt(v)) : fmtNum(v, 2));
      // indicator value labels
      if (S.showIndLabels) for (const inst of this.indicators) {
        if (inst.pane !== pane.id || !inst.visible || !inst.result || inst.scale) continue;
        for (const pl of inst.def.plots) {
          const st = inst.styles[pl.id]; if (!st.visible) continue; const A = inst.result[pl.id]; if (!A) continue;
          const i = Math.min(A.length - 1, this.disp.length - 1);
          let v = A[i]; let k = i; while (!isFinite(v) && k > i - 3 && k > 0) v = A[--k];
          if (!isFinite(v)) continue;
          let col = st.color; const cols = inst.result._colors?.[pl.id]; if (cols) { col = cols[k]; if (col === 'up') col = S.upColor; else if (col === 'down') col = S.downColor; }
          label(pane, this.p2y(pane, v), isMain ? fmtv(v) : fmtNum(v, inst.def.precision ?? 2), col);
        }
      }
      if (isMain) {
        for (const cmp of this.compares) {
          const D = this.disp; const f = D[Math.max(0, Math.min(this.visRange()[0] + 1, D.length - 1))]; if (!f) continue;
          const base = this.compareValue(cmp, f.t), last = cmp.bars[cmp.bars.length - 1]; if (!last || !base) continue;
          const v = sc.base * (last.c / base); label(pane, this.p2y(pane, v), fmtPct((last.c / base - 1) * 100), cmp.color);
        }
        if (!this.hideAll) for (const d of this.drawings) { if (d.pane !== 'main' || d.hidden) continue; const tool = TOOLS[d.type]; if (tool?.axis && (d === this.selected || tool.id === 'hline' || tool.id === 'hray' || tool.id === 'crossline')) for (const a of tool.axis(d)) label(pane, this.p2y(pane, a.p), fmtv(a.p), a.color); }
        for (const pl of this.priceLines) label(pane, this.p2y(pane, pl.price), fmtv(pl.price), pl.color);
        const D = this.disp;
        if (S.showPrevClose && this.prevClose) label(pane, this.p2y(pane, this.prevClose), fmtv(this.prevClose), '#787B86');
        if (S.showLastPrice && D.length) {
          const b = D[D.length - 1], up = b.c >= b.o, col = up ? S.upColor : S.downColor, y = this.p2y(pane, b.c);
          ctx.save(); ctx.beginPath(); ctx.rect(0, pane.top, this.plotW, pane.h); ctx.clip();
          ctx.strokeStyle = col; ctx.setLineDash([1, 2]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(this.plotW, Math.round(y) + 0.5); ctx.stroke(); ctx.restore();
          let sub = null;
          if (S.showCountdown && this.replayEnd == null && this.type !== 'renko' && this.type !== 'linebreak') {
            const end = b.t + this.info.intervalMs, left = end - Date.now();
            if (left > 0 && left <= this.info.intervalMs) sub = fmtDuration(left);
          }
          label(pane, y, fmtv(b.c), col, '#fff', sub);
        }
      } else if (S.showIndLabels) { /* labels above */ }
      // crosshair label
      if (this.cross && this.cross.pane === pane && this.cursorMode !== 'arrow') {
        label(pane, this.cross.y, fmtv(this.y2p(pane, this.cross.y)), th.crossLabel);
      }
      // drag scale hint
      if (!sc.auto) { ctx.fillStyle = th.text; ctx.font = FONT(9, true); ctx.fillText('A', x0 + this.axisW - 12, pane.top + pane.h - 10); ctx.font = FONT(S.scaleText); }
    }
  }
  _drawTimeAxis(tticks) {
    const ctx = this.ctx, th = this.theme, S = this.settings, y0 = this.plotH;
    ctx.fillStyle = th.bg; ctx.fillRect(0, y0, this.w, TIME_H);
    ctx.strokeStyle = th.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(this.w, y0 + 0.5); ctx.stroke();
    ctx.font = FONT(S.scaleText); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of tticks) {
      if (t.x < 15 || t.x > this.plotW - 15) continue;
      ctx.fillStyle = t.w >= 90 ? th.strong : th.text; ctx.font = FONT(S.scaleText, t.w >= 90);
      ctx.fillText(t.label, t.x, y0 + TIME_H / 2);
    }
    const tlabel = (x, txt, bg) => {
      ctx.font = FONT(S.scaleText); const w = ctx.measureText(txt).width + 14;
      const lx = clamp(x - w / 2, 0, this.plotW - w);
      ctx.fillStyle = bg; ctx.fillRect(lx, y0 + 1, w, TIME_H - 2); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, lx + 7, y0 + TIME_H / 2); ctx.textAlign = 'center';
    };
    if (!this.hideAll) for (const d of this.drawings) { const tool = TOOLS[d.type]; if (tool?.taxis && !d.hidden) for (const a of tool.taxis(d)) tlabel(this.idxToX(this.tIdx(a.t)), fmtDateTime(a.t, this.tz, this.info.intervalMs < DAY), a.color); }
    if (this.cross && this.cursorMode !== 'arrow') {
      const t = this.idxT(this.cross.idx);
      tlabel(this.idxToX(this.cross.idx), fmtDateTime(t, this.tz, this.info.intervalMs < DAY), th.crossLabel);
    }
  }
  _drawCross() {
    if (!this.cross || this.drag?.kind === 'pan' && this.cross.touch) return;
    const ctx = this.ctx, th = this.theme, c = this.cross;
    const x = Math.round(this.idxToX(c.idx)) + 0.5, y = Math.round(c.y) + 0.5;
    if (this.cursorMode === 'arrow') return;
    if (this.cursorMode === 'dot') { ctx.fillStyle = th.cross; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.strokeStyle = th.cross; ctx.lineWidth = 1; ctx.setLineDash(this.settings.crossStyle === 'solid' ? [] : this.settings.crossStyle === 'dotted' ? [1, 2] : [5, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.plotH);
    ctx.moveTo(0, y); ctx.lineTo(this.plotW, y); ctx.stroke(); ctx.setLineDash([]);
    if (this.cursorMode === 'eraser') { ctx.strokeStyle = '#F23645'; ctx.strokeRect(x - 6, y - 6, 12, 12); }
  }

  /* --------------------------- legend (DOM) --------------------------- */
  _buildLegend() {
    const L = this.legendLayer; L.innerHTML = '';
    this._lg = { panes: new Map() };
    for (const pane of this.panes) {
      const box = el('div', { class: 'legend', dataset: { pane: pane.id } });
      if (pane.id === 'main') {
        const main = el('div', { class: 'lg-row lg-main' });
        const title = el('button', { class: 'lg-title', dataset: { act: 'symbol' }, title: 'Change symbol' }, `${this.info.title || this.info.symbol}`);
        const meta = el('span', { class: 'lg-meta' }, ` · ${this.info.ivLabel} · ${this.info.exchange}`);
        const status = el('span', { class: 'lg-status' + (this.info.live ? ' live' : ''), title: this.info.live ? 'Real-time data' : 'Simulated data' }, this.info.live ? '' : 'SIM');
        const ohlc = el('span', { class: 'lg-ohlc' });
        const coll = el('button', { class: 'lg-collapse', dataset: { act: 'collapse' }, title: 'Hide / show indicator legend', html: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 6.5l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' });
        main.append(title, meta, status, ohlc);
        box.append(main);
        this._lg.ohlc = ohlc;
        if (this.info.tradeButtons) {
          const tb = el('div', { class: 'lg-trade' },
            el('button', { class: 'lg-sell', dataset: { act: 'sell' } }, el('span', { class: 'px' }, '—'), el('small', {}, 'SELL')),
            el('span', { class: 'lg-spread' }, '0'),
            el('button', { class: 'lg-buy', dataset: { act: 'buy' } }, el('span', { class: 'px' }, '—'), el('small', {}, 'BUY')));
          box.append(tb); this._lg.trade = tb;
          if (this._bidAsk) requestAnimationFrame(() => this.setTradePrices(...this._bidAsk));
        }
        for (const cmp of this.compares) {
          box.append(el('div', { class: 'lg-row lg-ind', dataset: { cmp: cmp.id } },
            el('span', { class: 'lg-swatch', style: { background: cmp.color } }), el('span', { class: 'lg-name' }, cmp.label), el('span', { class: 'lg-vals', dataset: { cmpv: cmp.id } }),
            el('span', { class: 'lg-acts' }, el('button', { dataset: { act: 'cmpremove', id: cmp.id }, title: 'Remove', html: '&times;' }))));
        }
        if (this.indicators.some((i) => i.pane === 'main') || this.compares.length) box.append(coll);
      }
      for (const inst of this.indicators) {
        if (inst.pane !== pane.id) continue;
        const args = this.settings.showIndInputs && inst.def.id !== 'vol' ? Object.values(inst.inputs).filter((v) => typeof v !== 'boolean').join(' ') : '';
        const row = el('div', { class: 'lg-row lg-ind' + (inst.visible ? '' : ' off'), dataset: { uid: inst.uid } },
          el('span', { class: 'lg-name', dataset: { act: 'settings', id: inst.uid } }, `${inst.def.short}${args ? ' ' + args : ''}`),
          el('span', { class: 'lg-vals' }),
          el('span', { class: 'lg-acts' },
            el('button', { dataset: { act: 'toggle', id: inst.uid }, title: inst.visible ? 'Hide' : 'Show', html: inst.visible ? EYE : EYE_OFF }),
            el('button', { dataset: { act: 'settings', id: inst.uid }, title: 'Settings', html: GEAR }),
            el('button', { dataset: { act: 'remove', id: inst.uid }, title: 'Remove', html: TRASH }),
            pane.id !== 'main' ? el('button', { dataset: { act: 'up', id: pane.id }, title: 'Move pane up', html: '&#8593;' }) : null,
            pane.id !== 'main' ? el('button', { dataset: { act: 'down', id: pane.id }, title: 'Move pane down', html: '&#8595;' }) : null,
          ));
        box.append(row);
      }
      if (pane.id === 'main' && this.legendCollapsed) box.classList.add('collapsed');
      L.append(box);
      this._lg.panes.set(pane.id, box);
    }
    if (!this._lgBound) {
      this._lgBound = true;
      L.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        e.stopPropagation();
        const act = b.dataset.act, id = b.dataset.id;
        if (act === 'settings' && b.classList.contains('lg-name') && matchMedia('(hover: none)').matches) {
          const row = b.closest('.lg-ind');
          if (row && !row.classList.contains('show')) { this.legendLayer.querySelectorAll('.lg-ind.show').forEach((r) => r.classList.remove('show')); row.classList.add('show'); return; }
        }
        if (act === 'collapse') { this.legendCollapsed = !this.legendCollapsed; this._lg.panes.get('main')?.classList.toggle('collapsed', this.legendCollapsed); return; }
        if (act === 'up' || act === 'down') { this.movePane(id, act === 'up' ? -1 : 1); return; }
        this.emit('legend', act, id);
      });
      L.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-act]')) e.stopPropagation(); });
    }
  }
  _updateLegend() {
    if (!this._lg) return;
    const D = this.disp, S = this.settings;
    const i = this.cross ? clamp(Math.round(this.cross.idx), 0, D.length - 1) : D.length - 1;
    const b = D[i];
    for (const [pid, box] of this._lg.panes) { const p = this.paneOf(pid); if (p) { box.style.top = p.top + 'px'; box.style.maxHeight = Math.max(24, p.h - 4) + 'px'; } }
    if (this._lg.ohlc) {
      if (b && S.showOHLC) {
        const prev = D[i - 1], col = b.c >= b.o ? S.upColor : S.downColor;
        const ch = prev ? b.c - prev.c : b.c - b.o, pct = prev ? (ch / prev.c) * 100 : (ch / b.o) * 100;
        this._lg.ohlc.innerHTML = `<i>O</i><b style="color:${col}">${this.fmt(b.o)}</b><i>H</i><b style="color:${col}">${this.fmt(b.h)}</b><i>L</i><b style="color:${col}">${this.fmt(b.l)}</b><i>C</i><b style="color:${col}">${this.fmt(b.c)}</b>` +
          (S.showChange ? `<b style="color:${col}">${ch >= 0 ? '+' : '−'}${this.fmt(Math.abs(ch))} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)</b>` : '');
      } else this._lg.ohlc.innerHTML = '';
    }
    for (const cmp of this.compares) {
      const span = this.legendLayer.querySelector(`[data-cmpv="${CSS.escape(cmp.id)}"]`);
      if (span && b) { const v = this.compareValue(cmp, b.t); span.textContent = isFinite(v) ? fmtPrice(v, cmp.precision ?? 2) : '—'; span.style.color = cmp.color; }
    }
    if (!S.showIndValues) return;
    for (const inst of this.indicators) {
      const box = this._lg.panes.get(inst.pane); if (!box) continue;
      const vals = box.querySelector(`[data-uid="${inst.uid}"] .lg-vals`); if (!vals || !inst.result) continue;
      let html = '';
      for (const pl of inst.def.plots) {
        const st = inst.styles[pl.id]; if (!st.visible) continue;
        if (pl.type === 'boxes') { html += `<b style="color:${st.color}">${(inst.result._boxes || []).length}</b>`; continue; }
        const A = inst.result[pl.id]; if (!A) continue;
        const v = A[i - this.plotOffset(inst, pl)];
        let col = st.color; const cols = inst.result._colors?.[pl.id];
        if (cols && cols[i]) { col = cols[i]; if (col === 'up') col = S.upColor; else if (col === 'down') col = S.downColor; }
        if (pl.id === 'ma' && inst.def.id === 'vol' && !inst.inputs.showMA) continue;
        const txt = !isFinite(v) ? '∅' : inst.def.format === 'volume' ? fmtVol(v) : inst.pane === 'main' && !inst.scale ? this.fmt(v) : fmtNum(v, inst.def.precision ?? 2);
        html += `<b style="color:${col}">${txt}</b>`;
      }
      vals.innerHTML = html;
    }
  }
  setTradePrices(bid, ask) {
    this._bidAsk = [bid, ask];
    if (!this._lg?.trade) return;
    const [s, , bb] = this._lg.trade.children;
    s.querySelector('.px').textContent = this.fmt(bid); bb.querySelector('.px').textContent = this.fmt(ask);
    this._lg.trade.children[1].textContent = fmtNum((ask - bid) / Math.pow(10, -this.info.precision), 0);
  }
  getValuesAt(i) {
    const D = this.disp; const b = D[i]; if (!b) return null;
    const rows = [{ name: 'Date', value: fmtDateTime(b.t, this.tz, this.info.intervalMs < DAY) }, { name: 'Open', value: this.fmt(b.o) }, { name: 'High', value: this.fmt(b.h) }, { name: 'Low', value: this.fmt(b.l) }, { name: 'Close', value: this.fmt(b.c) }];
    const prev = D[i - 1];
    if (prev) rows.push({ name: 'Change', value: `${fmtPrice(b.c - prev.c, this.info.precision)} (${fmtPct((b.c / prev.c - 1) * 100)})`, color: b.c >= prev.c ? this.settings.upColor : this.settings.downColor });
    rows.push({ name: 'Volume', value: fmtVol(b.v) });
    const groups = [{ title: `${this.info.symbol} · ${this.info.ivLabel}`, rows }];
    for (const inst of this.indicators) {
      if (!inst.result) continue;
      const r = [];
      for (const pl of inst.def.plots) { const A = inst.result[pl.id]; if (!A) continue; const v = A[i - this.plotOffset(inst, pl)]; r.push({ name: pl.name, value: !isFinite(v) ? '∅' : inst.def.format === 'volume' ? fmtVol(v) : fmtNum(v, inst.def.precision ?? Math.max(2, this.info.precision)), color: inst.styles[pl.id].color }); }
      groups.push({ title: inst.def.short + ' ' + Object.values(inst.inputs).filter((v) => typeof v !== 'boolean').join(' '), rows: r });
    }
    return groups;
  }

  /* --------------------------- navigation buttons --------------------------- */
  _buildNav() {
    const btn = (act, html, title) => el('button', { dataset: { act }, title, html });
    this.navEl.append(
      btn('zoomout', '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M4 9h10" stroke="currentColor" stroke-width="1.6"/></svg>', 'Zoom out'),
      btn('zoomin', '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M4 9h10M9 4v10" stroke="currentColor" stroke-width="1.6"/></svg>', 'Zoom in'),
      btn('left', '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M11 4L6 9l5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', 'Scroll left'),
      btn('right', '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M7 4l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', 'Scroll right'),
      btn('reset', '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M4.5 7A5 5 0 1 1 4 10" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 3.5V7.5h4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', 'Reset chart view'),
    );
    this.endBtn = el('button', { class: 'chart-toend', title: 'Scroll to the most recent bar', html: '<svg viewBox="0 0 18 18" width="14" height="14"><path d="M5 4l5 5-5 5M12 4v10" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>' });
    this.root.append(this.endBtn);
    this.endBtn.addEventListener('click', () => this.scrollToEnd());
    this.navEl.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]')?.dataset.act;
      if (a === 'zoomin') this.zoom(1.25); else if (a === 'zoomout') this.zoom(0.8);
      else if (a === 'left') this.scrollBars(-Math.round(this.plotW / this.spacing / 5)); else if (a === 'right') this.scrollBars(Math.round(this.plotW / this.spacing / 5));
      else if (a === 'reset') this.resetView();
    });
    this.navEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  _updateNav() {
    const far = this.rightIdx < this.disp.length - 1 - 2;
    this.endBtn.style.display = far ? 'flex' : 'none';
    this.endBtn.style.right = this.axisW + 8 + 'px'; this.endBtn.style.bottom = TIME_H + 8 + 'px';
    this.navEl.style.bottom = TIME_H + 14 + 'px';
    this.navEl.style.left = (this.plotW / 2) + 'px';
  }

  /* --------------------------- interaction --------------------------- */
  _pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _region(x, y) {
    if (y >= this.plotH) return { kind: x < this.plotW ? 'time' : 'corner' };
    for (let k = 0; k < this.panes.length; k++) {
      const p = this.panes[k];
      if (k > 0 && Math.abs(y - p.top) <= 3 && x < this.plotW) return { kind: 'sep', pane: p, idx: k };
      if (y >= p.top && y < p.top + p.h) return { kind: x >= this.plotW ? 'price' : 'plot', pane: p };
    }
    return { kind: 'none' };
  }
  _hitDrawing(x, y, pane) {
    if (this.hideAll) return null;
    for (let k = this.drawings.length - 1; k >= 0; k--) { const d = this.drawings[k]; if (d.hidden || (pane && d.pane !== pane.id)) continue; if (hitDrawing(d, x, y)) return d; }
    return null;
  }
  _hitHandle(x, y) {
    const list = [this.selected, this.hoverDrawing].filter(Boolean);
    for (const d of list) {
      if (d.locked || this.lockAll) continue;
      const pane = this.paneOf(d.pane); if (!pane) continue;
      const tool = TOOLS[d.type], c = this._paneCtx(pane);
      const P = d.points.map((p) => ({ x: c.toX(p.t), y: c.toY(p.p) }));
      const H = tool.handles ? tool.handles(c, d, P) : P;
      for (let i = 0; i < H.length; i++) if (Math.hypot(H[i].x - x, H[i].y - y) <= 9.2) return { d, i, pane };
    }
    return null;
  }
  _hitPriceLine(x, y) {
    const main = this.panes[0];
    for (const pl of this.priceLines) {
      if (pl._close && x >= pl._close[0] && x <= pl._close[0] + pl._close[2] && y >= pl._close[1] && y <= pl._close[1] + pl._close[3]) return { pl, close: true };
      if (pl.draggable && Math.abs(this.p2y(main, pl.price) - y) <= 5) return { pl };
      if (pl._box && x >= pl._box[0] && x <= pl._box[0] + pl._box[2] && y >= pl._box[1] && y <= pl._box[1] + pl._box[3]) return { pl, box: true };
    }
    return null;
  }
  _bind() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this._down(e));
    cv.addEventListener('pointermove', (e) => this._move(e));
    cv.addEventListener('pointerup', (e) => this._up(e));
    cv.addEventListener('pointercancel', (e) => this._up(e));
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.drag) { this.cross = null; this.hoverDrawing = null; this.emit('crosshair', null); this.render(); } });
    cv.addEventListener('dblclick', (e) => this._dbl(e));
    cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { x, y } = this._pos(e), r = this._region(x, y);
      if (this.creating) { this.cancel(); return; }
      const d = r.kind === 'plot' ? this._hitDrawing(x, y) : null;
      if (d) this.select(d);
      this.emit('contextmenu', { clientX: e.clientX, clientY: e.clientY, region: r.kind, pane: r.pane, drawing: d, price: r.pane ? this.y2p(r.pane, y) : null, t: this.idxT(Math.round(this.xToIdx(x))) });
    });
  }
  _down(e) {
    if (e.button === 2) return;
    const { x, y } = this._pos(e);
    this.pointers.set(e.pointerId, { x, y });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    this.emit('activate');
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), sp0: this.spacing, mid: (a.x + b.x) / 2, idx: this.xToIdx((a.x + b.x) / 2) };
      return;
    }
    const r = this._region(x, y);
    const touch = e.pointerType === 'touch';
    if (r.kind === 'plot') {
      if (this.tool || (e.shiftKey && !this.creating)) {
        if (!this.tool) { this.tool = 'measure'; this._tempTool = true; }
        this._toolDown(r.pane, x, y, e); return;
      }
      if (this.drawings.some((d) => TOOLS[d.type]?.temp)) { this.drawings = this.drawings.filter((d) => !TOOLS[d.type]?.temp); this.render(); }
      if (this.cursorMode === 'eraser') { const d = this._hitDrawing(x, y); if (d) this.removeDrawing(d); return; }
      const pl = this._hitPriceLine(x, y);
      if (pl) {
        if (pl.close) { pl.pl.onClose?.(); return; }
        if (pl.pl.draggable) { this.drag = { kind: 'pline', pl: pl.pl, y0: y }; this.canvas.style.cursor = 'ns-resize'; return; }
        if (pl.box) { pl.pl.onClick?.(); return; }
      }
      const h = !this.lockAll && this._hitHandle(x, y);
      if (h) { this.snapshot(); this.selected = h.d; this.emit('select', h.d); this.drag = { kind: 'handle', ...h }; return; }
      const d = this._hitDrawing(x, y);
      if (d) {
        this.selected = d; this.emit('select', d);
        if (!d.locked && !this.lockAll) {
          const pt = this._pt(r.pane, x, y, false);
          this.drag = { kind: 'move', d, pane: r.pane, i0: this.tIdx(pt.t), p0: pt.p, orig: d.points.map((p) => ({ ...p, i: this.tIdx(p.t) })), snapped: false };
        }
        this.render(); return;
      }
      if (this.selected) { this.selected = null; this.emit('select', null); }
      const sc = r.pane.scale;
      this.drag = { kind: 'pan', x0: x, y0: y, r0: this.rightIdx, min0: sc.min, max0: sc.max, pane: r.pane, moved: false, touch };
      if (touch) this.cross = { idx: Math.round(this.xToIdx(x)), y, pane: r.pane, touch: true };
      this.canvas.style.cursor = 'grabbing';
    } else if (r.kind === 'price') {
      const sc = r.pane.scale; sc.auto = false;
      this.drag = { kind: 'pscale', y0: y, min0: sc.min, max0: sc.max, pane: r.pane };
    } else if (r.kind === 'time') {
      this.drag = { kind: 'tscale', x0: x, sp0: this.spacing, anchor: this.rightIdx };
    } else if (r.kind === 'sep') {
      const a = this.panes[r.idx - 1], b = this.panes[r.idx];
      this.drag = { kind: 'sep', a, b, y0: y, ha: a.h, hb: b.h };
    }
    this.render();
  }
  _toolDown(pane, x, y, e) {
    const tool = TOOLS[this.tool]; if (!tool) return;
    const pt = this._pt(pane, x, y, tool.n !== 0);
    const cr = this.creating;
    if (!cr) {
      if (!tool.temp) this.snapshot();
      const d = { id: uid(), type: tool.id, pane: pane.id, points: [pt], style: JSON.parse(JSON.stringify(tool.defaults)) };
      if (this.lastStyles?.[tool.id]) Object.assign(d.style, this.lastStyles[tool.id]);
      this.drawings.push(d);
      if (tool.n === 0) { this.creating = { d, idx: 0 }; this.drag = { kind: 'brush', pane }; return; }
      if (tool.create) { d.points = tool.create(pt, this._paneCtx(pane)); this._finish(d); return; }
      if (tool.n === 1) { this._finish(d); return; }
      d.points.push({ ...pt });
      this.creating = { d, idx: 1, x0: x, y0: y, pane, first: true };
      this.drag = { kind: 'create' };
      this.render(); return;
    }
    this._place(cr, pt, e.detail >= 2);
  }
  _place(cr, pt, dbl) {
    const tool = TOOLS[cr.d.type];
    cr.d.points[cr.idx] = pt;
    if (tool.n === -1) {
      if (dbl && cr.d.points.length > 2) { cr.d.points.pop(); this._finish(); return; }
      cr.d.points.push({ ...pt }); cr.idx++;
    } else if (cr.idx + 1 >= tool.n) { this._finish(); return; }
    else { cr.d.points.push({ ...pt }); cr.idx++; }
    this.render();
  }
  _finish(dd) {
    const d = dd || this.creating?.d; this.creating = null; this.drag = null;
    if (!d) return;
    const tool = TOOLS[d.type];
    if (tool.id === 'zoom') {
      this.drawings = this.drawings.filter((x) => x !== d);
      const i0 = this.tIdx(d.points[0].t), i1 = this.tIdx(d.points[1].t);
      if (Math.abs(i1 - i0) >= 2) { this.spacing = clamp(this.plotW / Math.abs(i1 - i0), 0.6, 80); this.rightIdx = Math.max(i0, i1); }
    } else if (!tool.temp) { this.selected = d; if (tool.needsText || tool.needsEmoji) this.emit('requestText', d); }
    if (this._tempTool) { this.tool = null; this._tempTool = false; }
    else if (!this.stayDrawing || tool.temp) { this.tool = null; this.emit('tool', null); this.canvas.style.cursor = ''; }
    this._changed();
  }
  _move(e) {
    const { x, y } = this._pos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
    const dr = this.drag;
    if (dr?.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()]; if (!b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.spacing = clamp(dr.sp0 * (d / dr.d0), 0.6, 80);
      const mid = (a.x + b.x) / 2;
      this.rightIdx = dr.idx + (this.plotW - mid) / this.spacing;
      this._clampView(); this.render(); return;
    }
    const r = this._region(x, y);
    // crosshair
    if (r.pane && x < this.plotW) {
      let cy = y;
      const idx = clamp(Math.round(this.xToIdx(x)), -1e6, 1e9);
      if (this.magnet && r.pane.id === 'main' && this.disp[idx] && (this.tool || this.creating)) {
        const b = this.disp[idx]; let bd = Infinity, best = y;
        for (const v of [b.o, b.h, b.l, b.c]) { const yy = this.p2y(r.pane, v); if (Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = yy; } }
        if (this.magnet === 2 || bd < 30) cy = best;
      }
      this.cross = { idx, y: cy, pane: r.pane };
      this.emit('crosshair', { idx, t: this.idxT(idx), price: this.y2p(r.pane, cy) });
    } else if (!dr) { this.cross = null; }
    if (!dr) {
      if (this.creating) {
        const cr = this.creating; const pane = this.paneOf(cr.d.pane);
        if (pane) cr.d.points[cr.idx] = this._pt(pane, x, y, true);
        this.render(); return;
      }
      let cur = '';
      if (r.kind === 'price') cur = 'ns-resize';
      else if (r.kind === 'time') cur = 'ew-resize';
      else if (r.kind === 'sep') cur = 'row-resize';
      else if (r.kind === 'plot') {
        if (this.tool) cur = 'crosshair';
        else {
          const prevHover = this.hoverDrawing;
          const h = this._hitHandle(x, y);
          const d = h ? h.d : this._hitDrawing(x, y);
          this.hoverDrawing = d;
          const pl = this._hitPriceLine(x, y);
          cur = h ? 'pointer' : d ? (this.cursorMode === 'eraser' ? 'not-allowed' : 'move') : pl ? (pl.close || pl.box ? 'pointer' : 'ns-resize') : this.cursorMode === 'dot' || this.cursorMode === 'cross' ? 'crosshair' : 'default';
          if (prevHover !== d) this.render();
        }
      }
      this.canvas.style.cursor = cur;
      this.render(); return;
    }
    switch (dr.kind) {
      case 'pan': {
        const dx = x - dr.x0, dy = y - dr.y0;
        if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
        this.rightIdx = dr.r0 - dx / this.spacing;
        const sc = dr.pane.scale;
        if (!sc.auto) { const span = dr.max0 - dr.min0, dv = (dy / dr.pane.h) * span * (sc.inverted ? -1 : 1); sc.min = dr.min0 + dv; sc.max = dr.max0 + dv; }
        if (dr.touch) this.cross = null;
        this._clampView(); break;
      }
      case 'pscale': {
        const sc = dr.pane.scale, f = Math.exp((y - dr.y0) / 150);
        const mid = (dr.min0 + dr.max0) / 2, half = ((dr.max0 - dr.min0) / 2) * f;
        sc.min = mid - half; sc.max = mid + half; break;
      }
      case 'tscale': {
        const f = Math.exp((x - dr.x0) / 150);
        this.spacing = clamp(dr.sp0 * f, 0.6, 80);
        this._clampView(); break;
      }
      case 'sep': {
        const dy = y - dr.y0, ha = clamp(dr.ha + dy, MIN_PANE, dr.ha + dr.hb - MIN_PANE), hb = dr.ha + dr.hb - ha;
        const tot = this.panes.reduce((a, p) => a + p.ratio, 0), sum = dr.a.ratio + dr.b.ratio;
        void tot;
        dr.a.ratio = (sum * ha) / (ha + hb); dr.b.ratio = sum - dr.a.ratio; break;
      }
      case 'pline': { dr.pl.price = this.y2p(this.panes[0], y); dr.moved = true; break; }
      case 'handle': {
        const tool = TOOLS[dr.d.type], pt = this._pt(dr.pane, x, y, true);
        if (tool.drag) tool.drag(dr.d, dr.i, pt); else dr.d.points[dr.i] = pt;
        dr.moved = true; break;
      }
      case 'move': {
        const pt = this._pt(dr.pane, x, y, false);
        if (!dr.snapped) { this.snapshot(); dr.snapped = true; }
        const di = Math.round(this.tIdx(pt.t) - dr.i0), dp = pt.p - dr.p0;
        dr.d.points = dr.orig.map((o) => ({ t: this.idxT(o.i + di), p: o.p + dp }));
        dr.moved = true; break;
      }
      case 'brush': {
        const d = this.creating?.d; if (!d) break;
        const pt = this._pt(dr.pane, x, y, false), last = d.points[d.points.length - 1];
        if (Math.hypot(this.idxToX(this.tIdx(last.t)) - x, this.p2y(dr.pane, last.p) - y) > 2) d.points.push(pt);
        break;
      }
      case 'create': {
        const cr = this.creating; if (cr) { const pane = this.paneOf(cr.d.pane); cr.d.points[cr.idx] = this._pt(pane, x, y, true); }
        break;
      }
    }
    this.render();
  }
  _up(e) {
    const { x, y } = this._pos(e);
    this.pointers.delete(e.pointerId);
    const dr = this.drag;
    if (dr?.kind === 'pinch') { if (this.pointers.size < 2) this.drag = null; return; }
    this.drag = null;
    if (!dr) return;
    if (dr.kind === 'brush') { const d = this.creating?.d; if (d && d.points.length > 1) this._finish(); else { this.drawings = this.drawings.filter((q) => q !== d); this.creating = null; } }
    else if (dr.kind === 'create') {
      const cr = this.creating;
      if (cr && cr.first && Math.hypot(x - cr.x0, y - cr.y0) > 8) { cr.first = false; this._place(cr, this._pt(this.paneOf(cr.d.pane), x, y, true), false); }
      else if (cr) cr.first = false;
    }
    else if (dr.kind === 'pline' && dr.moved) dr.pl.onMove?.(dr.pl.price);
    else if (dr.kind === 'handle' || (dr.kind === 'move' && dr.moved)) this._changed();
    else if (dr.kind === 'pan') {
      this.canvas.style.cursor = 'crosshair';
      if (!dr.moved) this.emit('click', { t: this.idxT(Math.round(this.xToIdx(x))), idx: Math.round(this.xToIdx(x)), price: this.y2p(dr.pane, y) });
      if (dr.touch && !dr.moved) { this.cross = { idx: Math.round(this.xToIdx(x)), y, pane: dr.pane }; }
      else if (dr.touch) this.cross = null;
    }
    this.render();
  }
  _dbl(e) {
    const { x, y } = this._pos(e), r = this._region(x, y);
    if (r.kind === 'price') { r.pane.scale.auto = true; this.render(); }
    else if (r.kind === 'time') { this.resetView(); }
    else if (r.kind === 'plot' && !this.tool && !this.creating) {
      const d = this._hitDrawing(x, y); if (d) { this.emit('editDrawing', d); return; }
      const pl = this._hitPriceLine(x, y); if (pl) { pl.pl.onDblClick?.(); return; }
      for (const inst of this.indicators) if (inst.pane === r.pane.id && r.pane.id !== 'main') { this.emit('legend', 'settings', inst.uid); return; }
    }
  }
  _wheel(e) {
    e.preventDefault();
    const { x, y } = this._pos(e), r = this._region(x, y);
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 30; dy *= 30; }
    if (r.kind === 'price' && r.pane) {
      const sc = r.pane.scale; sc.auto = false; const f = Math.exp(dy * 0.002); const mid = (sc.min + sc.max) / 2, half = ((sc.max - sc.min) / 2) * f; sc.min = mid - half; sc.max = mid + half; this.render(); return;
    }
    if (Math.abs(dx) > Math.abs(dy) || e.shiftKey) { this.rightIdx += (e.shiftKey ? dy : dx) / this.spacing; this._clampView(); this.render(); return; }
    this.zoom(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), x < this.plotW ? x : undefined);
  }

  screenshot() {
    const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height + 40 * this.dpr;
    const x = c.getContext('2d'); x.fillStyle = this.theme.bg; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(this.canvas, 0, 40 * this.dpr);
    x.scale(this.dpr, this.dpr); x.fillStyle = this.theme.strong; x.font = FONT(14, true); x.textBaseline = 'middle';
    const b = this.disp[this.disp.length - 1];
    x.fillText(`${this.info.title} · ${this.info.ivLabel} · ${this.info.exchange}${b ? '   C ' + this.fmt(b.c) : ''}`, 12, 20);
    x.font = FONT(11); x.fillStyle = this.theme.text; x.textAlign = 'right'; x.fillText(`TradingAnalyzer · ${new Date().toUTCString()}`, this.w - 12, 20);
    return c.toDataURL('image/png');
  }
}

const EYE = '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5S1.5 9 1.5 9z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="9" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5S1.5 9 1.5 9z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 15L15 3" stroke="currentColor" stroke-width="1.3"/></svg>';
const GEAR = '<svg viewBox="0 0 18 18" width="16" height="16"><circle cx="9" cy="9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9 1.8v2.1M9 14.1v2.1M1.8 9h2.1M14.1 9h2.1M3.9 3.9l1.5 1.5M12.6 12.6l1.5 1.5M3.9 14.1l1.5-1.5M12.6 5.4l1.5-1.5" stroke="currentColor" stroke-width="1.3"/></svg>';
const TRASH = '<svg viewBox="0 0 18 18" width="16" height="16"><path d="M3.5 5h11M7 5V3.5h4V5M5 5l.8 10h6.4L13 5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
