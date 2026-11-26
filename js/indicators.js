// Technical analysis library + indicator definitions
const N = NaN;
const arr = (n, v = N) => new Array(n).fill(v);

export const ta = {
  sma(src, len) {
    const n = src.length, out = arr(n); let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (isNaN(v)) { sum = 0; cnt = 0; continue; }
      sum += v; cnt++;
      if (cnt > len) { sum -= src[i - len]; cnt = len; }
      if (cnt === len) out[i] = sum / len;
    }
    return out;
  },
  ema(src, len) {
    const n = src.length, out = arr(n), k = 2 / (len + 1); let prev = N, cnt = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (isNaN(v)) continue;
      if (isNaN(prev)) { sum += v; cnt++; if (cnt === len) { prev = sum / len; out[i] = prev; } continue; }
      prev = v * k + prev * (1 - k); out[i] = prev;
    }
    return out;
  },
  rma(src, len) {
    const n = src.length, out = arr(n), k = 1 / len; let prev = N, cnt = 0, sum = 0;
    for (let i = 0; i < n; i++) {
      const v = src[i];
      if (isNaN(v)) continue;
      if (isNaN(prev)) { sum += v; cnt++; if (cnt === len) { prev = sum / len; out[i] = prev; } continue; }
      prev = v * k + prev * (1 - k); out[i] = prev;
    }
    return out;
  },
  wma(src, len) {
    const n = src.length, out = arr(n), d = (len * (len + 1)) / 2;
    for (let i = len - 1; i < n; i++) {
      let s = 0, ok = true;
      for (let j = 0; j < len; j++) { const v = src[i - j]; if (isNaN(v)) { ok = false; break; } s += v * (len - j); }
      if (ok) out[i] = s / d;
    }
    return out;
  },
  hma(src, len) {
    const a = ta.wma(src, Math.max(1, Math.round(len / 2))), b = ta.wma(src, len);
    return ta.wma(a.map((v, i) => 2 * v - b[i]), Math.max(1, Math.round(Math.sqrt(len))));
  },
  vwma(src, vol, len) {
    const pv = src.map((v, i) => v * vol[i]);
    const a = ta.sma(pv, len), b = ta.sma(vol, len);
    return a.map((v, i) => v / b[i]);
  },
  dema(src, len) { const e1 = ta.ema(src, len), e2 = ta.ema(e1, len); return e1.map((v, i) => 2 * v - e2[i]); },
  tema(src, len) { const e1 = ta.ema(src, len), e2 = ta.ema(e1, len), e3 = ta.ema(e2, len); return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]); },
  alma(src, len, offset = 0.85, sigma = 6) {
    const n = src.length, out = arr(n), m = offset * (len - 1), s = len / sigma;
    const w = []; let ws = 0;
    for (let j = 0; j < len; j++) { const x = Math.exp(-((j - m) ** 2) / (2 * s * s)); w.push(x); ws += x; }
    for (let i = len - 1; i < n; i++) { let sum = 0; for (let j = 0; j < len; j++) sum += src[i - len + 1 + j] * w[j]; out[i] = sum / ws; }
    return out;
  },
  ma(type, src, len, vol) {
    switch (type) {
      case 'EMA': return ta.ema(src, len); case 'WMA': return ta.wma(src, len); case 'RMA': return ta.rma(src, len);
      case 'HMA': return ta.hma(src, len); case 'VWMA': return ta.vwma(src, vol, len); default: return ta.sma(src, len);
    }
  },
  stdev(src, len) {
    const n = src.length, out = arr(n), m = ta.sma(src, len);
    for (let i = len - 1; i < n; i++) { if (isNaN(m[i])) continue; let s = 0; for (let j = 0; j < len; j++) s += (src[i - j] - m[i]) ** 2; out[i] = Math.sqrt(s / len); }
    return out;
  },
  highest(src, len) {
    const n = src.length, out = arr(n);
    for (let i = len - 1; i < n; i++) { let m = -Infinity; for (let j = 0; j < len; j++) if (src[i - j] > m) m = src[i - j]; out[i] = m; }
    return out;
  },
  lowest(src, len) {
    const n = src.length, out = arr(n);
    for (let i = len - 1; i < n; i++) { let m = Infinity; for (let j = 0; j < len; j++) if (src[i - j] < m) m = src[i - j]; out[i] = m; }
    return out;
  },
  change(src, len = 1) { return src.map((v, i) => (i >= len ? v - src[i - len] : N)); },
  tr(h, l, c) { return h.map((v, i) => (i === 0 ? v - l[i] : Math.max(v - l[i], Math.abs(v - c[i - 1]), Math.abs(l[i] - c[i - 1])))); },
  atr(h, l, c, len) { return ta.rma(ta.tr(h, l, c), len); },
  rsi(src, len) {
    const ch = ta.change(src);
    const up = ta.rma(ch.map((v) => (isNaN(v) ? N : Math.max(v, 0))), len);
    const dn = ta.rma(ch.map((v) => (isNaN(v) ? N : Math.max(-v, 0))), len);
    return up.map((u, i) => (dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i])));
  },
  stoch(c, h, l, len) {
    const hh = ta.highest(h, len), ll = ta.lowest(l, len);
    return c.map((v, i) => (hh[i] - ll[i] === 0 ? 50 : (100 * (v - ll[i])) / (hh[i] - ll[i])));
  },
  linreg(src, len, off = 0) {
    const n = src.length, out = arr(n);
    for (let i = len - 1; i < n; i++) {
      let sx = 0, sy = 0, sxy = 0, sxx = 0;
      for (let j = 0; j < len; j++) { const x = j, y = src[i - len + 1 + j]; sx += x; sy += y; sxy += x * y; sxx += x * x; }
      const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx || 1), icpt = (sy - slope * sx) / len;
      out[i] = icpt + slope * (len - 1 - off);
    }
    return out;
  },
  cross(a, b, i) { return a[i - 1] <= b[i - 1] && a[i] > b[i]; },
  crossunder(a, b, i) { return a[i - 1] >= b[i - 1] && a[i] < b[i]; },
};

export function sources(bars) {
  const n = bars.length;
  const o = new Array(n), h = new Array(n), l = new Array(n), c = new Array(n), v = new Array(n), t = new Array(n);
  for (let i = 0; i < n; i++) { const b = bars[i]; o[i] = b.o; h[i] = b.h; l[i] = b.l; c[i] = b.c; v[i] = b.v; t[i] = b.t; }
  return {
    open: o, high: h, low: l, close: c, volume: v, time: t,
    get hl2() { return h.map((x, i) => (x + l[i]) / 2); },
    get hlc3() { return h.map((x, i) => (x + l[i] + c[i]) / 3); },
    get ohlc4() { return h.map((x, i) => (o[i] + x + l[i] + c[i]) / 4); },
    get hlcc4() { return h.map((x, i) => (x + l[i] + 2 * c[i]) / 4); },
  };
}

