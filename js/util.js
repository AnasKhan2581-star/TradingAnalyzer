// Shared helpers
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}

export class Emitter {
  constructor() { this._ev = {}; }
  on(n, f) { (this._ev[n] ||= []).push(f); return () => this.off(n, f); }
  off(n, f) { const a = this._ev[n]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
  emit(n, ...a) { const l = this._ev[n]; if (l) for (const f of l.slice()) f(...a); }
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function niceStep(raw) {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * p;
}

export function decimalsOf(step) {
  if (step >= 1) return 0;
  return Math.min(10, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

export function precisionFor(price) {
  const a = Math.abs(price);
  if (!isFinite(a) || a === 0) return 2;
  if (a >= 1000) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 4;
  if (a >= 0.1) return 4;
  if (a >= 0.01) return 5;
  if (a >= 0.001) return 6;
  if (a >= 0.0001) return 7;
  return 8;
}

export function fmtPrice(v, prec = 2) {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: prec, maximumFractionDigits: prec });
}

export function fmtNum(v, prec = 2) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(prec);
}

export const fmtVol = (v) => fmtNum(v, v != null && Math.abs(v) < 10 ? 2 : 0);

export function fmtPct(v, d = 2) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(d) + '%';
}

export function fmtSigned(v, prec = 2) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + fmtPrice(Math.abs(v), prec);
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const store = {
  get(k, def) {
    try { const v = localStorage.getItem('ta.' + k); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) { try { localStorage.setItem('ta.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem('ta.' + k); } catch { /* ignore */ } },
};

export function debounce(f, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); };
}

export const MIN = 60000, HOUR = 3600000, DAY = 86400000, WEEK = 7 * DAY;

export const INTERVALS = [
  { id: '1m', label: '1 minute', short: '1m', ms: MIN, group: 'Minutes' },
  { id: '3m', label: '3 minutes', short: '3m', ms: 3 * MIN, group: 'Minutes' },
  { id: '5m', label: '5 minutes', short: '5m', ms: 5 * MIN, group: 'Minutes' },
  { id: '15m', label: '15 minutes', short: '15m', ms: 15 * MIN, group: 'Minutes' },
  { id: '30m', label: '30 minutes', short: '30m', ms: 30 * MIN, group: 'Minutes' },
  { id: '1h', label: '1 hour', short: '1h', ms: HOUR, group: 'Hours' },
  { id: '2h', label: '2 hours', short: '2h', ms: 2 * HOUR, group: 'Hours' },
  { id: '4h', label: '4 hours', short: '4h', ms: 4 * HOUR, group: 'Hours' },
  { id: '6h', label: '6 hours', short: '6h', ms: 6 * HOUR, group: 'Hours' },
  { id: '12h', label: '12 hours', short: '12h', ms: 12 * HOUR, group: 'Hours' },
  { id: '1d', label: '1 day', short: 'D', ms: DAY, group: 'Days' },
  { id: '3d', label: '3 days', short: '3D', ms: 3 * DAY, group: 'Days' },
  { id: '1w', label: '1 week', short: 'W', ms: WEEK, group: 'Weeks' },
  { id: '1M', label: '1 month', short: 'M', ms: 30 * DAY, group: 'Months' },
];
export const intervalById = (id) => INTERVALS.find((i) => i.id === id) || INTERVALS[5];

// Align a timestamp to the start of its bar (UTC based, like most exchanges)
export function alignTime(t, iv) {
  if (iv.id === '1M') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  if (iv.id === '1w') { const d = Math.floor(t / DAY) * DAY; const dow = (new Date(d).getUTCDay() + 6) % 7; return d - dow * DAY; }
  return Math.floor(t / iv.ms) * iv.ms;
}
export function nextTime(t, iv) {
  if (iv.id === '1M') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  return t + iv.ms;
}
export function prevTime(t, iv) {
  if (iv.id === '1M') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1); }
  return t - iv.ms;
}

// Timezone handling: returns offset (ms) to add to UTC time to get wall-clock time.
export class TimeZone {
  constructor(name = 'local') { this.set(name); }
  set(name) {
    this.name = name;
    this.cache = new Map();
    this.fmt = null;
    if (name !== 'UTC' && name !== 'local') {
      try {
        this.fmt = new Intl.DateTimeFormat('en-US', { timeZone: name, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      } catch { this.name = 'local'; }
    }
  }
  offset(t) {
    if (this.name === 'UTC') return 0;
    if (this.name === 'local') return -new Date(t).getTimezoneOffset() * 60000;
    const k = Math.floor(t / 1800000);
    let o = this.cache.get(k);
    if (o === undefined) {
      const p = {};
      for (const x of this.fmt.formatToParts(new Date(k * 1800000))) p[x.type] = +x.value;
      o = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - k * 1800000;
      this.cache.set(k, o);
    }
    return o;
  }
  shift(t) { return new Date(t + this.offset(t)); }
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const pad2 = (n) => (n < 10 ? '0' : '') + n;

export function fmtDateTime(t, tz, withTime = true) {
  const d = tz.shift(t);
  let s = `${DOW[d.getUTCDay()]} ${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
  if (withTime) s += ` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return s;
}

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${pad2(h)}h`;
  if (h > 0) return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
  return `${pad2(m)}:${pad2(sec)}`;
}

export function download(name, url) {
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
}

export function hexToRgba(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function isTouch() { return matchMedia('(pointer: coarse)').matches; }
export const isMobile = () => window.innerWidth <= 768;

let audioCtx;
export function beep(freq = 880, dur = 0.15) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.15, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
  } catch { /* ignore */ }
}

export const TIMEZONES = ['local', 'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney'];
export function condLabel(c) { return { crossing: 'Crossing', crossing_up: 'Crossing Up', crossing_down: 'Crossing Down', greater: 'Greater Than', less: 'Less Than' }[c] || c; }
