// Bottom panel: Stock Screener, Script Editor, Strategy Tester, Trading Panel (paper trading)
import { el, $, $$, store, fmtPrice, fmtPct, fmtVol, fmtSigned, fmtNum, uid, hashStr, fmtDateTime, TimeZone, isMobile, beep } from './util.js';
import { SYMBOLS, findSymbol, symbolPrecision, SYMBOL_COLORS, TYPES, symbolLogo } from './symbols.js';
import { hub } from './datafeed.js';
import { ta, sources, STRATEGIES, backtest, technicalRating, defaultInputs, INDICATORS } from './indicators.js';
import { I } from './icons.js';
import { dialog, toast, selectEl, numberEl, switchEl, formRow, confirmDlg, menu } from './ui.js';

const TABS = [
  { id: 'screener', label: 'Stock Screener', icon: 'screener' },
  { id: 'editor', label: 'Script Editor', icon: 'code' },
  { id: 'strategy', label: 'Strategy Tester', icon: 'strategy' },
  { id: 'trading', label: 'Trading Panel', icon: 'trade' },
];

export class Bottom {
  constructor(app) {
    this.app = app;
    this.cur = null;
    this.height = store.get('bpHeight', 300);
    this.trading = new Trading(app, this);
    this.editor = new ScriptEditor(app, this);
    this.strategy = new StrategyTester(app, this);
    this.screener = new Screener(app, this);
    const tabs = $('#bp-tabs');
    for (const t of TABS) {
      const b = el('button', { class: 'bp-tab', dataset: { t: t.id }, html: `${I[t.icon]}<span>${t.label}</span>` });
      b.addEventListener('click', () => this.toggle(t.id));
      tabs.append(b);
    }
    const right = el('div', { class: 'bp-right' },
      el('button', { class: 'icon-btn bp-max', title: 'Maximize panel', html: I.fullscreen, onclick: () => { document.body.classList.toggle('bp-max'); this.app.onResize(); } }),
      el('button', { class: 'icon-btn bp-min', title: 'Collapse panel', html: I.chevron, onclick: () => this.close() }));
    tabs.append(right);
    const rz = $('#bp-resize');
    rz.addEventListener('pointerdown', (e) => {
      if (!this.cur) return;
      e.preventDefault(); rz.setPointerCapture(e.pointerId);
      const y0 = e.clientY, h0 = this.height;
      const mv = (ev) => { this.height = Math.max(120, Math.min(window.innerHeight - 200, h0 + y0 - ev.clientY)); $('#bp-body').style.height = this.height + 'px'; this.app.onResize(); };
      const up = () => { rz.removeEventListener('pointermove', mv); rz.removeEventListener('pointerup', up); store.set('bpHeight', this.height); };
      rz.addEventListener('pointermove', mv); rz.addEventListener('pointerup', up);
    });
    const saved = store.get('bottomTab', null);
    if (saved && !isMobile()) this.open(saved);
  }
  toggle(id) { if (this.cur === id) this.close(); else this.open(id); }
  open(id) {
    this.cur = id; store.set('bottomTab', id);
    const body = $('#bp-body'); body.hidden = false; body.style.height = this.height + 'px'; body.innerHTML = '';
    $$('.bp-tab').forEach((b) => b.classList.toggle('on', b.dataset.t === id));
    $$('#rightbar [data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === id));
    $$('#mobilenav [data-b]').forEach((b) => b.classList.toggle('on', b.dataset.b === id));
    document.body.classList.add('bp-open');
    this[id === 'trading' ? 'trading' : id === 'editor' ? 'editor' : id === 'strategy' ? 'strategy' : 'screener'].render(body);
    this.app.onResize();
  }
  close() {
    this.cur = null; store.set('bottomTab', null);
    $('#bp-body').hidden = true; $('#bp-body').innerHTML = '';
    $$('.bp-tab').forEach((b) => b.classList.remove('on'));
    $$('#rightbar [data-b], #mobilenav [data-b]').forEach((b) => b.classList.remove('on'));
    document.body.classList.remove('bp-open', 'bp-max');
    this.app.onResize();
  }
}

/* =============================== Paper trading =============================== */
class Trading {
  constructor(app, bottom) {
    this.app = app; this.bottom = bottom;
    this.acct = store.get('paper', null) || this.fresh();
    this.tab = 'positions';
    hub.on('quote', (id, q) => this.onQuote(id, q));
    app.on('loaded', () => this.refreshLines());
    app.on('symbol', () => this.refreshLines());
    setInterval(() => { this.refreshLines(); if (this.bottom.cur === 'trading') this.paint(); }, 1000);
  }
  fresh() { return { initial: 100000, balance: 100000, realized: 0, positions: {}, orders: [], history: [] }; }
  save() { store.set('paper', this.acct); }
  px(id) { return hub.quote(id)?.last; }
  spread(id) { const p = this.px(id); const s = findSymbol(id); return Math.max(p * 0.00005, Math.pow(10, -symbolPrecision(s, p))); }
  unrealized() {
    let u = 0;
    for (const [id, p] of Object.entries(this.acct.positions)) { const x = this.px(id); if (x != null) u += (x - p.avg) * p.qty; }
    return u;
  }
  fill(id, side, qty, price, reason = 'Market') {
    const a = this.acct, sgn = side === 'buy' ? 1 : -1;
    let pos = a.positions[id] || { qty: 0, avg: 0, opened: Date.now() };
    let delta = sgn * qty, realized = 0;
    if (pos.qty && Math.sign(pos.qty) !== sgn) {
      const closeQty = Math.min(Math.abs(pos.qty), qty);
      realized = (price - pos.avg) * closeQty * Math.sign(pos.qty);
      pos.qty += sgn * closeQty; delta -= sgn * closeQty;
      a.balance += realized; a.realized += realized;
    }
    if (delta) { const nq = pos.qty + delta; pos.avg = pos.qty ? (pos.avg * pos.qty + price * delta) / nq : price; pos.qty = nq; if (!pos.opened) pos.opened = Date.now(); }
    if (Math.abs(pos.qty) < 1e-12) delete a.positions[id]; else a.positions[id] = pos;
    a.history.unshift({ id: uid(), t: Date.now(), symbol: id, side, qty, price, pnl: realized, reason });
    a.history.splice(500);
    this.save();
    const s = findSymbol(id);
    toast(`${side === 'buy' ? '🟢 Bought' : '🔴 Sold'} ${fmtNum(qty, 4)} ${s.symbol} @ ${fmtPrice(price, symbolPrecision(s, price))}${realized ? ` · P&L ${fmtSigned(realized, 2)}` : ''}`, realized < 0 ? 'error' : 'success', 3500);
    beep(side === 'buy' ? 660 : 520, 0.08);
    this.refreshLines(); if (this.bottom.cur === 'trading') this.paint();
  }
  placeOrder(o) {
    const q = hub.quote(o.symbol); if (!q) { toast('No price for this symbol yet', 'error'); return; }
    const sp = this.spread(o.symbol);
    if (o.type === 'market') {
      const price = o.side === 'buy' ? q.last + sp / 2 : q.last - sp / 2;
      this.fill(o.symbol, o.side, o.qty, price);
      const pos = this.acct.positions[o.symbol];
      if (pos) { if (o.tp) pos.tp = o.tp; if (o.sl) pos.sl = o.sl; this.save(); }
    } else {
      this.acct.orders.push({ ...o, id: uid(), created: Date.now() }); this.save();
      toast(`${o.type === 'limit' ? 'Limit' : 'Stop'} ${o.side} order placed`, 'info', 2000);
    }
    this.refreshLines(); if (this.bottom.cur === 'trading') this.paint();
  }
  closePosition(id) { const p = this.acct.positions[id]; if (!p) return; const q = this.px(id), sp = this.spread(id); this.fill(id, p.qty > 0 ? 'sell' : 'buy', Math.abs(p.qty), p.qty > 0 ? q - sp / 2 : q + sp / 2, 'Close'); }
  reversePosition(id) { const p = this.acct.positions[id]; if (!p) return; const q = this.px(id); this.fill(id, p.qty > 0 ? 'sell' : 'buy', Math.abs(p.qty) * 2, q, 'Reverse'); }
  cancelOrder(oid) { this.acct.orders = this.acct.orders.filter((o) => o.id !== oid); this.save(); this.refreshLines(); if (this.bottom.cur === 'trading') this.paint(); }
  onQuote(id, q) {
    const a = this.acct; let fired = false;
    for (const o of a.orders.slice()) {
      if (o.symbol !== id) continue;
      const x = q.last;
      const hit = o.type === 'limit' ? (o.side === 'buy' ? x <= o.price : x >= o.price) : (o.side === 'buy' ? x >= o.price : x <= o.price);
      if (hit) {
        a.orders = a.orders.filter((z) => z !== o);
        this.fill(id, o.side, o.qty, o.type === 'limit' ? o.price : x, o.type === 'limit' ? 'Limit' : 'Stop');
        const pos = a.positions[id]; if (pos) { if (o.tp) pos.tp = o.tp; if (o.sl) pos.sl = o.sl; this.save(); }
        fired = true;
      }
    }
    const p = a.positions[id];
    if (p) {
      const x = q.last, long = p.qty > 0;
      if (p.tp && (long ? x >= p.tp : x <= p.tp)) { this.fill(id, long ? 'sell' : 'buy', Math.abs(p.qty), p.tp, 'Take profit'); fired = true; }
      else if (p.sl && (long ? x <= p.sl : x >= p.sl)) { this.fill(id, long ? 'sell' : 'buy', Math.abs(p.qty), x, 'Stop loss'); fired = true; }
    }
    if (fired) this.save();
  }
  refreshLines() {
    for (const w of this.app.widgets) {
      const id = w.cfg.symbol, lines = [], prec = w.chart.info.precision;
      const p = this.acct.positions[id];
      if (p) {
        const x = this.px(id), pnl = x != null ? (x - p.avg) * p.qty : 0;
        lines.push({ price: p.avg, color: p.qty > 0 ? '#2962FF' : '#F23645', style: 'solid', text: `${p.qty > 0 ? 'LONG' : 'SHORT'} ${fmtNum(Math.abs(p.qty), 4)}  ${fmtSigned(pnl, 2)} USD`, closable: true, onClose: () => this.closePosition(id), offset: 0 });
        if (p.tp) lines.push({ price: p.tp, color: '#089981', text: `TP ${fmtSigned((p.tp - p.avg) * p.qty, 2)}`, draggable: true, closable: true, offset: 160, onMove: (v) => { p.tp = +v.toFixed(prec); this.save(); }, onClose: () => { delete p.tp; this.save(); this.refreshLines(); } });
        if (p.sl) lines.push({ price: p.sl, color: '#F23645', text: `SL ${fmtSigned((p.sl - p.avg) * p.qty, 2)}`, draggable: true, closable: true, offset: 160, onMove: (v) => { p.sl = +v.toFixed(prec); this.save(); }, onClose: () => { delete p.sl; this.save(); this.refreshLines(); } });
      }
      for (const o of this.acct.orders) {
        if (o.symbol !== id) continue;
        lines.push({ price: o.price, color: o.side === 'buy' ? '#2962FF' : '#F23645', text: `${o.side.toUpperCase()} ${o.type.toUpperCase()} ${fmtNum(o.qty, 4)}`, draggable: true, closable: true, offset: 300,
          onMove: (v) => { o.price = +v.toFixed(prec); this.save(); toast('Order modified', 'info', 1200); }, onClose: () => this.cancelOrder(o.id) });
      }
      this.app.setTradeLines(w, lines);
    }
  }
  ticket(symbol, side = 'buy', opt = {}) {
    const s = findSymbol(symbol); const q = hub.quote(symbol);
    const prec = symbolPrecision(s, q?.last || s.price);
    const last = q?.last || s.price;
    const o = { symbol, side, type: opt.type || 'market', qty: s.type === 'crypto' ? +(1000 / last).toPrecision(3) : s.type === 'forex' ? 10000 : 10, price: +(opt.price ?? last).toFixed(prec), tpOn: false, slOn: false, tp: +(last * 1.02).toFixed(prec), sl: +(last * 0.99).toFixed(prec) };
    const seg = el('div', { class: 'seg big' });
    const sideBtns = ['buy', 'sell'].map((sd) => el('button', { class: sd + (o.side === sd ? ' on' : ''), onclick: () => { o.side = sd; sideBtns.forEach((b) => b.classList.toggle('on', b.classList.contains(sd))); setDefaults(); upd(); } }, el('small', {}, sd.toUpperCase()), el('b', { class: 'tk-' + sd })));
    seg.append(...sideBtns);
    const typeSeg = el('div', { class: 'seg' });
    const typeBtns = ['market', 'limit', 'stop'].map((t) => el('button', { class: o.type === t ? 'on' : '', onclick: () => { o.type = t; typeBtns.forEach((b) => b.classList.toggle('on', b.textContent.toLowerCase() === t)); upd(); } }, t[0].toUpperCase() + t.slice(1)));
    typeSeg.append(...typeBtns);
    const priceIn = numberEl(o.price, (v) => { o.price = v; upd(); }, { step: 'any' });
    const qtyIn = numberEl(o.qty, (v) => { o.qty = v; upd(); }, { min: 0, step: 'any' });
    const tpIn = numberEl(o.tp, (v) => { o.tp = v; upd(); }, { step: 'any' }), slIn = numberEl(o.sl, (v) => { o.sl = v; upd(); }, { step: 'any' });
    const priceRow = formRow('Price', priceIn);
    const summary = el('div', { class: 'tk-sum' });
    const setDefaults = () => { const px = o.type === 'market' ? last : o.price; const k = o.side === 'buy' ? 1 : -1; o.tp = +(px * (1 + 0.02 * k)).toFixed(prec); o.sl = +(px * (1 - 0.01 * k)).toFixed(prec); tpIn.value = o.tp; slIn.value = o.sl; };
    const upd = () => {
      priceRow.style.display = o.type === 'market' ? 'none' : '';
      const qq = hub.quote(symbol), sp = this.spread(symbol);
      sideBtns[0].querySelector('b').textContent = qq ? fmtPrice(qq.last + sp / 2, prec) : '—';
      sideBtns[1].querySelector('b').textContent = qq ? fmtPrice(qq.last - sp / 2, prec) : '—';
      const px = o.type === 'market' ? qq?.last || last : o.price;
      const k = o.side === 'buy' ? 1 : -1;
      summary.innerHTML = `<div><span>Order value</span><b>${fmtPrice(px * o.qty, 2)} USD</b></div>` +
        (o.tpOn ? `<div><span>Take profit P&amp;L</span><b class="up">${fmtSigned((o.tp - px) * o.qty * k, 2)}</b></div>` : '') +
        (o.slOn ? `<div><span>Stop loss P&amp;L</span><b class="down">${fmtSigned((o.sl - px) * o.qty * k, 2)}</b></div>` : '') +
        `<div><span>Available balance</span><b>${fmtPrice(this.acct.balance, 2)} USD</b></div>`;
    };
    const body = el('div', { class: 'form ticket' }, seg, typeSeg, priceRow, formRow('Quantity', qtyIn),
      formRow('Take profit', switchEl(false, (v) => { o.tpOn = v; upd(); }), tpIn), formRow('Stop loss', switchEl(false, (v) => { o.slOn = v; upd(); }), slIn), summary,
      el('p', { class: 'muted sm' }, 'Paper trading — simulated orders with virtual money. No real trades are executed.'));
    upd();
    const iv = setInterval(upd, 1000);
    dialog({
      title: `${s.symbol} · Paper Trading`, width: 400, body, onClose: () => clearInterval(iv),
      buttons: [{ label: 'Cancel' }, {
        label: 'Place order', primary: true, onClick: () => {
          if (!(o.qty > 0)) { toast('Quantity must be positive', 'error'); return false; }
          this.placeOrder({ symbol, side: o.side, type: o.type, qty: o.qty, price: o.price, tp: o.tpOn ? o.tp : null, sl: o.slOn ? o.sl : null });
        },
      }],
    });
  }
  render(body) {
    body.innerHTML = '';
    this.sumEl = el('div', { class: 'tr-sum' });
    const tabs = el('div', { class: 'seg' }, ...[['positions', 'Positions'], ['orders', 'Orders'], ['history', 'History']].map(([id, l]) => el('button', { class: this.tab === id ? 'on' : '', dataset: { tab: id }, onclick: () => { this.tab = id; this.render(body); } }, l)));
    const acts = el('div', { class: 'tr-acts' },
      el('button', { class: 'btn btn-buy sm', onclick: () => this.ticket(this.app.active.cfg.symbol, 'buy') }, 'Buy'),
      el('button', { class: 'btn btn-sell sm', onclick: () => this.ticket(this.app.active.cfg.symbol, 'sell') }, 'Sell'),
      el('button', { class: 'btn btn-ghost sm', onclick: async () => { if (await confirmDlg('Reset paper trading account to $100,000?', 'Reset')) { this.acct = this.fresh(); this.save(); this.refreshLines(); this.render(body); } } }, 'Reset account'));
    this.tblEl = el('div', { class: 'tbl-wrap' });
    body.append(el('div', { class: 'bp-toolbar' }, el('span', { class: 'bp-badge' }, 'Paper Trading'), tabs, acts), this.sumEl, this.tblEl);
    this.paint();
  }
  paint() {
    if (!this.sumEl) return;
    const a = this.acct, u = this.unrealized(), eq = a.balance + u;
    this.sumEl.innerHTML = [['Account balance', fmtPrice(a.balance, 2)], ['Equity', fmtPrice(eq, 2)], ['Realized P&L', fmtSigned(a.realized, 2), a.realized >= 0 ? 'up' : 'down'], ['Unrealized P&L', fmtSigned(u, 2), u >= 0 ? 'up' : 'down'], ['Return', fmtPct((eq / a.initial - 1) * 100), eq >= a.initial ? 'up' : 'down']]
      .map(([k, v, c]) => `<div><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
    const t = el('table', { class: 'tbl' });
    const tz = new TimeZone(this.app.settings.timezone || 'local');
    if (this.tab === 'positions') {
      t.append(el('tr', {}, ...['Symbol', 'Side', 'Qty', 'Avg price', 'Last', 'Unrealized P&L', 'TP', 'SL', ''].map((h) => el('th', {}, h))));
      for (const [id, p] of Object.entries(a.positions)) {
        const s = findSymbol(id), x = this.px(id), prec = symbolPrecision(s, p.avg), pnl = x != null ? (x - p.avg) * p.qty : 0;
        t.append(el('tr', {}, el('td', { class: 'link', onclick: () => this.app.active.setSymbol(id) }, s.symbol), el('td', { class: p.qty > 0 ? 'up' : 'down' }, p.qty > 0 ? 'Long' : 'Short'), el('td', {}, fmtNum(Math.abs(p.qty), 4)),
          el('td', {}, fmtPrice(p.avg, prec)), el('td', {}, fmtPrice(x, prec)), el('td', { class: pnl >= 0 ? 'up' : 'down' }, `${fmtSigned(pnl, 2)} (${fmtPct(((x / p.avg - 1) * 100) * Math.sign(p.qty))})`),
          el('td', {}, p.tp ? fmtPrice(p.tp, prec) : '—'), el('td', {}, p.sl ? fmtPrice(p.sl, prec) : '—'),
          el('td', { class: 'acts' }, el('button', { class: 'btn btn-ghost xs', onclick: () => this.reversePosition(id) }, 'Reverse'), el('button', { class: 'btn btn-ghost xs', onclick: () => this.closePosition(id) }, 'Close'))));
      }
      if (!Object.keys(a.positions).length) t.append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'No open positions. Use the Buy/Sell buttons on the chart or above.')));
    } else if (this.tab === 'orders') {
      t.append(el('tr', {}, ...['Symbol', 'Side', 'Type', 'Qty', 'Price', 'TP', 'SL', 'Placed', ''].map((h) => el('th', {}, h))));
      for (const o of a.orders) {
        const s = findSymbol(o.symbol), prec = symbolPrecision(s, o.price);
        t.append(el('tr', {}, el('td', {}, s.symbol), el('td', { class: o.side === 'buy' ? 'up' : 'down' }, o.side), el('td', {}, o.type), el('td', {}, fmtNum(o.qty, 4)), el('td', {}, fmtPrice(o.price, prec)),
          el('td', {}, o.tp ? fmtPrice(o.tp, prec) : '—'), el('td', {}, o.sl ? fmtPrice(o.sl, prec) : '—'), el('td', {}, fmtDateTime(o.created, tz)), el('td', { class: 'acts' }, el('button', { class: 'btn btn-ghost xs', onclick: () => this.cancelOrder(o.id) }, 'Cancel'))));
      }
      if (!a.orders.length) t.append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'No working orders')));
    } else {
      t.append(el('tr', {}, ...['Time', 'Symbol', 'Side', 'Qty', 'Price', 'Reason', 'Realized P&L'].map((h) => el('th', {}, h))));
      for (const h of a.history.slice(0, 200)) {
        const s = findSymbol(h.symbol);
        t.append(el('tr', {}, el('td', {}, fmtDateTime(h.t, tz)), el('td', {}, s?.symbol), el('td', { class: h.side === 'buy' ? 'up' : 'down' }, h.side), el('td', {}, fmtNum(h.qty, 4)), el('td', {}, fmtPrice(h.price, symbolPrecision(s, h.price))), el('td', {}, h.reason), el('td', { class: h.pnl > 0 ? 'up' : h.pnl < 0 ? 'down' : '' }, h.pnl ? fmtSigned(h.pnl, 2) : '—')));
      }
      if (!a.history.length) t.append(el('tr', {}, el('td', { colspan: 7, class: 'empty' }, 'No trades yet')));
    }
    this.tblEl.innerHTML = ''; this.tblEl.append(t);
  }
}

/* =============================== Script editor =============================== */
const EXAMPLES = {
  'EMA Cross (overlay)': `//@name EMA Cross
//@overlay true
const fast = ta.ema(close, input(9, 'Fast'));
const slow = ta.ema(close, input(21, 'Slow'));
plot(fast, 'Fast EMA', { color: '#2962FF', width: 2 });
plot(slow, 'Slow EMA', { color: '#FF6D00', width: 2 });
// buy/sell markers
signal(series(i => ta.cross(fast, slow, i)), 'BUY', 'below', '#089981');
signal(series(i => ta.crossunder(fast, slow, i)), 'SELL', 'above', '#F23645');`,
  'Custom RSI with bands': `//@name My RSI
//@overlay false
const r = ta.rsi(close, input(14, 'Length'));
plot(r, 'RSI', { color: '#7E57C2', width: 2 });
plot(ta.sma(r, 9), 'Signal', { color: '#F7C600' });
hline(70, 'Overbought');
hline(30, 'Oversold');`,
  'Volume-weighted MACD': `//@name VW-MACD
//@overlay false
const fast = ta.vwma(close, volume, 12);
const slow = ta.vwma(close, volume, 26);
const macd = series(i => fast[i] - slow[i]);
const sig = ta.ema(macd, 9);
plot(series(i => macd[i] - sig[i]), 'Histogram', { type: 'histogram', color: '#26A69A' });
plot(macd, 'MACD', { color: '#2962FF', width: 2 });
plot(sig, 'Signal', { color: '#FF6D00' });
hline(0);`,
  'Bollinger squeeze': `//@name BB Squeeze
//@overlay false
const len = input(20, 'Length');
const basis = ta.sma(close, len), dev = ta.stdev(close, len);
const atr = ta.atr(high, low, close, len);
const width = series(i => (4 * dev[i]) / basis[i] * 100);
const kc = series(i => (3 * atr[i]) / basis[i] * 100);
plot(width, 'BB width %', { color: '#2962FF', width: 2 });
plot(kc, 'KC width %', { color: '#FF9800' });`,
};

class ScriptEditor {
  constructor(app, bottom) { this.app = app; this.bottom = bottom; this.code = store.get('scriptDraft', EXAMPLES['EMA Cross (overlay)']); }
  compile(code, id) {
    const meta = { name: (code.match(/\/\/@name\s+(.+)/) || [])[1]?.trim() || 'My Script', overlay: /\/\/@overlay\s+true/.test(code) };
    const run = (S) => {
      const n = S.close.length, plots = [], levels = [], signals = [];
      let inputIdx = 0;
      const api = {
        open: S.open, high: S.high, low: S.low, close: S.close, volume: S.volume, time: S.time, hl2: S.hl2, hlc3: S.hlc3, ohlc4: S.ohlc4, n, bar_count: n, ta, na: NaN, math: Math,
        series: (f) => { const a = new Array(n); for (let i = 0; i < n; i++) { const v = f(i); a[i] = typeof v === 'boolean' ? (v ? 1 : 0) : v; } return a; },
        input: (def) => { inputIdx++; return def; },
        plot: (arr, title, o = {}) => { plots.push({ arr: Array.isArray(arr) ? arr : new Array(n).fill(+arr), title: title || `Plot ${plots.length + 1}`, ...o }); },
        hline: (v, title, color) => levels.push({ v, name: title, color }),
        signal: (cond, text, pos = 'below', color = '#2962FF') => signals.push({ cond, text, pos, color }),
      };
      const fn = new Function(...Object.keys(api), '"use strict";\n' + code);
      fn(...Object.values(api));
      void inputIdx;
      return { plots, levels, signals };
    };
    const sample = sources(this.app.active?.chart.disp?.length ? this.app.active.chart.disp : [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }]);
    const dry = run(sample);
    const def = {
      id: id || 'script_' + hashStr(code).toString(36), name: meta.name, short: meta.name, overlay: meta.overlay, group: 'My scripts', custom: true, inputs: [],
      plots: dry.plots.map((p, i) => ({ id: 'p' + i, name: p.title, color: p.color || ['#2962FF', '#FF6D00', '#089981', '#E91E63', '#9C27B0'][i % 5], width: p.width || 1, type: p.type })),
      levels: dry.levels.map((l) => ({ v: l.v, name: l.name })),
      calc: (S) => {
        const r = run(S), out = {};
        r.plots.forEach((p, i) => { out['p' + i] = p.arr; });
        return out;
      },
    };
    def.signals = (S) => run(S).signals;
    return def;
  }
  render(body) {
    body.innerHTML = '';
    const ta_ = el('textarea', { class: 'code', spellcheck: 'false' });
    ta_.value = this.code;
    ta_.addEventListener('input', () => { this.code = ta_.value; store.set('scriptDraft', this.code); });
    ta_.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ta_.selectionStart; ta_.setRangeText('  ', s, ta_.selectionEnd, 'end'); this.code = ta_.value; } if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addToChart(); });
    const out = el('div', { class: 'console' }, 'Ready. Write JavaScript using close/open/high/low/volume arrays and the ta.* library, then press “Add to chart” (Ctrl+Enter).');
    const log = (m, err) => { out.textContent = m; out.className = 'console' + (err ? ' err' : ' ok'); };
    const addToChart = () => {
      try {
        const def = this.compile(this.code);
        const w = this.app.active;
        const existing = w.chart.indicators.find((i) => i.def.id === def.id); if (existing) w.removeIndicator(existing.uid);
        this.app.customScripts = this.app.customScripts.filter((s) => s.id !== def.id).concat([{ id: def.id, name: def.name, code: this.code, temp: true }]);
        const inst = w.addIndicator(def);
        const sig = def.signals(sources(w.chart.disp));
        if (sig.length) {
          const m = [];
          for (const sg of sig) sg.cond.forEach((v, i) => { if (v && w.chart.disp[i]) m.push({ t: w.chart.disp[i].t, pos: sg.pos, shape: sg.pos === 'above' ? 'arrowDown' : 'arrowUp', color: sg.color, text: sg.text }); });
          w.chart.setMarkers(m);
        }
        log(`✓ “${def.name}” compiled: ${def.plots.length} plot(s)${sig.length ? `, ${sig.reduce((a, s) => a + s.cond.filter(Boolean).length, 0)} signal(s)` : ''}. Added to chart.`);
        void inst;
      } catch (e) { log('✗ ' + e.message, true); }
    };
    const save = () => {
      try {
        const def = this.compile(this.code);
        const list = store.get('scripts', []).filter((s) => s.id !== def.id);
        list.push({ id: def.id, name: def.name, code: this.code });
        store.set('scripts', list); this.app.customScripts = list;
        log(`✓ Saved “${def.name}”. Find it under Indicators → My scripts.`);
      } catch (e) { log('✗ ' + e.message, true); }
    };
    const ex = el('button', { class: 'btn btn-ghost sm' }, 'Examples ▾');
    ex.addEventListener('click', () => menu(ex, Object.keys(EXAMPLES).map((k) => ({ label: k, icon: 'code', onClick: () => { this.code = EXAMPLES[k]; ta_.value = this.code; store.set('scriptDraft', this.code); } }))));
    const open = el('button', { class: 'btn btn-ghost sm' }, 'Open ▾');
    open.addEventListener('click', () => {
      const list = store.get('scripts', []);
      menu(open, list.length ? list.map((s) => ({ label: s.name, icon: 'code', onClick: () => { this.code = s.code; ta_.value = s.code; } })) : [{ label: 'No saved scripts', disabled: true }]);
    });
    const help = el('details', { class: 'help' }, el('summary', {}, 'API reference'), el('pre', {}, `Series: open high low close volume time hl2 hlc3 ohlc4 (arrays), n = bar count
ta.sma/ema/wma/rma/hma/vwma(src,len)  ta.rsi(src,len)  ta.stdev(src,len)  ta.atr(h,l,c,len)
ta.highest/lowest(src,len)  ta.change(src,len)  ta.linreg(src,len)  ta.cross(a,b,i)  ta.crossunder(a,b,i)
series(i => expr)  input(default, title)  plot(arr, title, {color,width,type:'line|histogram|columns|circles|area|step'})
hline(value, title)  signal(boolArray, text, 'above'|'below', color)
Header: //@name My Script   //@overlay true`));
    body.append(el('div', { class: 'bp-toolbar' }, el('span', { class: 'bp-badge' }, 'Script Editor'), ex, open,
      el('button', { class: 'btn btn-ghost sm', onclick: save }, 'Save'), el('button', { class: 'btn btn-primary sm', onclick: addToChart }, 'Add to chart')),
    el('div', { class: 'editor' }, ta_, el('div', { class: 'ed-side' }, out, help)));
  }
}

/* =============================== Strategy tester =============================== */
class StrategyTester {
  constructor(app, bottom) {
    this.app = app; this.bottom = bottom;
    this.sid = store.get('stratId', 'macross');
    this.params = store.get('stratParams', {});
    this.opts = store.get('stratOpts', { capital: 10000, qtyPct: 100, commission: 0.05, short: true });
    this.tab = 'overview';
    app.on('loaded', () => { if (this.bottom.cur === 'strategy') this.run(); });
  }
  get strat() { return STRATEGIES.find((s) => s.id === this.sid) || STRATEGIES[0]; }
  render(body) {
    body.innerHTML = '';
    const st = this.strat;
    const p = { ...defaultInputs(st), ...(this.params[st.id] || {}) };
    const form = el('div', { class: 'st-form' });
    form.append(el('label', {}, 'Strategy', selectEl(STRATEGIES.map((s) => ({ value: s.id, label: s.name })), st.id, (v) => { this.sid = v; store.set('stratId', v); this.render(body); })));
    for (const inp of st.inputs) {
      form.append(el('label', {}, inp.name, inp.type === 'select' ? selectEl(inp.options, p[inp.id], (v) => { p[inp.id] = v; this.saveP(st, p); }) : numberEl(p[inp.id], (v) => { p[inp.id] = v; this.saveP(st, p); }, { step: inp.type === 'float' ? 0.1 : 1 })));
    }
    form.append(
      el('label', {}, 'Capital', numberEl(this.opts.capital, (v) => { this.opts.capital = v; this.saveO(); })),
      el('label', {}, 'Order size %', numberEl(this.opts.qtyPct, (v) => { this.opts.qtyPct = v; this.saveO(); }, { min: 1, max: 100 })),
      el('label', {}, 'Commission %', numberEl(this.opts.commission, (v) => { this.opts.commission = v; this.saveO(); }, { min: 0, step: 0.01 })),
      el('label', { class: 'inline' }, switchEl(this.opts.short, (v) => { this.opts.short = v; this.saveO(); }), 'Allow shorts'),
      el('button', { class: 'btn btn-primary sm', onclick: () => this.run() }, 'Run backtest'),
      el('button', { class: 'btn btn-ghost sm', onclick: () => { this.app.active.chart.setMarkers([]); } }, 'Clear markers'),
    );
    const tabs = el('div', { class: 'seg' }, ...[['overview', 'Overview'], ['trades', 'List of trades']].map(([id, l]) => el('button', { class: this.tab === id ? 'on' : '', onclick: () => { this.tab = id; this.paint(); tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.textContent === l)); } }, l)));
    this.resEl = el('div', { class: 'st-res' });
    body.append(el('div', { class: 'bp-toolbar' }, el('span', { class: 'bp-badge' }, 'Strategy Tester'), el('span', { class: 'muted sm' }, `${this.app.active.chart.info.symbol} · ${this.app.active.chart.info.ivLabel}`), tabs), el('div', { class: 'st' }, form, this.resEl));
    this.run();
  }
  saveP(st, p) { this.params[st.id] = p; store.set('stratParams', this.params); }
  saveO() { store.set('stratOpts', this.opts); }
  run() {
    const w = this.app.active, st = this.strat;
    const p = { ...defaultInputs(st), ...(this.params[st.id] || {}) };
    const bars = w.chart.disp;
    if (bars.length < 30) { if (this.resEl) this.resEl.innerHTML = '<div class="empty">Not enough data</div>'; return; }
    this.result = backtest(bars, st, p, this.opts);
    w.chart.setMarkers(this.result.markers);
    this.paint();
  }
  paint() {
    const box = this.resEl, r = this.result; if (!box || !r) return;
    box.innerHTML = '';
    const s = r.stats;
    if (this.tab === 'overview') {
      const cards = el('div', { class: 'st-cards' }, ...[
        ['Net Profit', `${fmtSigned(s.net, 2)}`, `${fmtPct(s.netPct)}`, s.net >= 0 ? 'up' : 'down'], ['Total Closed Trades', s.total, `${s.wins} W / ${s.losses} L`],
        ['Percent Profitable', s.winRate.toFixed(1) + '%', ''], ['Profit Factor', isFinite(s.pf) ? s.pf.toFixed(3) : '∞', ''],
        ['Max Drawdown', fmtPrice(s.maxDD, 2), fmtPct(-s.maxDDPct), 'down'], ['Avg Trade', fmtSigned(s.avg, 2), `${s.avgBars.toFixed(1)} bars`, s.avg >= 0 ? 'up' : 'down'],
        ['Buy & Hold', fmtSigned(s.buyHold, 2), '', s.buyHold >= 0 ? 'up' : 'down'],
      ].map(([k, v, sub, c]) => el('div', { class: 'st-card' }, el('span', {}, k), el('b', { class: c || '' }, String(v)), el('small', { class: c || '' }, sub))));
      const cv = el('canvas', { class: 'eq' });
      box.append(cards, cv);
      requestAnimationFrame(() => this.drawEquity(cv, r.curve));
    } else {
      const t = el('table', { class: 'tbl' });
      const tz = new TimeZone(this.app.settings.timezone || 'local'), prec = this.app.active.chart.info.precision;
      t.append(el('tr', {}, ...['#', 'Type', 'Entry time', 'Entry', 'Exit time', 'Exit', 'Profit', '%', 'Bars'].map((h) => el('th', {}, h))));
      r.trades.slice().reverse().forEach((tr, k) => t.append(el('tr', {}, el('td', {}, r.trades.length - k), el('td', { class: tr.dir > 0 ? 'up' : 'down' }, tr.dir > 0 ? 'Long' : 'Short'), el('td', {}, fmtDateTime(tr.entryT, tz)), el('td', {}, fmtPrice(tr.entryP, prec)),
        el('td', {}, fmtDateTime(tr.exitT, tz)), el('td', {}, fmtPrice(tr.exitP, prec)), el('td', { class: tr.pnl >= 0 ? 'up' : 'down' }, fmtSigned(tr.pnl, 2)), el('td', { class: tr.pct >= 0 ? 'up' : 'down' }, fmtPct(tr.pct)), el('td', {}, tr.bars))));
      if (!r.trades.length) t.append(el('tr', {}, el('td', { colspan: 9, class: 'empty' }, 'No trades')));
      box.append(el('div', { class: 'tbl-wrap' }, t));
    }
  }
  drawEquity(cv, curve) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600, h = cv.clientHeight || 140;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    if (curve.length < 2) return;
    let lo = Infinity, hi = -Infinity; for (const c of curve) { lo = Math.min(lo, c.eq); hi = Math.max(hi, c.eq); }
    const base = this.opts.capital; lo = Math.min(lo, base); hi = Math.max(hi, base);
    const X = (i) => 8 + (i / (curve.length - 1)) * (w - 16), Y = (v) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (h - 16);
    const by = Y(base);
    const css = getComputedStyle(document.documentElement);
    ctx.strokeStyle = css.getPropertyValue('--border'); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(w, by); ctx.stroke(); ctx.setLineDash([]);
    const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, 'rgba(41,98,255,0.35)'); grad.addColorStop(1, 'rgba(41,98,255,0)');
    ctx.beginPath(); curve.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c.eq)) : ctx.moveTo(X(i), Y(c.eq)))); ctx.lineTo(X(curve.length - 1), h); ctx.lineTo(X(0), h); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); curve.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c.eq)) : ctx.moveTo(X(i), Y(c.eq)))); ctx.strokeStyle = '#2962FF'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = css.getPropertyValue('--text2'); ctx.font = '11px sans-serif'; ctx.fillText('Equity  ' + fmtPrice(curve[curve.length - 1].eq, 2), 10, 16);
  }
}