const src = (S, name) => S[name] || S.close;
const SRC = { id: 'source', name: 'Source', type: 'source', def: 'close' };
const LEN = (d) => ({ id: 'length', name: 'Length', type: 'int', def: d, min: 1, max: 2000 });
const MAT = { id: 'maType', name: 'MA Type', type: 'select', def: 'SMA', options: ['SMA', 'EMA', 'WMA', 'RMA', 'HMA', 'VWMA'] };
const UP = '#089981', DN = '#F23645';

const maDef = (id, name, short, color, fn) => ({
  id, name, short, overlay: true, group: 'Moving Averages',
  inputs: [LEN(id === 'sma' ? 20 : id === 'ema' ? 20 : 20), SRC, { id: 'offset', name: 'Offset', type: 'int', def: 0, min: -500, max: 500 }],
  plots: [{ id: 'ma', name: short, color, width: 2 }],
  calc: (S, p) => { const r = fn(S, p); return { ma: p.offset ? shift(r, p.offset) : r }; },
});
function shift(a, k) { const n = a.length, o = arr(n); for (let i = 0; i < n; i++) { const j = i - k; if (j >= 0 && j < n) o[i] = a[j]; } return o; }

export const INDICATORS = [
  {
    id: 'vol', name: 'Volume', short: 'Vol', overlay: true, ownScale: true, group: 'Volume',
    inputs: [{ id: 'maLen', name: 'MA Length', type: 'int', def: 20, min: 1 }, { id: 'showMA', name: 'Show MA', type: 'bool', def: false }],
    plots: [{ id: 'vol', name: 'Volume', type: 'columns', color: UP, colorDown: DN, alpha: 0.5 }, { id: 'ma', name: 'Volume MA', color: '#2962FF', width: 1 }],
    format: 'volume',
    calc: (S, p) => ({
      vol: S.volume,
      ma: p.showMA ? ta.sma(S.volume, p.maLen) : arr(S.volume.length),
      _colors: { vol: S.close.map((c, i) => (c >= S.open[i] ? 'up' : 'down')) },
    }),
  },
  maDef('sma', 'Moving Average Simple', 'SMA', '#2962FF', (S, p) => ta.sma(src(S, p.source), p.length)),
  maDef('ema', 'Moving Average Exponential', 'EMA', '#FF9800', (S, p) => ta.ema(src(S, p.source), p.length)),
  maDef('wma', 'Moving Average Weighted', 'WMA', '#E91E63', (S, p) => ta.wma(src(S, p.source), p.length)),
  maDef('hma', 'Hull Moving Average', 'HMA', '#00BCD4', (S, p) => ta.hma(src(S, p.source), p.length)),
  maDef('vwma', 'Volume Weighted Moving Average', 'VWMA', '#9C27B0', (S, p) => ta.vwma(src(S, p.source), S.volume, p.length)),
  maDef('dema', 'Double EMA', 'DEMA', '#4CAF50', (S, p) => ta.dema(src(S, p.source), p.length)),
  maDef('tema', 'Triple EMA', 'TEMA', '#795548', (S, p) => ta.tema(src(S, p.source), p.length)),
  maDef('alma', 'Arnaud Legoux Moving Average', 'ALMA', '#3F51B5', (S, p) => ta.alma(src(S, p.source), p.length)),
  maDef('lsma', 'Least Squares Moving Average', 'LSMA', '#FF5722', (S, p) => ta.linreg(src(S, p.source), p.length)),
  {
    id: 'macross', name: 'MA Cross', short: 'MA Cross', overlay: true, group: 'Moving Averages',
    inputs: [{ id: 'fast', name: 'Fast Length', type: 'int', def: 9, min: 1 }, { id: 'slow', name: 'Slow Length', type: 'int', def: 21, min: 1 }, MAT],
    plots: [{ id: 'fast', name: 'Fast', color: '#43A047', width: 2 }, { id: 'slow', name: 'Slow', color: '#F44336', width: 2 }],
    calc: (S, p) => ({ fast: ta.ma(p.maType, S.close, p.fast, S.volume), slow: ta.ma(p.maType, S.close, p.slow, S.volume) }),
  },
  {
    id: 'ribbon', name: 'Moving Average Ribbon', short: 'MA Ribbon', overlay: true, group: 'Moving Averages',
    inputs: [MAT, SRC],
    plots: [20, 50, 100, 200].map((l, i) => ({ id: 'ma' + l, name: 'MA ' + l, color: ['#F6C309', '#FB9800', '#FB6500', '#F60C0C'][i], width: 1 })),
    calc: (S, p) => Object.fromEntries([20, 50, 100, 200].map((l) => ['ma' + l, ta.ma(p.maType, src(S, p.source), l, S.volume)])),
  },
  {
    id: 'bb', name: 'Bollinger Bands', short: 'BB', overlay: true, group: 'Volatility',
    inputs: [LEN(20), SRC, { id: 'mult', name: 'StdDev', type: 'float', def: 2, min: 0.1, step: 0.1 }],
    plots: [{ id: 'basis', name: 'Basis', color: '#2962FF', width: 1 }, { id: 'upper', name: 'Upper', color: '#F23645', width: 1 }, { id: 'lower', name: 'Lower', color: '#089981', width: 1 }],
    fills: [{ a: 'upper', b: 'lower', color: 'rgba(33,150,243,0.07)' }],
    calc: (S, p) => {
      const s = src(S, p.source), m = ta.sma(s, p.length), d = ta.stdev(s, p.length);
      return { basis: m, upper: m.map((v, i) => v + p.mult * d[i]), lower: m.map((v, i) => v - p.mult * d[i]) };
    },
  },
  {
    id: 'kc', name: 'Keltner Channels', short: 'KC', overlay: true, group: 'Volatility',
    inputs: [LEN(20), { id: 'mult', name: 'Multiplier', type: 'float', def: 2, step: 0.1 }, { id: 'atrLen', name: 'ATR Length', type: 'int', def: 10 }],
    plots: [{ id: 'basis', name: 'Basis', color: '#2962FF' }, { id: 'upper', name: 'Upper', color: '#2962FF' }, { id: 'lower', name: 'Lower', color: '#2962FF' }],
    fills: [{ a: 'upper', b: 'lower', color: 'rgba(33,150,243,0.06)' }],
    calc: (S, p) => {
      const m = ta.ema(S.close, p.length), a = ta.atr(S.high, S.low, S.close, p.atrLen);
      return { basis: m, upper: m.map((v, i) => v + p.mult * a[i]), lower: m.map((v, i) => v - p.mult * a[i]) };
    },
  },
  {
    id: 'dc', name: 'Donchian Channels', short: 'DC', overlay: true, group: 'Volatility',
    inputs: [LEN(20)],
    plots: [{ id: 'upper', name: 'Upper', color: '#2962FF' }, { id: 'basis', name: 'Basis', color: '#FF6D00' }, { id: 'lower', name: 'Lower', color: '#2962FF' }],
    fills: [{ a: 'upper', b: 'lower', color: 'rgba(33,150,243,0.06)' }],
    calc: (S, p) => {
      const u = ta.highest(S.high, p.length), l = ta.lowest(S.low, p.length);
      return { upper: u, lower: l, basis: u.map((v, i) => (v + l[i]) / 2) };
    },
  },
  {
    id: 'env', name: 'Envelopes', short: 'Env', overlay: true, group: 'Volatility',
    inputs: [LEN(20), { id: 'pct', name: 'Percent', type: 'float', def: 2.5, step: 0.1 }],
    plots: [{ id: 'basis', name: 'Basis', color: '#FF6D00' }, { id: 'upper', name: 'Upper', color: '#2962FF' }, { id: 'lower', name: 'Lower', color: '#2962FF' }],
    calc: (S, p) => { const m = ta.sma(S.close, p.length); return { basis: m, upper: m.map((v) => v * (1 + p.pct / 100)), lower: m.map((v) => v * (1 - p.pct / 100)) }; },
  },
  {
    id: 'ichimoku', name: 'Ichimoku Cloud', short: 'Ichimoku', overlay: true, group: 'Trend',
    inputs: [{ id: 'conv', name: 'Conversion Line', type: 'int', def: 9 }, { id: 'base', name: 'Base Line', type: 'int', def: 26 }, { id: 'spanB', name: 'Leading Span B', type: 'int', def: 52 }, { id: 'disp', name: 'Displacement', type: 'int', def: 26 }],
    plots: [
      { id: 'conv', name: 'Conversion', color: '#2962FF' }, { id: 'base', name: 'Base', color: '#B71C1C' },
      { id: 'lag', name: 'Lagging Span', color: '#43A047', offsetInput: 'disp', offsetSign: -1 },
      { id: 'a', name: 'Lead 1', color: '#A5D6A7', offsetInput: 'disp', offsetSign: 1 }, { id: 'b', name: 'Lead 2', color: '#EF9A9A', offsetInput: 'disp', offsetSign: 1 },
    ],
    fills: [{ a: 'a', b: 'b', color: 'rgba(67,160,71,0.12)', colorDown: 'rgba(244,67,54,0.12)' }],
    calc: (S, p) => {
      const dl = (len) => { const h = ta.highest(S.high, len), l = ta.lowest(S.low, len); return h.map((v, i) => (v + l[i]) / 2); };
      const conv = dl(p.conv), base = dl(p.base);
      return { conv, base, lag: S.close.slice(), a: conv.map((v, i) => (v + base[i]) / 2), b: dl(p.spanB) };
    },
  },
  {
    id: 'psar', name: 'Parabolic SAR', short: 'SAR', overlay: true, group: 'Trend',
    inputs: [{ id: 'start', name: 'Start', type: 'float', def: 0.02, step: 0.01 }, { id: 'inc', name: 'Increment', type: 'float', def: 0.02, step: 0.01 }, { id: 'max', name: 'Max', type: 'float', def: 0.2, step: 0.01 }],
    plots: [{ id: 'sar', name: 'SAR', type: 'circles', color: '#2962FF' }],
    calc: (S, p) => {
      const { high: h, low: l } = S, n = h.length, out = arr(n);
      if (n < 2) return { sar: out };
      let up = true, af = p.start, ep = h[0], sar = l[0];
      for (let i = 1; i < n; i++) {
        sar = sar + af * (ep - sar);
        if (up) {
          sar = Math.min(sar, l[i - 1], i > 1 ? l[i - 2] : l[i - 1]);
          if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = p.start; }
          else if (h[i] > ep) { ep = h[i]; af = Math.min(af + p.inc, p.max); }
        } else {
          sar = Math.max(sar, h[i - 1], i > 1 ? h[i - 2] : h[i - 1]);
          if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = p.start; }
          else if (l[i] < ep) { ep = l[i]; af = Math.min(af + p.inc, p.max); }
        }
        out[i] = sar;
      }
      return { sar: out };
    },
  },
  {
    id: 'supertrend', name: 'Supertrend', short: 'Supertrend', overlay: true, group: 'Trend',
    inputs: [{ id: 'atrLen', name: 'ATR Length', type: 'int', def: 10 }, { id: 'factor', name: 'Factor', type: 'float', def: 3, step: 0.1 }],
    plots: [{ id: 'up', name: 'Up Trend', color: UP, width: 2 }, { id: 'dn', name: 'Down Trend', color: DN, width: 2 }],
    calc: (S, p) => {
      const { high: h, low: l, close: c } = S, n = c.length, a = ta.atr(h, l, c, p.atrLen);
      const up = arr(n), dn = arr(n); let fu = N, fl = N, dir = 1;
      for (let i = 0; i < n; i++) {
        if (isNaN(a[i])) continue;
        const m = (h[i] + l[i]) / 2; let bu = m + p.factor * a[i], bl = m - p.factor * a[i];
        bl = !isNaN(fl) && c[i - 1] > fl ? Math.max(bl, fl) : bl;
        bu = !isNaN(fu) && c[i - 1] < fu ? Math.min(bu, fu) : bu;
        if (!isNaN(fu)) { if (dir === -1 && c[i] > fu) dir = 1; else if (dir === 1 && c[i] < fl) dir = -1; }
        fu = bu; fl = bl;
        if (dir === 1) up[i] = bl; else dn[i] = bu;
      }
      return { up, dn };
    },
  },
  {
    id: 'vwap', name: 'VWAP', short: 'VWAP', overlay: true, group: 'Volume',
    inputs: [{ id: 'anchor', name: 'Anchor Period', type: 'select', def: 'Session', options: ['Session', 'Week', 'Month'] }, { id: 'bands', name: 'Show Bands', type: 'bool', def: false }],
    plots: [{ id: 'vwap', name: 'VWAP', color: '#2962FF', width: 2 }, { id: 'up', name: 'Upper Band', color: '#4CAF50' }, { id: 'dn', name: 'Lower Band', color: '#4CAF50' }],
    calc: (S, p) => {
      const n = S.close.length, out = arr(n), up = arr(n), dn = arr(n), tp = S.hlc3;
      let pv = 0, vv = 0, pv2 = 0, key = null;
      for (let i = 0; i < n; i++) {
        const d = new Date(S.time[i]);
        const k = p.anchor === 'Month' ? d.getUTCFullYear() * 12 + d.getUTCMonth() : p.anchor === 'Week' ? Math.floor((S.time[i] / 86400000 + 3) / 7) : Math.floor(S.time[i] / 86400000);
        if (k !== key) { pv = 0; vv = 0; pv2 = 0; key = k; }
        pv += tp[i] * S.volume[i]; vv += S.volume[i]; pv2 += tp[i] * tp[i] * S.volume[i];
        out[i] = vv ? pv / vv : tp[i];
        if (p.bands) { const sd = Math.sqrt(Math.max(0, pv2 / (vv || 1) - out[i] ** 2)); up[i] = out[i] + sd; dn[i] = out[i] - sd; }
      }
      return { vwap: out, up, dn };
    },
  },
  {
    id: 'zigzag', name: 'Zig Zag', short: 'ZigZag', overlay: true, group: 'Trend',
    inputs: [{ id: 'dev', name: 'Price Deviation %', type: 'float', def: 5, step: 0.5 }],
    plots: [{ id: 'zz', name: 'ZigZag', color: '#FF9800', width: 2, connectGaps: true }],
    calc: (S, p) => {
      const { high: h, low: l } = S, n = h.length, out = arr(n);
      if (!n) return { zz: out };
      let dir = 0, pi = 0, pv = (h[0] + l[0]) / 2;
      out[0] = pv;
      for (let i = 1; i < n; i++) {
        if (dir >= 0) {
          if (h[i] >= pv && dir === 1) { out[pi] = N; pi = i; pv = h[i]; out[i] = pv; }
          else if (l[i] <= pv * (1 - p.dev / 100)) { dir = -1; pi = i; pv = l[i]; out[i] = pv; }
          else if (dir === 0 && h[i] >= pv * (1 + p.dev / 100)) { dir = 1; pi = i; pv = h[i]; out[i] = pv; }
        } else {
          if (l[i] <= pv) { out[pi] = N; pi = i; pv = l[i]; out[i] = pv; }
          else if (h[i] >= pv * (1 + p.dev / 100)) { dir = 1; pi = i; pv = h[i]; out[i] = pv; }
        }
      }
      return { zz: out };
    },
  },
  {
    id: 'pivots', name: 'Pivot Points Standard', short: 'Pivots', overlay: true, group: 'Trend',
    inputs: [{ id: 'period', name: 'Pivots Timeframe', type: 'select', def: 'Day', options: ['Day', 'Week', 'Month'] }],
    plots: ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3'].map((k) => ({ id: k, name: k, color: k === 'P' ? '#FF9800' : k[0] === 'R' ? '#F23645' : '#089981', width: 1, breaks: true })),
    calc: (S, p) => {
      const n = S.close.length, out = { P: arr(n), R1: arr(n), S1: arr(n), R2: arr(n), S2: arr(n), R3: arr(n), S3: arr(n) };
      let key = null, ph = -Infinity, pl = Infinity, pc = N, cur = null;
      for (let i = 0; i < n; i++) {
        const d = new Date(S.time[i]);
        const k = p.period === 'Month' ? d.getUTCFullYear() * 12 + d.getUTCMonth() : p.period === 'Week' ? Math.floor((S.time[i] / 86400000 + 3) / 7) : Math.floor(S.time[i] / 86400000);
        if (k !== key) {
          if (key !== null) {
            const P = (ph + pl + pc) / 3;
            cur = { P, R1: 2 * P - pl, S1: 2 * P - ph, R2: P + (ph - pl), S2: P - (ph - pl), R3: ph + 2 * (P - pl), S3: pl - 2 * (ph - P) };
          }
          key = k; ph = -Infinity; pl = Infinity;
        }
        ph = Math.max(ph, S.high[i]); pl = Math.min(pl, S.low[i]); pc = S.close[i];
        if (cur) for (const kk in cur) out[kk][i] = cur[kk];
      }
      return out;
    },
  },
  {
    // Port of the Pine v6 "Unmitigated Candles" script: boxes every candle (2–500 bars back) whose
    // high–low range has not been touched by any later candle, ignoring the candle right after it.
    id: 'unmitigated', name: 'Unmitigated Candles', short: 'Unmitigated Candles', overlay: true, group: 'Price Action',
    inputs: [{ id: 'lookback', name: 'Lookback Period', type: 'int', def: 400, min: 10, max: 500 }],
    plots: [{ id: 'boxes', name: 'Box', type: 'boxes', color: '#00BCD4', width: 2, fillAlpha: 0.05 }],
    calc: (S, p) => {
      const { high: H, low: L } = S, n = H.length, last = n - 1;
      const maxBars = Math.min(p.lookback, last, 500);
      const boxes = [];
      for (let idx = 2; idx <= maxBars; idx++) {
        const j = last - idx, top = H[j], bot = L[j];
        let ok = true;
        for (let k = j + 2; k <= last; k++) if (L[k] <= top && H[k] >= bot) { ok = false; break; }
        if (ok) boxes.push({ i0: j, i1: j + 1, top, bottom: bot });
      }
      return { _boxes: boxes };
    },
  },
  {
    id: 'lrc', name: 'Linear Regression Curve', short: 'LinReg', overlay: true, group: 'Trend',
    inputs: [LEN(50), SRC],
    plots: [{ id: 'lr', name: 'LinReg', color: '#E040FB', width: 2 }],
    calc: (S, p) => ({ lr: ta.linreg(src(S, p.source), p.length) }),
  },
  // ---------------- Oscillators (separate panes) ----------------
  {
    id: 'rsi', name: 'Relative Strength Index', short: 'RSI', group: 'Momentum',
    inputs: [LEN(14), SRC, { id: 'maLen', name: 'MA Length', type: 'int', def: 14 }, { id: 'showMA', name: 'Show MA', type: 'bool', def: true }],
    plots: [{ id: 'rsi', name: 'RSI', color: '#7E57C2', width: 2 }, { id: 'ma', name: 'RSI-based MA', color: '#F7C600' }],
    levels: [{ v: 70, name: 'Upper' }, { v: 50, name: 'Middle', dash: [2, 3] }, { v: 30, name: 'Lower' }],
    bands: [{ from: 70, to: 30, color: 'rgba(126,87,194,0.08)' }],
    precision: 2,
    calc: (S, p) => { const r = ta.rsi(src(S, p.source), p.length); return { rsi: r, ma: p.showMA ? ta.sma(r, p.maLen) : arr(r.length) }; },
  },
  {
    id: 'macd', name: 'MACD', short: 'MACD', group: 'Momentum',
    inputs: [{ id: 'fast', name: 'Fast Length', type: 'int', def: 12 }, { id: 'slow', name: 'Slow Length', type: 'int', def: 26 }, { id: 'signal', name: 'Signal Smoothing', type: 'int', def: 9 }, SRC],
    plots: [{ id: 'hist', name: 'Histogram', type: 'histogram', color: '#26A69A' }, { id: 'macd', name: 'MACD', color: '#2962FF', width: 2 }, { id: 'signal', name: 'Signal', color: '#FF6D00', width: 2 }],
    levels: [{ v: 0, name: 'Zero', dash: [2, 3] }],
    calc: null, // defined below
  },
  {
    id: 'stoch', name: 'Stochastic', short: 'Stoch', group: 'Momentum',
    inputs: [{ id: 'k', name: '%K Length', type: 'int', def: 14 }, { id: 'ks', name: '%K Smoothing', type: 'int', def: 1 }, { id: 'd', name: '%D Smoothing', type: 'int', def: 3 }],
    plots: [{ id: 'k', name: '%K', color: '#2962FF', width: 2 }, { id: 'd', name: '%D', color: '#FF6D00' }],
    levels: [{ v: 80, name: 'Upper' }, { v: 50, name: 'Middle', dash: [2, 3] }, { v: 20, name: 'Lower' }],
    bands: [{ from: 80, to: 20, color: 'rgba(33,150,243,0.07)' }], precision: 2,
    calc: (S, p) => { const k = ta.sma(ta.stoch(S.close, S.high, S.low, p.k), p.ks); return { k, d: ta.sma(k, p.d) }; },
  },
  {
    id: 'stochrsi', name: 'Stochastic RSI', short: 'Stoch RSI', group: 'Momentum',
    inputs: [{ id: 'k', name: 'K', type: 'int', def: 3 }, { id: 'd', name: 'D', type: 'int', def: 3 }, { id: 'rsiLen', name: 'RSI Length', type: 'int', def: 14 }, { id: 'stLen', name: 'Stochastic Length', type: 'int', def: 14 }, SRC],
    plots: [{ id: 'k', name: 'K', color: '#2962FF', width: 2 }, { id: 'd', name: 'D', color: '#FF6D00' }],
    levels: [{ v: 80 }, { v: 50, dash: [2, 3] }, { v: 20 }], bands: [{ from: 80, to: 20, color: 'rgba(33,150,243,0.07)' }], precision: 2,
    calc: (S, p) => { const r = ta.rsi(src(S, p.source), p.rsiLen); const k = ta.sma(ta.stoch(r, r, r, p.stLen), p.k); return { k, d: ta.sma(k, p.d) }; },
  },
  {
    id: 'cci', name: 'Commodity Channel Index', short: 'CCI', group: 'Momentum',
    inputs: [LEN(20), { id: 'source', name: 'Source', type: 'source', def: 'hlc3' }],
    plots: [{ id: 'cci', name: 'CCI', color: '#2962FF', width: 2 }],
    levels: [{ v: 100 }, { v: 0, dash: [2, 3] }, { v: -100 }], bands: [{ from: 100, to: -100, color: 'rgba(33,150,243,0.07)' }], precision: 2,
    calc: (S, p) => {
      const s = src(S, p.source), m = ta.sma(s, p.length), n = s.length, out = arr(n);
      for (let i = p.length - 1; i < n; i++) { let d = 0; for (let j = 0; j < p.length; j++) d += Math.abs(s[i - j] - m[i]); d /= p.length; out[i] = d ? (s[i] - m[i]) / (0.015 * d) : 0; }
      return { cci: out };
    },
  },
  {
    id: 'atr', name: 'Average True Range', short: 'ATR', group: 'Volatility',
    inputs: [LEN(14), { id: 'smoothing', name: 'Smoothing', type: 'select', def: 'RMA', options: ['RMA', 'SMA', 'EMA', 'WMA'] }],
    plots: [{ id: 'atr', name: 'ATR', color: '#B71C1C', width: 2 }],
    calc: (S, p) => ({ atr: ta.ma(p.smoothing, ta.tr(S.high, S.low, S.close), p.length) }),
  },
  {
    id: 'adx', name: 'Directional Movement Index', short: 'DMI', group: 'Trend',
    inputs: [{ id: 'len', name: 'DI Length', type: 'int', def: 14 }, { id: 'adxLen', name: 'ADX Smoothing', type: 'int', def: 14 }],
    plots: [{ id: 'adx', name: 'ADX', color: '#F50057', width: 2 }, { id: 'plus', name: '+DI', color: '#2962FF' }, { id: 'minus', name: '-DI', color: '#FF6D00' }],
    precision: 2,
    calc: (S, p) => {
      const { high: h, low: l, close: c } = S, n = h.length;
      const pdm = arr(n, 0), mdm = arr(n, 0);
      for (let i = 1; i < n; i++) { const up = h[i] - h[i - 1], dn = l[i - 1] - l[i]; pdm[i] = up > dn && up > 0 ? up : 0; mdm[i] = dn > up && dn > 0 ? dn : 0; }
      const tr = ta.rma(ta.tr(h, l, c), p.len), pp = ta.rma(pdm, p.len), mm = ta.rma(mdm, p.len);
      const plus = pp.map((v, i) => (100 * v) / tr[i]), minus = mm.map((v, i) => (100 * v) / tr[i]);
      const dx = plus.map((v, i) => { const s = v + minus[i]; return s === 0 ? 0 : (100 * Math.abs(v - minus[i])) / s; });
      return { adx: ta.rma(dx, p.adxLen), plus, minus };
    },
  },
  {
    id: 'wpr', name: 'Williams %R', short: '%R', group: 'Momentum',
    inputs: [LEN(14)],
    plots: [{ id: 'r', name: '%R', color: '#7E57C2', width: 2 }],
    levels: [{ v: -20 }, { v: -50, dash: [2, 3] }, { v: -80 }], bands: [{ from: -20, to: -80, color: 'rgba(126,87,194,0.08)' }], precision: 2,
    calc: (S, p) => { const hh = ta.highest(S.high, p.length), ll = ta.lowest(S.low, p.length); return { r: S.close.map((c, i) => (hh[i] - ll[i] ? (-100 * (hh[i] - c)) / (hh[i] - ll[i]) : -50)) }; },
  },
  {
    id: 'mfi', name: 'Money Flow Index', short: 'MFI', group: 'Volume',
    inputs: [LEN(14)],
    plots: [{ id: 'mfi', name: 'MFI', color: '#7E57C2', width: 2 }],
    levels: [{ v: 80 }, { v: 50, dash: [2, 3] }, { v: 20 }], bands: [{ from: 80, to: 20, color: 'rgba(126,87,194,0.08)' }], precision: 2,
    calc: (S, p) => {
      const tp = S.hlc3, n = tp.length, out = arr(n);
      for (let i = p.length; i < n; i++) {
        let pos = 0, neg = 0;
        for (let j = 0; j < p.length; j++) { const k = i - j, mf = tp[k] * S.volume[k]; if (tp[k] > tp[k - 1]) pos += mf; else if (tp[k] < tp[k - 1]) neg += mf; }
        out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
      }
      return { mfi: out };
    },
  },
  {
    id: 'obv', name: 'On Balance Volume', short: 'OBV', group: 'Volume', format: 'volume',
    inputs: [],
    plots: [{ id: 'obv', name: 'OBV', color: '#2962FF', width: 2 }],
    calc: (S) => { const n = S.close.length, out = arr(n); let v = 0; for (let i = 0; i < n; i++) { if (i > 0) v += S.close[i] > S.close[i - 1] ? S.volume[i] : S.close[i] < S.close[i - 1] ? -S.volume[i] : 0; out[i] = v; } return { obv: out }; },
  },
  {
    id: 'ad', name: 'Accumulation/Distribution', short: 'A/D', group: 'Volume', format: 'volume',
    inputs: [],
    plots: [{ id: 'ad', name: 'A/D', color: '#999915', width: 2 }],
    calc: (S) => { const n = S.close.length, out = arr(n); let v = 0; for (let i = 0; i < n; i++) { const r = S.high[i] - S.low[i]; v += r ? ((2 * S.close[i] - S.low[i] - S.high[i]) / r) * S.volume[i] : 0; out[i] = v; } return { ad: out }; },
  },
  {
    id: 'cmf', name: 'Chaikin Money Flow', short: 'CMF', group: 'Volume',
    inputs: [LEN(20)],
    plots: [{ id: 'cmf', name: 'CMF', color: '#43A047', width: 2, type: 'area' }],
    levels: [{ v: 0, dash: [2, 3] }], precision: 3,
    calc: (S, p) => {
      const mfv = S.close.map((c, i) => { const r = S.high[i] - S.low[i]; return r ? ((2 * c - S.low[i] - S.high[i]) / r) * S.volume[i] : 0; });
      const a = ta.sma(mfv, p.length), b = ta.sma(S.volume, p.length);
      return { cmf: a.map((v, i) => (b[i] ? v / b[i] : 0)) };
    },
  },
  {
    id: 'mom', name: 'Momentum', short: 'Mom', group: 'Momentum',
    inputs: [LEN(10), SRC],
    plots: [{ id: 'mom', name: 'Momentum', color: '#2962FF', width: 2 }],
    levels: [{ v: 0, dash: [2, 3] }],
    calc: (S, p) => ({ mom: ta.change(src(S, p.source), p.length) }),
  },
  {
    id: 'roc', name: 'Rate Of Change', short: 'ROC', group: 'Momentum',
    inputs: [LEN(9), SRC],
    plots: [{ id: 'roc', name: 'ROC', color: '#2962FF', width: 2 }],
    levels: [{ v: 0, dash: [2, 3] }], precision: 2,
    calc: (S, p) => { const s = src(S, p.source); return { roc: s.map((v, i) => (i >= p.length ? (100 * (v - s[i - p.length])) / s[i - p.length] : N)) }; },
  },
  {
    id: 'ao', name: 'Awesome Oscillator', short: 'AO', group: 'Momentum',
    inputs: [],
    plots: [{ id: 'ao', name: 'AO', type: 'histogram', color: '#089981' }],
    levels: [{ v: 0, dash: [2, 3] }],
    calc: null, // defined below
  },
  {
    id: 'aroon', name: 'Aroon', short: 'Aroon', group: 'Trend',
    inputs: [LEN(14)],
    plots: [{ id: 'up', name: 'Aroon Up', color: '#FB8C00', width: 2 }, { id: 'dn', name: 'Aroon Down', color: '#2962FF', width: 2 }],
    precision: 2,
    calc: (S, p) => {
      const n = S.high.length, up = arr(n), dn = arr(n), L = p.length;
      for (let i = L; i < n; i++) {
        let hi = -Infinity, hiI = 0, lo = Infinity, loI = 0;
        for (let j = 0; j <= L; j++) { const k = i - j; if (S.high[k] > hi) { hi = S.high[k]; hiI = j; } if (S.low[k] < lo) { lo = S.low[k]; loI = j; } }
        up[i] = (100 * (L - hiI)) / L; dn[i] = (100 * (L - loI)) / L;
      }
      return { up, dn };
    },
  },
  {
    id: 'trix', name: 'TRIX', short: 'TRIX', group: 'Momentum',
    inputs: [LEN(18)],
    plots: [{ id: 'trix', name: 'TRIX', color: '#F44336', width: 2 }],
    levels: [{ v: 0, dash: [2, 3] }], precision: 4,
    calc: (S, p) => { const l = S.close.map(Math.log), e = ta.ema(ta.ema(ta.ema(l, p.length), p.length), p.length); return { trix: e.map((v, i) => (i ? 10000 * (v - e[i - 1]) : N)) }; },
  },
  {
    id: 'uo', name: 'Ultimate Oscillator', short: 'UO', group: 'Momentum',
    inputs: [{ id: 'a', name: 'Fast', type: 'int', def: 7 }, { id: 'b', name: 'Middle', type: 'int', def: 14 }, { id: 'c', name: 'Slow', type: 'int', def: 28 }],
    plots: [{ id: 'uo', name: 'UO', color: '#F44336', width: 2 }], precision: 2,
    calc: (S, p) => {
      const n = S.close.length, bp = arr(n), tr = arr(n);
      for (let i = 1; i < n; i++) { const lo = Math.min(S.low[i], S.close[i - 1]), hi = Math.max(S.high[i], S.close[i - 1]); bp[i] = S.close[i] - lo; tr[i] = hi - lo; }
      const avg = (L) => { const a = ta.sma(bp, L), b = ta.sma(tr, L); return a.map((v, i) => v / b[i]); };
      const A = avg(p.a), B = avg(p.b), Cc = avg(p.c);
      return { uo: A.map((v, i) => (100 * (4 * v + 2 * B[i] + Cc[i])) / 7) };
    },
  },
  {
    id: 'cmo', name: 'Chande Momentum Oscillator', short: 'ChandeMO', group: 'Momentum',
    inputs: [LEN(9), SRC],
    plots: [{ id: 'cmo', name: 'CMO', color: '#2962FF', width: 2 }], levels: [{ v: 0, dash: [2, 3] }], precision: 2,
    calc: (S, p) => {
      const ch = ta.change(src(S, p.source)), n = ch.length, out = arr(n);
      for (let i = p.length; i < n; i++) { let u = 0, d = 0; for (let j = 0; j < p.length; j++) { const v = ch[i - j]; if (v > 0) u += v; else d -= v; } out[i] = u + d ? (100 * (u - d)) / (u + d) : 0; }
      return { cmo: out };
    },
  },
  {
    id: 'dpo', name: 'Detrended Price Oscillator', short: 'DPO', group: 'Momentum',
    inputs: [LEN(21)],
    plots: [{ id: 'dpo', name: 'DPO', color: '#43A047', width: 2 }], levels: [{ v: 0, dash: [2, 3] }],
    calc: (S, p) => { const m = ta.sma(S.close, p.length), k = Math.floor(p.length / 2) + 1; return { dpo: S.close.map((c, i) => (i >= k ? c - m[i - k] : N)) }; },
  },
  {
    id: 'stdev', name: 'Standard Deviation', short: 'StdDev', group: 'Volatility',
    inputs: [LEN(20), SRC],
    plots: [{ id: 'sd', name: 'StdDev', color: '#2962FF', width: 2 }],
    calc: (S, p) => ({ sd: ta.stdev(src(S, p.source), p.length) }),
  },
  {
    id: 'hv', name: 'Historical Volatility', short: 'HV', group: 'Volatility',
    inputs: [LEN(10)],
    plots: [{ id: 'hv', name: 'HV', color: '#2962FF', width: 2 }], precision: 2,
    calc: (S, p) => { const r = S.close.map((c, i) => (i ? Math.log(c / S.close[i - 1]) : N)); return { hv: ta.stdev(r, p.length).map((v) => v * 100 * Math.sqrt(365)) }; },
  },
  {
    id: 'bbw', name: 'Bollinger Bands Width', short: 'BBW', group: 'Volatility',
    inputs: [LEN(20), { id: 'mult', name: 'StdDev', type: 'float', def: 2, step: 0.1 }],
    plots: [{ id: 'w', name: 'BBW', color: '#2962FF', width: 2 }], precision: 4,
    calc: (S, p) => { const m = ta.sma(S.close, p.length), d = ta.stdev(S.close, p.length); return { w: m.map((v, i) => (2 * p.mult * d[i]) / v) }; },
  },
  {
    id: 'bbpb', name: 'Bollinger Bands %B', short: '%B', group: 'Volatility',
    inputs: [LEN(20), { id: 'mult', name: 'StdDev', type: 'float', def: 2, step: 0.1 }],
    plots: [{ id: 'b', name: '%B', color: '#26A69A', width: 2 }], levels: [{ v: 1 }, { v: 0.5, dash: [2, 3] }, { v: 0 }], bands: [{ from: 1, to: 0, color: 'rgba(38,166,154,0.07)' }], precision: 3,
    calc: (S, p) => { const m = ta.sma(S.close, p.length), d = ta.stdev(S.close, p.length); return { b: S.close.map((c, i) => (c - (m[i] - p.mult * d[i])) / (2 * p.mult * d[i])) }; },
  },
  {
    id: 'efi', name: "Elder's Force Index", short: 'EFI', group: 'Volume', format: 'volume',
    inputs: [LEN(13)],
    plots: [{ id: 'efi', name: 'EFI', color: '#F44336', width: 2 }], levels: [{ v: 0, dash: [2, 3] }],
    calc: (S, p) => ({ efi: ta.ema(S.close.map((c, i) => (i ? (c - S.close[i - 1]) * S.volume[i] : N)), p.length) }),
  },
  {
    id: 'kst', name: 'Know Sure Thing', short: 'KST', group: 'Momentum',
    inputs: [{ id: 'sig', name: 'Signal Length', type: 'int', def: 9 }],
    plots: [{ id: 'kst', name: 'KST', color: '#089981', width: 2 }, { id: 'sig', name: 'Signal', color: '#F23645' }], levels: [{ v: 0, dash: [2, 3] }], precision: 3,
    calc: (S, p) => {
      const roc = (L) => S.close.map((c, i) => (i >= L ? (100 * (c - S.close[i - L])) / S.close[i - L] : N));
      const a = ta.sma(roc(10), 10), b = ta.sma(roc(15), 10), c = ta.sma(roc(20), 10), d = ta.sma(roc(30), 15);
      const k = a.map((v, i) => v + 2 * b[i] + 3 * c[i] + 4 * d[i]);
      return { kst: k, sig: ta.sma(k, p.sig) };
    },
  },
  {
    id: 'volosc', name: 'Volume Oscillator', short: 'Vol Osc', group: 'Volume',
    inputs: [{ id: 'short', name: 'Short Length', type: 'int', def: 5 }, { id: 'long', name: 'Long Length', type: 'int', def: 10 }],
    plots: [{ id: 'vo', name: 'Vol Osc', color: '#2962FF', width: 2 }], levels: [{ v: 0, dash: [2, 3] }], precision: 2,
    calc: (S, p) => { const a = ta.ema(S.volume, p.short), b = ta.ema(S.volume, p.long); return { vo: a.map((v, i) => (100 * (v - b[i])) / b[i]) }; },
  },
];

