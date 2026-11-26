// Right sidebar panels
import { el, $, $$, store, fmtPrice, fmtPct, fmtVol, fmtSigned, uid, isMobile, fmtDateTime, TimeZone, condLabel, DAY } from './util.js';
import { SYMBOLS, findSymbol, symbolPrecision, SYMBOL_COLORS, symbolLogo } from './symbols.js';
import { hub } from './datafeed.js';
import { technicalRating, sources, ta } from './indicators.js';
import { TOOLS } from './drawings.js';
import { I, TOOL_ICON } from './icons.js';
import { menu, contextMenu, promptText, toast, confirmDlg } from './ui.js';
import * as D from './dialogs.js';

const DEFAULT_WL = [
  { name: 'INDICES', open: true, items: ['SP:SPX', 'NASDAQ:NDX', 'DJ:DJI', 'CBOE:VIX', 'XETR:DAX'] },
  { name: 'STOCKS', open: true, items: ['NASDAQ:AAPL', 'NASDAQ:MSFT', 'NASDAQ:NVDA', 'NASDAQ:TSLA', 'NASDAQ:AMZN', 'NASDAQ:META', 'NASDAQ:GOOGL'] },
  { name: 'CRYPTO', open: true, items: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT', 'BINANCE:XRPUSDT', 'BINANCE:DOGEUSDT'] },
  { name: 'FOREX', open: true, items: ['FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'FX:DXY'] },
  { name: 'FUTURES', open: true, items: ['OANDA:XAUUSD', 'NYMEX:USOIL', 'CME:ES1!'] },
];
const PANELS = [
  { id: 'watchlist', icon: 'watchlist', title: 'Watchlist, details and news' },
  { id: 'alerts', icon: 'alarm', title: 'Alerts' },
  { id: 'datawindow', icon: 'datawindow', title: 'Data Window' },
  { id: 'objtree', icon: 'objtree', title: 'Object Tree' },
  { id: 'hotlist', icon: 'hotlist', title: 'Hotlists' },
];

export class Panels {
  constructor(app) {
    this.app = app;
    this.cur = isMobile() ? null : store.get('rightPanel', 'watchlist');
    this.wl = store.get('watchlist', DEFAULT_WL);
    this.width = store.get('rpWidth', 320);
    this.rows = new Map();
    this.ratingCache = new Map();
    this.buildBar();
    this.buildResizer();
    $('#rightpanel').hidden = true;
    hub.on('quote', (id, q) => this.onQuote(id, q));
    app.on('active', () => this.refresh(['details', 'objtree', 'datawindow', 'watchlist']));
    app.on('symbol', () => this.refresh(['details', 'objtree', 'watchlist']));
    app.on('loaded', () => this.refresh(['details', 'objtree', 'datawindow']));
    app.on('drawings', () => this.refresh(['objtree']));
    app.on('indicators', () => this.refresh(['objtree']));
    app.on('alerts', () => this.refresh(['alerts']));
    app.on('crosshair', () => { if (this.cur === 'datawindow') this.renderDataWindow(); });
    app.on('bar', () => { if (this.cur === 'datawindow' && !this.app.active.chart.cross) this.renderDataWindow(); });
    setInterval(() => { if (this.cur === 'hotlist') this.renderHotlist(); }, 3000);
  }
  buildBar() {
    const bar = $('#rightbar'); bar.innerHTML = '';
    for (const p of PANELS) {
      const b = el('button', { class: 'rb-btn', title: p.title, html: I[p.icon], dataset: { p: p.id } });
      b.addEventListener('click', () => this.toggle(p.id));
      bar.append(b);
    }
    bar.append(el('div', { class: 'rb-spacer' }));
    const bottomBtns = [['screener', 'screener', 'Stock Screener'], ['editor', 'code', 'Script Editor'], ['strategy', 'strategy', 'Strategy Tester'], ['trading', 'trade', 'Trading Panel']];
    for (const [id, icon, title] of bottomBtns) {
      const b = el('button', { class: 'rb-btn', title, html: I[icon], dataset: { b: id } });
      b.addEventListener('click', () => this.app.bottom.toggle(id));
      bar.append(b);
    }
    const st = el('div', { id: 'feedStatus', class: 'feed-status', title: 'Connecting…' });
    bar.append(st);
  }
  buildResizer() {
    const rp = $('#rightpanel');
    const h = el('div', { class: 'rp-resize' });
    rp.prepend(h);
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.width;
      const mv = (ev) => { this.width = Math.max(240, Math.min(600, w0 + x0 - ev.clientX)); rp.style.width = this.width + 'px'; this.app.onResize(); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); store.set('rpWidth', this.width); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
    });
  }
  // Re-open the panel that was open last time; called once the charts exist.
  restore() { try { this.show(this.cur); } catch (e) { console.warn(e); this.show('watchlist'); } }
  toggle(id) { this.show(this.cur === id ? null : id); }
  show(id) {
    this.cur = id;
    if (!isMobile()) store.set('rightPanel', id);
    const rp = $('#rightpanel');
    rp.hidden = !id;
    rp.style.width = this.width + 'px';
    $$('#rightbar .rb-btn[data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === id));
    $$('#mobilenav [data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === id));
    document.body.classList.toggle('rp-open', !!id);
    if (id) this.render();
    setTimeout(() => this.app.onResize(), 0);
  }
  refresh(which) { if (which.includes(this.cur)) this.render(); else if (this.cur === 'watchlist' && which.includes('details')) this.renderDetails(); }
  render() {
    const body = $('#rp-body'); body.innerHTML = '';
    this.rows.clear();
    const head = (title, ...btns) => el('div', { class: 'rp-head' }, el('div', { class: 'rp-title' }, title), el('div', { class: 'rp-acts' }, ...btns, el('button', { class: 'icon-btn rp-close', html: I.close, title: 'Close', onclick: () => this.show(null) })));
    const ib = (icon, title, fn) => el('button', { class: 'icon-btn', html: I[icon], title, onclick: (e) => fn(e.currentTarget) });
    switch (this.cur) {
      case 'watchlist': {
        body.append(head('Watchlist', ib('plus', 'Add symbol', () => D.symbolSearch(this.app, (s) => this.addSymbol(s.id))), ib('dots', 'More', (b) => this.wlMenu(b))));
        this.wlEl = el('div', { class: 'wl' }); this.detEl = el('div', { class: 'details' });
        body.append(this.wlEl, el('div', { class: 'det-resize' }), this.detEl);
        this.renderWatchlist(); this.renderDetails();
        break;
      }
      case 'alerts': body.append(head('Alerts', ib('plus', 'Create alert', () => D.alertDialog(this.app)), ib('dots', 'More', (b) => menu(b, [
        { label: 'Stop all alerts', icon: 'pause', onClick: () => { this.app.alerts.forEach((a) => (a.active = false)); this.app.saveAlerts(); } },
        { label: 'Restart all alerts', icon: 'play', onClick: () => { this.app.alerts.forEach((a) => (a.active = true)); this.app.saveAlerts(); } },
        { label: 'Remove all alerts', icon: 'trash', danger: true, onClick: async () => { if (await confirmDlg('Remove all alerts?')) { this.app._alerts = []; this.app.saveAlerts(); } } },
        { label: 'Clear log', icon: 'trash', onClick: () => { this.app._alertLog = []; store.set('alertLog', []); this.render(); } },
      ]))));
        this.renderAlerts(body); break;
      case 'datawindow': body.append(head('Data Window')); this.dwEl = el('div', { class: 'dw' }); body.append(this.dwEl); this.renderDataWindow(); break;
      case 'objtree': body.append(head('Object Tree')); this.renderObjTree(body); break;
      case 'hotlist': body.append(head('Hotlists')); this.hlEl = el('div', { class: 'hl' }); body.append(this.hlEl); this.renderHotlist(); break;
    }
  }

  /* ---------------- watchlist ---------------- */
  saveWl() { store.set('watchlist', this.wl); }
  addSymbol(id, sec) {
    const s = sec || this.wl[this.wl.length - 1] || (this.wl[0] = { name: 'MY LIST', open: true, items: [] });
    if (!this.wl.some((x) => x.items.includes(id))) { s.items.push(id); this.saveWl(); }
    this.renderWatchlist();
  }
  wlMenu(b) {
    menu(b, [
      { label: 'Add section', icon: 'plus', onClick: async () => { const n = await promptText('Section name', 'NEW SECTION'); if (n) { this.wl.push({ name: n.toUpperCase(), open: true, items: [] }); this.saveWl(); this.renderWatchlist(); } } },
      { label: 'Sort by change %', icon: 'chart', onClick: () => { for (const s of this.wl) s.items.sort((a, b) => (hub.quote(b)?.chgPct || 0) - (hub.quote(a)?.chgPct || 0)); this.saveWl(); this.renderWatchlist(); } },
      { label: 'Sort by symbol', icon: 'menu', onClick: () => { for (const s of this.wl) s.items.sort(); this.saveWl(); this.renderWatchlist(); } },
      { label: 'Add all crypto', icon: 'plusCircle', onClick: () => { let sec = this.wl.find((s) => s.name === 'CRYPTO'); if (!sec) this.wl.push(sec = { name: 'CRYPTO', open: true, items: [] }); for (const s of SYMBOLS) if (s.type === 'crypto' && !sec.items.includes(s.id)) sec.items.push(s.id); this.saveWl(); this.renderWatchlist(); } },
      { divider: true },
      { label: 'Reset watchlist', icon: 'trash', danger: true, onClick: () => { this.wl = JSON.parse(JSON.stringify(DEFAULT_WL)); this.saveWl(); this.renderWatchlist(); } },
    ]);
  }
  renderWatchlist() {
    const box = this.wlEl; if (!box) return;
    box.innerHTML = ''; this.rows.clear();
    box.append(el('div', { class: 'wl-hdr' }, el('span', {}, 'Symbol'), el('span', {}, 'Last'), el('span', {}, 'Chg'), el('span', {}, 'Chg%')));
    const activeId = this.app.active?.cfg.symbol;
    this.wl.forEach((sec, si) => {
      const h = el('div', { class: 'wl-sec' + (sec.open ? ' open' : '') }, el('span', { class: 'wl-caret', html: I.chevron }), el('span', {}, sec.name));
      h.addEventListener('click', () => { sec.open = !sec.open; this.saveWl(); this.renderWatchlist(); });
      h.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
          { label: 'Rename section', icon: 'pencil', onClick: async () => { const n = await promptText('Rename section', sec.name); if (n) { sec.name = n.toUpperCase(); this.saveWl(); this.renderWatchlist(); } } },
          { label: 'Add symbol to section', icon: 'plus', onClick: () => D.symbolSearch(this.app, (s) => this.addSymbol(s.id, sec)) },
          { label: 'Remove section', icon: 'trash', danger: true, onClick: () => { this.wl.splice(si, 1); this.saveWl(); this.renderWatchlist(); } },
        ]);
      });
      box.append(h);
      if (!sec.open) return;
      for (const id of sec.items) {
        const s = findSymbol(id); if (!s) continue;
        const last = el('span', { class: 'wl-last' }), chg = el('span', { class: 'wl-chg' }), pct = el('span', { class: 'wl-pct' });
        const row = el('div', { class: 'wl-row' + (id === activeId ? ' active' : ''), draggable: 'true' },
          el('span', { class: 'wl-sym' }, symbolLogo(s, 'sm'), el('span', { class: 'wl-name', title: s.name }, s.symbol), hub.isLive(s) ? el('span', { class: 'dot-live', title: 'Real-time' }) : null),
          last, chg, pct,
          el('button', { class: 'wl-x', title: 'Remove', html: '&times;', onclick: (e) => { e.stopPropagation(); sec.items = sec.items.filter((x) => x !== id); this.saveWl(); this.renderWatchlist(); } }));
        row.addEventListener('click', () => { this.app.active.setSymbol(id); if (this.app.sync.symbol) this.app.widgets.forEach((w) => w !== this.app.active && w.setSymbol(id)); this.app.updateTopbar(); if (isMobile()) this.show(null); });
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          contextMenu(e.clientX, e.clientY, [
            { label: `Open ${s.symbol} chart`, icon: 'chart', onClick: () => this.app.active.setSymbol(id) },
            { label: 'Compare with active chart', icon: 'plusCircle', onClick: () => this.app.active.addCompare(id) },
            { label: 'Add alert', icon: 'alarm', onClick: () => { const prev = this.app.active.cfg.symbol; this.app.active.cfg.symbol = id; D.alertDialog(this.app); this.app.active.cfg.symbol = prev; } },
            { label: 'Trade', icon: 'trade', onClick: () => this.app.bottom.trading.ticket(id, 'buy') },
            { divider: true },
            { label: 'Remove from watchlist', icon: 'trash', danger: true, onClick: () => { sec.items = sec.items.filter((x) => x !== id); this.saveWl(); this.renderWatchlist(); } },
          ]);
        });
        row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ id, si })); });
        row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop'); });
        row.addEventListener('dragleave', () => row.classList.remove('drop'));
        row.addEventListener('drop', (e) => {
          e.preventDefault(); row.classList.remove('drop');
          try {
            const src = JSON.parse(e.dataTransfer.getData('text/plain'));
            const from = this.wl[src.si]; from.items = from.items.filter((x) => x !== src.id);
            const idx = sec.items.indexOf(id); sec.items.splice(idx, 0, src.id); this.saveWl(); this.renderWatchlist();
          } catch { /* */ }
        });
        box.append(row);
        this.rows.set(id, { last, chg, pct, s, row });
        const q = hub.quote(id); if (q) this.paintRow(id, q);
      }
    });
  }
  paintRow(id, q, flash) {
    const r = this.rows.get(id); if (!r) return;
    const prec = symbolPrecision(r.s, q.last);
    const prevTxt = r.last.textContent;
    r.last.textContent = fmtPrice(q.last, prec);
    r.chg.textContent = fmtSigned(q.chg, prec);
    r.pct.textContent = fmtPct(q.chgPct);
    const cls = q.chg >= 0 ? 'up' : 'down';
    r.chg.className = 'wl-chg ' + cls; r.pct.className = 'wl-pct ' + cls;
    if (flash && prevTxt && prevTxt !== r.last.textContent) {
      r.last.classList.remove('flash-up', 'flash-down'); void r.last.offsetWidth;
      r.last.classList.add(q.last >= (r.prev || q.last) ? 'flash-up' : 'flash-down');
    }
    r.prev = q.last;
  }
  onQuote(id, q) {
    if (this.cur === 'watchlist') { this.paintRow(id, q, true); if (id === this.app.active?.cfg.symbol) this.paintDetails(q); }
  }

  /* ---------------- details ---------------- */
  renderDetails() {
    const box = this.detEl; if (!box || !this.app.active) return;
    const s = this.app.active.sym;
    box.innerHTML = '';
    box.append(
      el('div', { class: 'det-top' }, symbolLogo(s, 'lg'),
        el('div', {}, el('div', { class: 'det-sym' }, s.symbol, el('span', { class: 'det-ex' }, ' · ' + s.exchange)), el('div', { class: 'det-name' }, s.name))),
      el('div', { class: 'det-price' }, el('span', { class: 'det-last' }), el('span', { class: 'det-cur' }, s.type === 'crypto' ? 'USDT' : s.type === 'forex' ? '' : 'USD'), el('span', { class: 'det-chg' })),
      el('div', { class: 'det-status' }),
      el('div', { class: 'det-range' }, el('div', { class: 'dr-lbl' }, el('span', { class: 'dr-lo' }), el('span', {}, "DAY'S RANGE"), el('span', { class: 'dr-hi' })), el('div', { class: 'dr-bar' }, el('div', { class: 'dr-fill' }), el('div', { class: 'dr-pin' }))),
      el('div', { class: 'det-grid' }),
      el('div', { class: 'det-perf' }),
      el('div', { class: 'det-rating' }),
    );
    const q = hub.quote(s.id); if (q) this.paintDetails(q);
    this.loadRating(s);
  }
  paintDetails(q) {
    const box = this.detEl; if (!box || !box.querySelector('.det-last')) return;
    const s = this.app.active.sym, prec = symbolPrecision(s, q.last);
    box.querySelector('.det-last').textContent = fmtPrice(q.last, prec);
    const ch = box.querySelector('.det-chg'); ch.textContent = `${fmtSigned(q.chg, prec)}  ${fmtPct(q.chgPct)}`; ch.className = 'det-chg ' + (q.chg >= 0 ? 'up' : 'down');
    const open = q.open_ !== false;
    box.querySelector('.det-status').innerHTML = `<span class="mk ${open ? 'open' : 'closed'}"></span>${open ? (q.live ? 'Market open · Real-time data (Binance)' : 'Market open · Simulated data') : 'Market closed · Simulated data'}`;
    box.querySelector('.dr-lo').textContent = fmtPrice(q.low, prec); box.querySelector('.dr-hi').textContent = fmtPrice(q.high, prec);
    const r = q.high - q.low, pos = r ? (q.last - q.low) / r : 0.5;
    box.querySelector('.dr-pin').style.left = `calc(${(pos * 100).toFixed(1)}% - 4px)`;
    box.querySelector('.dr-fill').style.width = (pos * 100).toFixed(1) + '%';
    box.querySelector('.det-grid').innerHTML = [
      ['Open', fmtPrice(q.open, prec)], [s.type === 'crypto' ? '24h Open' : 'Prev close', fmtPrice(q.prev, prec)], ['Volume', fmtVol(q.vol)], [s.type === 'crypto' ? 'Quote vol' : 'Day high', s.type === 'crypto' ? fmtVol(q.qvol) : fmtPrice(q.high, prec)],
    ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  }
  async loadRating(s) {
    let bars = this.ratingCache.get(s.id);
    if (!bars) { try { bars = await hub.getBars(s, '1d'); this.ratingCache.set(s.id, bars); } catch { return; } }
    if (this.app.active.sym.id !== s.id || !this.detEl) return;
    const r = technicalRating(bars);
    const perf = this.detEl.querySelector('.det-perf'), last = bars[bars.length - 1]?.c;
    const p = (days) => { const t = Date.now() - days * DAY; const b = bars.find((x) => x.t >= t); return b && last ? ((last / b.c - 1) * 100) : NaN; };
    const ytd = (() => { const t = Date.UTC(new Date().getUTCFullYear(), 0, 1); const b = bars.find((x) => x.t >= t); return b && last ? (last / b.o - 1) * 100 : NaN; })();
    if (perf) perf.innerHTML = '<div class="det-h">PERFORMANCE</div><div class="perf-grid">' + [['1W', p(7)], ['1M', p(30)], ['3M', p(91)], ['6M', p(182)], ['YTD', ytd], ['1Y', p(365)]].map(([k, v]) => `<div class="pf ${v >= 0 ? 'up' : 'down'}"><b>${isFinite(v) ? fmtPct(v) : '—'}</b><span>${k}</span></div>`).join('') + '</div>';
    const rt = this.detEl.querySelector('.det-rating');
    if (rt) {
      const ang = -90 + ((r.score + 1) / 2) * 180;
      const col = r.score > 0.1 ? 'var(--up)' : r.score < -0.1 ? 'var(--down)' : 'var(--text2)';
      rt.innerHTML = `<div class="det-h">TECHNICALS (1D)</div><div class="gauge"><svg viewBox="0 0 120 70" width="160" height="92"><path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="var(--border)" stroke-width="8"/><path d="M10 62 A50 50 0 0 1 35 18.7" fill="none" stroke="#F23645" stroke-width="8"/><path d="M85 18.7 A50 50 0 0 1 110 62" fill="none" stroke="#089981" stroke-width="8"/><line x1="60" y1="62" x2="60" y2="20" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round" transform="rotate(${ang.toFixed(1)} 60 62)"/><circle cx="60" cy="62" r="4" fill="var(--text)"/></svg><div class="g-label" style="color:${col}">${r.label}</div><div class="muted sm">MA ${(r.ma * 100).toFixed(0)} · Osc ${(r.osc * 100).toFixed(0)} · RSI ${r.rsi?.toFixed(1) ?? '—'}</div></div>`;
    }
  }

  /* ---------------- alerts ---------------- */
  renderAlerts(body) {
    const list = el('div', { class: 'al-list' });
    const alerts = this.app.alerts;
    if (!alerts.length) list.append(el('div', { class: 'empty' }, el('div', { html: I.alarm }), 'No alerts yet', el('button', { class: 'btn btn-primary sm', onclick: () => D.alertDialog(this.app) }, 'Create alert')));
    for (const a of alerts) {
      const s = findSymbol(a.symbol); if (!s) continue;
      const prec = symbolPrecision(s, a.price);
      const row = el('div', { class: 'al-row' + (a.active ? '' : ' off') },
        el('div', { class: 'al-main' }, el('b', {}, s.symbol), el('span', {}, ` ${condLabel(a.cond)} ${fmtPrice(a.price, prec)}`), a.message ? el('div', { class: 'muted sm' }, a.message) : null,
          el('div', { class: 'muted sm' }, a.active ? 'Active' : a.triggered ? `Triggered ${fmtDateTime(a.lastT, new TimeZone(), true)}` : 'Stopped', a.freq === 'every' ? ' · every time' : ' · once')),
        el('div', { class: 'al-acts' },
          el('button', { class: 'icon-btn', title: a.active ? 'Stop' : 'Restart', html: a.active ? I.pause : I.play, onclick: () => { a.active = !a.active; this.app.saveAlerts(); } }),
          el('button', { class: 'icon-btn', title: 'Edit', html: I.pencil, onclick: () => D.alertDialog(this.app, { edit: a }) }),
          el('button', { class: 'icon-btn', title: 'Remove', html: I.trash, onclick: () => { this.app._alerts = alerts.filter((x) => x !== a); this.app.saveAlerts(); } })));
      row.addEventListener('dblclick', () => this.app.active.setSymbol(a.symbol));
      list.append(row);
    }
    const log = store.get('alertLog', []);
    const logEl = el('div', { class: 'al-log' }, el('div', { class: 'det-h' }, `LOG (${log.length})`));
    for (const l of (this.app._alertLog || log).slice(0, 50)) logEl.append(el('div', { class: 'al-logrow' }, el('span', { class: 'muted sm' }, fmtDateTime(l.t, new TimeZone(), true)), el('span', {}, l.msg)));
    body.append(list, logEl);
  }

  /* ---------------- data window ---------------- */
  renderDataWindow() {
    const box = this.dwEl; if (!box) return;
    const c = this.app.active.chart;
    const i = c.cross ? Math.round(c.cross.idx) : c.disp.length - 1;
    const groups = c.getValuesAt(Math.max(0, Math.min(i, c.disp.length - 1)));
    box.innerHTML = '';
    if (!groups) { box.append(el('div', { class: 'empty' }, 'No data')); return; }
    for (const g of groups) {
      box.append(el('div', { class: 'dw-h' }, g.title));
      for (const r of g.rows) box.append(el('div', { class: 'dw-row' }, el('span', {}, r.name), el('b', { style: r.color ? { color: r.color } : {} }, r.value)));
    }
  }

  /* ---------------- object tree ---------------- */
  renderObjTree(body) {
    const w = this.app.active, c = w.chart;
    const box = el('div', { class: 'ot' });
    box.append(el('div', { class: 'det-h' }, `${c.info.symbol} · ${c.info.ivLabel}`));
    box.append(el('div', { class: 'ot-row main' }, el('span', { html: I.candles }), el('span', {}, 'Main series')));
    if (c.indicators.length) box.append(el('div', { class: 'det-h' }, 'INDICATORS'));
    for (const inst of c.indicators) {
      box.append(el('div', { class: 'ot-row' + (inst.visible ? '' : ' off') }, el('span', { html: I.fx }), el('span', { class: 'ot-name', onclick: () => D.indicatorSettings(w, inst) }, inst.def.name),
        el('button', { class: 'icon-btn', title: 'Visibility', html: inst.visible ? I.eye : I.eyeOff, onclick: () => { inst.visible = !inst.visible; c._buildLegend(); c.render(); w.syncIndicatorCfg(inst); this.render(); } }),
        el('button', { class: 'icon-btn', title: 'Remove', html: I.trash, onclick: () => w.removeIndicator(inst.uid) })));
    }
    const ds = c.drawings.filter((d) => TOOLS[d.type] && !TOOLS[d.type].temp);
    box.append(el('div', { class: 'det-h' }, `DRAWINGS (${ds.length})`));
    if (!ds.length) box.append(el('div', { class: 'muted sm pad' }, 'Drawings you add appear here.'));
    for (const d of ds.slice().reverse()) {
      box.append(el('div', { class: 'ot-row' + (d.hidden ? ' off' : '') + (c.selected === d ? ' sel' : '') }, el('span', { html: I[TOOL_ICON[d.type]] || I.trendline }),
        el('span', { class: 'ot-name', onclick: () => { c.select(d); c.goToTime(d.points[0].t); this.render(); } }, TOOLS[d.type].name + (d.style.text && d.type !== 'emoji' ? ` “${d.style.text.slice(0, 14)}”` : '')),
        el('button', { class: 'icon-btn', title: 'Lock', html: d.locked ? I.lock : I.unlock, onclick: () => { d.locked = !d.locked; c._changed(); } }),
        el('button', { class: 'icon-btn', title: 'Visibility', html: d.hidden ? I.eyeOff : I.eye, onclick: () => { d.hidden = !d.hidden; c._changed(); } }),
        el('button', { class: 'icon-btn', title: 'Remove', html: I.trash, onclick: () => c.removeDrawing(d) })));
    }
    body.append(box);
  }

  /* ---------------- hotlists ---------------- */
  renderHotlist() {
    const box = this.hlEl; if (!box) return;
    this.hlTab ||= 'gainers'; this.hlType ||= 'all';
    box.innerHTML = '';
    const tabs = el('div', { class: 'seg' });
    for (const [id, l] of [['gainers', 'Gainers'], ['losers', 'Losers'], ['active', 'Most active']]) {
      tabs.append(el('button', { class: this.hlTab === id ? 'on' : '', onclick: () => { this.hlTab = id; this.renderHotlist(); } }, l));
    }
    const types = el('select', { class: 'inp sm' }, ...['all', 'stock', 'crypto', 'forex', 'index', 'futures'].map((t) => el('option', { value: t, selected: t === this.hlType }, t === 'all' ? 'All markets' : t)));
    types.addEventListener('change', () => { this.hlType = types.value; this.renderHotlist(); });
    box.append(el('div', { class: 'hl-top' }, tabs, types));
    let list = SYMBOLS.filter((s) => this.hlType === 'all' || s.type === this.hlType).map((s) => ({ s, q: hub.quote(s.id) })).filter((x) => x.q);
    if (this.hlTab === 'gainers') list.sort((a, b) => b.q.chgPct - a.q.chgPct);
    else if (this.hlTab === 'losers') list.sort((a, b) => a.q.chgPct - b.q.chgPct);
    else list.sort((a, b) => (b.q.vol * b.q.last) - (a.q.vol * a.q.last));
    for (const { s, q } of list.slice(0, 25)) {
      const prec = symbolPrecision(s, q.last);
      const row = el('div', { class: 'wl-row' }, el('span', { class: 'wl-sym' }, symbolLogo(s, 'sm'), el('span', { class: 'wl-name' }, s.symbol)),
        el('span', { class: 'wl-last' }, fmtPrice(q.last, prec)), el('span', { class: 'wl-chg' }, this.hlTab === 'active' ? fmtVol(q.vol * q.last) : ''), el('span', { class: 'wl-pct ' + (q.chgPct >= 0 ? 'up' : 'down') }, fmtPct(q.chgPct)));
      row.addEventListener('click', () => this.app.active.setSymbol(s.id));
      box.append(row);
    }
  }
}
void uid; void sources; void ta; void toast;