/* =============================== Screener =============================== */
class Screener {
  constructor(app, bottom) {
    this.app = app; this.bottom = bottom;
    this.type = 'all'; this.q = ''; this.sort = { k: 'vol', dir: -1 }; this.filter = 'any';
    this.cache = new Map(); this.loading = false;
    hub.on('quote', () => { if (this.bottom.cur === 'screener') this.paintSoon(); });
  }
  paintSoon() { if (this._t) return; this._t = setTimeout(() => { this._t = null; this.paint(); }, 1500); }
  render(body) {
    body.innerHTML = '';
    const typeSel = el('div', { class: 'seg' }, ...TYPES.map((t) => el('button', { class: this.type === t.id ? 'on' : '', onclick: (e) => { this.type = t.id; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); this.paint(); } }, t.label)));
    const search = el('input', { class: 'inp sm', placeholder: 'Filter symbols…', value: this.q });
    search.addEventListener('input', () => { this.q = search.value; this.paint(); });
    const sig = selectEl([{ value: 'any', label: 'Any rating' }, { value: 'Strong Buy', label: 'Strong Buy' }, { value: 'Buy', label: 'Buy' }, { value: 'Neutral', label: 'Neutral' }, { value: 'Sell', label: 'Sell' }, { value: 'Strong Sell', label: 'Strong Sell' }, { value: 'os', label: 'RSI < 30 (oversold)' }, { value: 'ob', label: 'RSI > 70 (overbought)' }, { value: 'gain', label: 'Change > +2%' }, { value: 'loss', label: 'Change < −2%' }], this.filter, (v) => { this.filter = v; this.paint(); });
    sig.classList.add('sm');
    this.tbl = el('div', { class: 'tbl-wrap' });
    this.status = el('span', { class: 'muted sm' });
    body.append(el('div', { class: 'bp-toolbar' }, el('span', { class: 'bp-badge' }, 'Screener'), typeSel, search, sig, this.status), this.tbl);
    this.paint();
    this.loadAll();
  }
  async loadAll() {
    if (this.loading) return; this.loading = true;
    const todo = SYMBOLS.filter((s) => !this.cache.has(s.id));
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const s = todo[i++];
        try {
          const bars = await hub.getBars(s, '1d');
          const r = technicalRating(bars), c = bars.map((b) => b.c), n = c.length;
          const perf = (d) => (n > d ? (c[n - 1] / c[n - 1 - d] - 1) * 100 : NaN);
          const atr = ta.atr(bars.map((b) => b.h), bars.map((b) => b.l), c, 14);
          this.cache.set(s.id, { rating: r, w1: perf(7), m1: perf(30), volat: (atr[n - 1] / c[n - 1]) * 100 });
        } catch { this.cache.set(s.id, null); }
        if (this.status) this.status.textContent = `Analyzed ${this.cache.size}/${SYMBOLS.length}`;
        this.paintSoon();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.loading = false; if (this.status) this.status.textContent = `${SYMBOLS.length} symbols`; this.paint();
  }
  paint() {
    if (!this.tbl) return;
    const cols = [['symbol', 'Symbol'], ['last', 'Price'], ['chgPct', 'Chg %'], ['chg', 'Chg'], ['vol', 'Volume'], ['w1', 'Perf 1W'], ['m1', 'Perf 1M'], ['volat', 'Volatility'], ['rsi', 'RSI (14)'], ['score', 'Technical Rating'], ['type', 'Market']];
    let rows = SYMBOLS.filter((s) => this.type === 'all' || s.type === this.type).filter((s) => !this.q || s.symbol.includes(this.q.toUpperCase()) || s.name.toUpperCase().includes(this.q.toUpperCase())).map((s) => {
      const q = hub.quote(s.id) || {}, x = this.cache.get(s.id);
      return { s, symbol: s.symbol, last: q.last, chgPct: q.chgPct, chg: q.chg, vol: (q.vol || 0) * (q.last || 0), w1: x?.w1, m1: x?.m1, volat: x?.volat, rsi: x?.rating.rsi, score: x?.rating.score, label: x?.rating.label, type: s.type };
    });
    const f = this.filter;
    if (f !== 'any') rows = rows.filter((r) => (f === 'os' ? r.rsi < 30 : f === 'ob' ? r.rsi > 70 : f === 'gain' ? r.chgPct > 2 : f === 'loss' ? r.chgPct < -2 : r.label === f));
    const { k, dir } = this.sort;
    rows.sort((a, b) => { const x = a[k], y = b[k]; if (typeof x === 'string') return x.localeCompare(y) * dir; return ((isFinite(x) ? x : -Infinity) - (isFinite(y) ? y : -Infinity)) * dir; });
    const t = el('table', { class: 'tbl screener' });
    t.append(el('tr', {}, ...cols.map(([key, l]) => { const th = el('th', { class: 'sortable' + (key === k ? ' on' : '') }, l + (key === k ? (dir > 0 ? ' ▲' : ' ▼') : '')); th.addEventListener('click', () => { this.sort = { k: key, dir: key === k ? -dir : -1 }; this.paint(); }); return th; })));
    for (const r of rows) {
      const prec = symbolPrecision(r.s, r.last || r.s.price);
      const rc = r.score > 0.5 ? 'sbuy' : r.score > 0.1 ? 'buy' : r.score < -0.5 ? 'ssell' : r.score < -0.1 ? 'sell' : 'neutral';
      const tr = el('tr', { class: 'clickable' },
        el('td', {}, symbolLogo(r.s, 'sm'), ' ', el('b', {}, r.symbol), el('div', { class: 'muted xs' }, r.s.name)),
        el('td', {}, fmtPrice(r.last, prec)), el('td', { class: r.chgPct >= 0 ? 'up' : 'down' }, fmtPct(r.chgPct)), el('td', { class: r.chg >= 0 ? 'up' : 'down' }, fmtSigned(r.chg, prec)),
        el('td', {}, fmtVol(r.vol)), el('td', { class: r.w1 >= 0 ? 'up' : 'down' }, fmtPct(r.w1)), el('td', { class: r.m1 >= 0 ? 'up' : 'down' }, fmtPct(r.m1)), el('td', {}, isFinite(r.volat) ? r.volat.toFixed(2) + '%' : '—'),
        el('td', { class: r.rsi > 70 ? 'down' : r.rsi < 30 ? 'up' : '' }, isFinite(r.rsi) ? r.rsi.toFixed(1) : '—'),
        el('td', {}, r.label ? el('span', { class: 'rating ' + rc }, r.label) : el('span', { class: 'muted' }, '…')),
        el('td', { class: 'muted' }, r.type));
      tr.addEventListener('click', () => { this.app.active.setSymbol(r.s.id); this.app.updateTopbar(); });
      t.append(tr);
    }
    const sc = this.tbl.scrollTop;
    this.tbl.innerHTML = ''; this.tbl.append(t); this.tbl.scrollTop = sc;
  }
}
void INDICATORS;