// Indicators with per-bar colouring
INDICATORS.find((d) => d.id === 'macd').calc = (S, p) => {
  const s = src(S, p.source), f = ta.ema(s, p.fast), sl = ta.ema(s, p.slow);
  const macd = f.map((v, i) => v - sl[i]), sig = ta.ema(macd, p.signal), hist = macd.map((v, i) => v - sig[i]);
  const colors = hist.map((v, i) => (v >= 0 ? (i && v < hist[i - 1] ? '#B2DFDB' : '#26A69A') : (i && v > hist[i - 1] ? '#FFCDD2' : '#FF5252')));
  return { hist, macd, signal: sig, _colors: { hist: colors } };
};
INDICATORS.find((d) => d.id === 'ao').calc = (S) => {
  const m = S.hl2, a = ta.sma(m, 5), b = ta.sma(m, 34), ao = a.map((v, i) => v - b[i]);
  return { ao, _colors: { ao: ao.map((v, i) => (i && v >= ao[i - 1] ? '#089981' : '#F23645')) } };
};

export const indicatorById = (id) => INDICATORS.find((d) => d.id === id);

export function defaultInputs(def) {
  const o = {};
  for (const i of def.inputs) o[i.id] = i.def;
  return o;
}

/* ------------------------- Built-in strategies ------------------------- */
export const STRATEGIES = [
  {
    id: 'macross', name: 'Moving Average Crossover',
    inputs: [{ id: 'fast', name: 'Fast MA', type: 'int', def: 9 }, { id: 'slow', name: 'Slow MA', type: 'int', def: 21 }, { ...MAT, def: 'EMA' }],
    signals(S, p) {
      const f = ta.ma(p.maType, S.close, p.fast, S.volume), s = ta.ma(p.maType, S.close, p.slow, S.volume);
      return S.close.map((_, i) => (i && ta.cross(f, s, i) ? 1 : i && ta.crossunder(f, s, i) ? -1 : 0));
    },
  },
  {
    id: 'rsi', name: 'RSI Strategy',
    inputs: [{ id: 'len', name: 'RSI Length', type: 'int', def: 14 }, { id: 'os', name: 'Oversold', type: 'int', def: 30 }, { id: 'ob', name: 'Overbought', type: 'int', def: 70 }],
    signals(S, p) {
      const r = ta.rsi(S.close, p.len), os = r.map(() => p.os), ob = r.map(() => p.ob);
      return r.map((_, i) => (i && ta.cross(r, os, i) ? 1 : i && ta.crossunder(r, ob, i) ? -1 : 0));
    },
  },
  {
    id: 'macd', name: 'MACD Strategy',
    inputs: [{ id: 'fast', name: 'Fast', type: 'int', def: 12 }, { id: 'slow', name: 'Slow', type: 'int', def: 26 }, { id: 'sig', name: 'Signal', type: 'int', def: 9 }],
    signals(S, p) {
      const m = ta.ema(S.close, p.fast), sl = ta.ema(S.close, p.slow), macd = m.map((v, i) => v - sl[i]), sig = ta.ema(macd, p.sig);
      return macd.map((_, i) => (i && ta.cross(macd, sig, i) ? 1 : i && ta.crossunder(macd, sig, i) ? -1 : 0));
    },
  },
  {
    id: 'bb', name: 'Bollinger Bands Mean Reversion',
    inputs: [{ id: 'len', name: 'Length', type: 'int', def: 20 }, { id: 'mult', name: 'StdDev', type: 'float', def: 2 }],
    signals(S, p) {
      const m = ta.sma(S.close, p.len), d = ta.stdev(S.close, p.len);
      const lo = m.map((v, i) => v - p.mult * d[i]), up = m.map((v, i) => v + p.mult * d[i]);
      return S.close.map((_, i) => (i && ta.cross(S.close, lo, i) ? 1 : i && ta.crossunder(S.close, up, i) ? -1 : 0));
    },
  },
  {
    id: 'supertrend', name: 'Supertrend Strategy',
    inputs: [{ id: 'atrLen', name: 'ATR Length', type: 'int', def: 10 }, { id: 'factor', name: 'Factor', type: 'float', def: 3 }],
    signals(S, p) {
      const r = indicatorById('supertrend').calc(S, p);
      return S.close.map((_, i) => (i && !isNaN(r.up[i]) && isNaN(r.up[i - 1]) ? 1 : i && !isNaN(r.dn[i]) && isNaN(r.dn[i - 1]) ? -1 : 0));
    },
  },
  {
    id: 'breakout', name: 'Donchian Channel Breakout',
    inputs: [{ id: 'len', name: 'Channel Length', type: 'int', def: 20 }],
    signals(S, p) {
      const u = ta.highest(S.high, p.len), l = ta.lowest(S.low, p.len);
      return S.close.map((c, i) => (i && c > u[i - 1] ? 1 : i && c < l[i - 1] ? -1 : 0));
    },
  },
];

