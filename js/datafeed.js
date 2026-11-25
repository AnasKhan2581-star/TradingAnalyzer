import { Emitter, intervalById, alignTime, nextTime, prevTime, hashStr, mulberry32, gauss, DAY } from './util.js';
import { SYMBOLS, symbolPrecision } from './symbols.js';

const REST = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api3.binance.com'];
const WSS = ['wss://data-stream.binance.vision/ws', 'wss://stream.binance.com:9443/ws', 'wss://stream.binance.com:443/ws'];
const YEAR = 365 * DAY;

/* ------------------------------ Binance ------------------------------ */
class Binance {
  constructor(hub) {
    this.hub = hub; this.base = null; this.ws = null; this.wsIdx = 0; this.streams = new Map(); // stream -> Set(cb)
    this.reqId = 1; this.wsOk = false; this.failed = false; this.pollTimer = null;
  }
  async json(path) {
    const bases = this.base ? [this.base, ...REST.filter((b) => b !== this.base)] : REST;
    let lastErr;
    for (const b of bases) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
        const r = await fetch(b + path, { signal: ctl.signal }); clearTimeout(to);
        if (r.ok) { this.base = b; return await r.json(); }
        lastErr = new Error('HTTP ' + r.status);
        if (r.status === 400) throw lastErr;
      } catch (e) { lastErr = e; if (e.message === 'HTTP 400') break; }
    }
    throw lastErr || new Error('Binance unreachable');
  }
  async klines(sym, ivId, endTime, limit = 1000) {
    const q = `/api/v3/klines?symbol=${sym}&interval=${ivId}&limit=${limit}${endTime ? '&endTime=' + (endTime - 1) : ''}`;
    const d = await this.json(q);
    return d.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  }
  async tickers(list) {
    const q = '/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(list));
    return this.json(q);
  }
  // --- websocket multiplexing ---
  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const url = WSS[this.wsIdx % WSS.length];
    let opened = false;
    try { this.ws = new WebSocket(url); } catch { this.startPolling(); return; }
    const ws = this.ws;
    ws.onopen = () => {
      opened = true; this.wsOk = true; this.stopPolling();
      const params = [...this.streams.keys()];
      for (let i = 0; i < params.length; i += 100) ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: params.slice(i, i + 100), id: this.reqId++ }));
      this.hub.emit('status', { live: true });
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (Array.isArray(m)) { const set = this.streams.get('!miniTicker@arr'); if (set) for (const f of set) f(m); return; }
      if (m.e === 'kline') {
        const set = this.streams.get(`${m.s.toLowerCase()}@kline_${m.k.i}`);
        if (set) { const k = m.k; const bar = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }; for (const f of set) f(bar); }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.wsOk = false; this.ws = null;
      if (!opened) this.wsIdx++;
      if (this.streams.size) { this.startPolling(); setTimeout(() => this.connect(), opened ? 1500 : 4000); }
    };
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
  }
  sub(stream, cb) {
    let set = this.streams.get(stream);
    if (!set) {
      set = new Set(); this.streams.set(stream, set);
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [stream], id: this.reqId++ }));
    }
    set.add(cb);
    this.connect();
    return () => {
      set.delete(cb);
      if (!set.size) {
        this.streams.delete(stream);
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [stream], id: this.reqId++ }));
      }
    };
  }
  // REST polling fallback while the websocket is down
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      for (const [stream, set] of this.streams) {
        if (!set.size) continue;
        try {
          if (stream === '!miniTicker@arr') {
            const list = SYMBOLS.filter((s) => s.feed === 'binance').map((s) => s.symbol);
            const d = await this.tickers(list);
            const arr = d.map((x) => ({ s: x.symbol, c: x.lastPrice, o: x.openPrice, h: x.highPrice, l: x.lowPrice, v: x.volume, q: x.quoteVolume }));
            for (const f of set) f(arr);
          } else {
            const [sym, rest] = stream.split('@kline_');
            const k = await this.klines(sym.toUpperCase(), rest, null, 2);
            for (const b of k) for (const f of set) f(b);
          }
        } catch { /* ignore */ }
      }
    }, 4000);
  }
  stopPolling() { clearInterval(this.pollTimer); this.pollTimer = null; }
}

/* ------------------------------ Simulator ------------------------------ */
const isWeekend = (t) => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };

class SimMarket {
  constructor(hub) {
    this.hub = hub; this.state = new Map(); this.cache = new Map(); this.subs = new Map();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  closesWeekend(sym) { return sym.type !== 'crypto'; }
  isOpen(sym, t = Date.now()) { return !(this.closesWeekend(sym) && isWeekend(t)); }
  baseVol(sym) {
    switch (sym.type) {
      case 'stock': return 2.5e9 / Math.max(5, sym.price);
      case 'index': return 2e9;
      case 'forex': return 2.5e5;
      case 'bond': return 1e5;
      case 'futures': return 4e5;
      default: return 2e9 / Math.max(1e-9, sym.price);
    }
  }
  st(sym) {
    let s = this.state.get(sym.id);
    if (s) return s;
    const today = Math.floor(Date.now() / DAY);
    const r0 = mulberry32(hashStr(sym.id + ':anchor:' + today));
    const price = sym.price * Math.exp(gauss(r0) * sym.vol * 0.06);
    s = { sym, price, rnd: mulberry32(hashStr(sym.id + ':live:' + Date.now())), daily: null, prec: symbolPrecision(sym, sym.price) };
    this.state.set(sym.id, s);
    s.daily = this.generate(sym, intervalById('1d'), price, Date.now(), 1500, 'd');
    this.cache.set(sym.id + '|1d', s.daily);
    const d = s.daily, n = d.length;
    s.prev = n > 1 ? d[n - 2].c : d[n - 1].o;
    return s;
  }
  // Generate `count` bars ending at the bar containing `endT`, last close = lastClose (walk backwards)
  generate(sym, iv, lastClose, endT, count, salt) {
    const rnd = mulberry32(hashStr(`${sym.id}|${iv.id}|${salt}|${alignTime(endT, iv)}`));
    const sigBar = sym.vol * Math.sqrt(Math.min(iv.ms, 30 * DAY) / YEAR) * (this.closesWeekend(sym) && iv.ms < DAY ? 1.25 : 1);
    const bv = this.baseVol(sym) * Math.min(iv.ms, 30 * DAY) / DAY;
    const out = new Array(count);
    let t = alignTime(endT, iv);
    const skip = this.closesWeekend(sym) && iv.ms <= DAY;
    let c = lastClose, drift = 0, vreg = 0;
    for (let i = count - 1; i >= 0; i--) {
      while (skip && isWeekend(t)) t = prevTime(t, iv);
      drift = drift * 0.985 + gauss(rnd) * 0.02;
      vreg = vreg * 0.97 + gauss(rnd) * 0.08;
      const sig = sigBar * Math.exp(vreg);
      const r = gauss(rnd) * sig + drift * sig * 0.6;
      const o = c / Math.exp(r);
      const hi = Math.max(o, c) * Math.exp(Math.abs(gauss(rnd)) * sig * 0.45);
      const lo = Math.min(o, c) * Math.exp(-Math.abs(gauss(rnd)) * sig * 0.45);
      const v = bv * Math.exp(gauss(rnd) * 0.35) * (1 + Math.min(3, Math.abs(r) / (sig || 1)) * 0.4);
      out[i] = { t, o, h: hi, l: lo, c, v };
      c = o * Math.exp(gauss(rnd) * sig * 0.05);
      t = prevTime(t, iv);
    }
    return out;
  }
  getBars(sym, ivId, endTime) {
    const iv = intervalById(ivId);
    const s = this.st(sym);
    const key = sym.id + '|' + ivId;
    if (!endTime) {
      let c = this.cache.get(key);
      if (!c) {
        const n = iv.id === '1M' ? 240 : iv.id === '1w' ? 800 : 1500;
        c = this.generate(sym, iv, s.price, Date.now(), n, 'h');
        this.cache.set(key, c);
      }
      return c.slice();
    }
    const first = endTime;
    const limit = iv.ms >= 7 * DAY ? 0 : 1000;
    if (!limit) return [];
    const cache = this.cache.get(key);
    const firstBar = cache && cache.find((b) => b.t === first);
    const anchor = firstBar ? firstBar.o : s.price;
    let et = prevTime(first, iv);
    const older = this.generate(sym, iv, anchor, et, limit, 'p' + first);
    if (cache && cache[0] && cache[0].t === first) cache.unshift(...older);
    return older;
  }
  tick() {
    const now = Date.now();
    for (const s of this.state.values()) {
      if (!this.isOpen(s.sym, now)) continue;
      const sig = s.sym.vol * Math.sqrt(1 / (252 * 6.5 * 3600)) * 1.6;
      const r = gauss(s.rnd) * sig;
      s.price *= Math.exp(r);
      const vol = this.baseVol(s.sym) / 23400 * Math.exp(gauss(s.rnd) * 0.6);
      for (const [key, c] of this.cache) {
        if (!key.startsWith(s.sym.id + '|')) continue;
        const iv = intervalById(key.split('|')[1]);
        this.updateSeries(c, iv, s.price, vol, now);
      }
      this.hub.setQuote(s.sym.id, this.quoteOf(s));
    }
    for (const sub of this.subs.values()) {
      const c = this.cache.get(sub.key);
      if (c && c.length) { const b = { ...c[c.length - 1] }; for (const f of sub.cbs) f(b); }
    }
  }
  updateSeries(c, iv, price, vol, now) {
    const t = alignTime(now, iv);
    const last = c[c.length - 1];
    if (!last) return;
    if (t > last.t) c.push({ t, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: vol });
    else { last.c = price; if (price > last.h) last.h = price; if (price < last.l) last.l = price; last.v += vol; }
    if (c.length > 6000) c.splice(0, c.length - 6000);
  }
  quoteOf(s) {
    const d = s.daily[s.daily.length - 1];
    return { last: s.price, prev: s.prev, chg: s.price - s.prev, chgPct: (s.price / s.prev - 1) * 100, open: d.o, high: d.h, low: d.l, vol: d.v, time: Date.now(), live: false, open_: this.isOpen(s.sym) };
  }
  subscribe(sym, ivId, cb) {
    this.st(sym);
    const key = sym.id + '|' + ivId;
    let sub = this.subs.get(key);
    if (!sub) { sub = { key, cbs: new Set() }; this.subs.set(key, sub); }
    sub.cbs.add(cb);
    return () => { sub.cbs.delete(cb); if (!sub.cbs.size) this.subs.delete(key); };
  }
}

/* ------------------------------ Hub ------------------------------ */
export class DataHub extends Emitter {
  constructor() {
    super();
    this.binance = new Binance(this);
    this.sim = new SimMarket(this);
    this.quotes = new Map();
    this.binanceDown = false;
    this.tickerStarted = false;
  }
  isLive(sym) { return sym.feed === 'binance' && !this.binanceDown; }
  async getBars(sym, ivId, endTime) {
    if (this.isLive(sym)) {
      try {
        return await this.binance.klines(sym.symbol, ivId, endTime);
      } catch (e) {
        console.warn('Binance unavailable, falling back to simulator', e);
        this.binanceDown = true;
        this.emit('status', { live: false });
      }
    }
    return this.sim.getBars(sym, ivId, endTime);
  }
  subscribeBars(sym, ivId, cb) {
    if (this.isLive(sym)) {
      return this.binance.sub(`${sym.symbol.toLowerCase()}@kline_${ivId}`, (bar) => {
        cb(bar);
        const q = this.quotes.get(sym.id);
        if (q) { q.last = bar.c; q.chg = q.last - q.prev; q.chgPct = (q.last / q.prev - 1) * 100; this.emit('quote', sym.id, q); }
      });
    }
    return this.sim.subscribe(sym, ivId, cb);
  }
  setQuote(id, q) { this.quotes.set(id, q); this.emit('quote', id, q); }
  quote(id) { return this.quotes.get(id); }
  // Start streaming quotes for all symbols (watchlist, alerts, screener, paper trading)
  async startQuotes() {
    if (this.tickerStarted) return; this.tickerStarted = true;
    for (const s of SYMBOLS) if (s.feed !== 'binance') this.sim.st(s);
    this.sim.tick();
    const crypto = SYMBOLS.filter((s) => s.feed === 'binance');
    const bySym = new Map(crypto.map((s) => [s.symbol, s]));
    const apply = (arr) => {
      for (const x of arr) {
        const s = bySym.get(x.s); if (!s) continue;
        const last = +x.c, open = +x.o;
        this.setQuote(s.id, { last, prev: open, chg: last - open, chgPct: open ? (last / open - 1) * 100 : 0, open, high: +x.h, low: +x.l, vol: +x.v, qvol: +x.q, time: Date.now(), live: true, open_: true });
      }
    };
    try {
      const d = await this.binance.tickers(crypto.map((s) => s.symbol));
      apply(d.map((x) => ({ s: x.symbol, c: x.lastPrice, o: x.openPrice, h: x.highPrice, l: x.lowPrice, v: x.volume, q: x.quoteVolume })));
      this.binance.sub('!miniTicker@arr', apply);
      this.emit('status', { live: true });
    } catch (e) {
      console.warn('Binance tickers unavailable; crypto switched to simulator', e);
      this.binanceDown = true;
      for (const s of crypto) this.sim.st(s);
      this.emit('status', { live: false });
    }
  }
}

export const hub = new DataHub();