export function backtest(bars, strat, params, opts = {}) {
  const S = sources(bars);
  const sig = strat.signals(S, params);
  const capital = opts.capital ?? 10000, qtyPct = (opts.qtyPct ?? 100) / 100, comm = (opts.commission ?? 0.05) / 100;
  const allowShort = opts.short ?? true;
  let equity = capital, pos = 0, entry = 0, entryI = 0, qty = 0, peak = capital, maxDD = 0;
  const trades = [], curve = [], markers = [];
  const close = (i, price, reason) => {
    const pnl = (price - entry) * qty * pos - comm * (entry + price) * qty;
    equity += pnl;
    trades.push({ dir: pos, entryT: bars[entryI].t, entryP: entry, exitT: bars[i].t, exitP: price, qty, pnl, pct: ((price / entry - 1) * 100 * pos), bars: i - entryI, reason });
    markers.push({ t: bars[i].t, pos: pos > 0 ? 'above' : 'below', shape: pos > 0 ? 'arrowDown' : 'arrowUp', color: '#E040FB', text: pos > 0 ? 'Close L' : 'Close S' });
    pos = 0;
  };
  for (let i = 1; i < bars.length; i++) {
    const s = sig[i - 1];
    const px = bars[i].o;
    if (s === 1 && pos <= 0) {
      if (pos < 0) close(i, px, 'Signal');
      pos = 1; entry = px; entryI = i; qty = (equity * qtyPct) / px;
      markers.push({ t: bars[i].t, pos: 'below', shape: 'arrowUp', color: '#2962FF', text: 'Long' });
    } else if (s === -1 && pos >= 0) {
      if (pos > 0) close(i, px, 'Signal');
      if (allowShort) { pos = -1; entry = px; entryI = i; qty = (equity * qtyPct) / px; markers.push({ t: bars[i].t, pos: 'above', shape: 'arrowDown', color: '#F23645', text: 'Short' }); }
    }
    const open = pos ? (bars[i].c - entry) * qty * pos : 0;
    const eq = equity + open;
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq);
    curve.push({ t: bars[i].t, eq });
  }
  if (pos) close(bars.length - 1, bars[bars.length - 1].c, 'End');
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  const bh = bars.length ? (bars[bars.length - 1].c / bars[0].c - 1) * capital : 0;
  return {
    trades, curve, markers,
    stats: {
      net: equity - capital, netPct: ((equity - capital) / capital) * 100, total: trades.length, wins: wins.length, losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0, pf: gl ? gp / gl : gp ? Infinity : 0, maxDD, maxDDPct: (maxDD / peak) * 100,
      avg: trades.length ? (equity - capital) / trades.length : 0, grossProfit: gp, grossLoss: gl, buyHold: bh,
      avgBars: trades.length ? trades.reduce((a, t) => a + t.bars, 0) / trades.length : 0,
    },
  };
}

// Technical rating like popular platforms: votes from MAs and oscillators
export function technicalRating(bars) {
  if (bars.length < 60) return { score: 0, label: 'Neutral', ma: 0, osc: 0 };
  const S = sources(bars), c = S.close, i = c.length - 1, px = c[i];
  let maV = 0, maN = 0;
  for (const L of [10, 20, 30, 50, 100, 200]) {
    for (const f of [ta.sma, ta.ema]) { const m = f(c, L)[i]; if (!isNaN(m)) { maV += px > m ? 1 : px < m ? -1 : 0; maN++; } }
  }
  let oV = 0, oN = 0;
  const r = ta.rsi(c, 14); if (!isNaN(r[i])) { oV += r[i] < 30 && r[i] > r[i - 1] ? 1 : r[i] > 70 && r[i] < r[i - 1] ? -1 : 0; oN++; }
  const k = ta.sma(ta.stoch(c, S.high, S.low, 14), 3), d = ta.sma(k, 3);
  if (!isNaN(k[i])) { oV += k[i] < 20 && k[i] > d[i] ? 1 : k[i] > 80 && k[i] < d[i] ? -1 : 0; oN++; }
  const m1 = ta.ema(c, 12), m2 = ta.ema(c, 26), macd = m1.map((v, j) => v - m2[j]), sg = ta.ema(macd, 9);
  oV += macd[i] > sg[i] ? 1 : -1; oN++;
  const mom = ta.change(c, 10); oV += mom[i] > mom[i - 1] ? 1 : -1; oN++;
  const ma = maN ? maV / maN : 0, osc = oN ? oV / oN : 0, score = (ma + osc) / 2;
  const label = score > 0.5 ? 'Strong Buy' : score > 0.1 ? 'Buy' : score < -0.5 ? 'Strong Sell' : score < -0.1 ? 'Sell' : 'Neutral';
  return { score, label, ma, osc, rsi: r[i] };
}
