// Application dialogs
import { el, $, fmtPrice, fmtPct, store, INTERVALS, intervalById, DAY, MIN, HOUR, WEEK, TIMEZONES, condLabel } from './util.js';
import { SYMBOLS, TYPES, searchSymbols, findSymbol, symbolPrecision, SYMBOL_COLORS, symbolLogo } from './symbols.js';
import { INDICATORS, defaultInputs } from './indicators.js';
import { TOOLS } from './drawings.js';
import { hub } from './datafeed.js';
import { I } from './icons.js';
import { dialog, toast, colorSwatch, switchEl, selectEl, numberEl, formRow, menu } from './ui.js';

/* ---------------------------- Symbol search ---------------------------- */
export function symbolSearch(app, onPick, opts = {}) {
  let type = 'all', sel = 0, results = [];
  const input = el('input', { class: 'inp ss-input', placeholder: 'Symbol, e.g. BTCUSDT, AAPL, EURUSD', autocomplete: 'off', spellcheck: 'false' });
  input.value = opts.initial || '';
  const tabs = el('div', { class: 'ss-tabs' });
  const list = el('div', { class: 'ss-list' });
  for (const t of TYPES) {
    const b = el('button', { class: 'chip' + (t.id === 'all' ? ' on' : '') }, t.label);
    b.addEventListener('click', () => { type = t.id; tabs.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); render(); input.focus(); });
    tabs.append(b);
  }
  const render = () => {
    results = searchSymbols(input.value, type);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.innerHTML = '';
    if (!results.length) { list.append(el('div', { class: 'empty' }, 'No symbols match your criteria')); return; }
    results.forEach((s, i) => {
      const q = hub.quote(s.id);
      const row = el('div', { class: 'ss-row' + (i === sel ? ' sel' : '') },
        symbolLogo(s),
        el('span', { class: 'ss-sym' }, hl(s.symbol, input.value)),
        el('span', { class: 'ss-name' }, s.name),
        el('span', { class: 'ss-px' }, q ? fmtPrice(q.last, symbolPrecision(s, q.last)) : ''),
        el('span', { class: 'ss-type' }, s.type),
        el('span', { class: 'ss-ex' }, s.exchange),
        el('span', { class: 'ss-feed ' + (hub.isLive(s) ? 'live' : 'sim'), title: hub.isLive(s) ? 'Real-time' : 'Simulated' }, hub.isLive(s) ? 'LIVE' : 'SIM'));
      row.addEventListener('click', () => { onPick(s); d.close(); });
      list.append(row);
    });
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { const s = results[sel] || findSymbol(input.value); if (s) { onPick(s); d.close(); } }
  });
  const d = dialog({ title: opts.compare ? 'Compare symbol' : 'Symbol Search', width: 720, cls: 'dlg-search', body: el('div', { class: 'ss' }, el('div', { class: 'ss-top' }, el('span', { class: 'ss-ico', html: I.search }), input), tabs, list) });
  render();
  setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 40);
}
function hl(text, q) {
  const s = el('span'); const u = (q || '').toUpperCase(); const i = u ? text.indexOf(u) : -1;
  if (i < 0) { s.textContent = text; return s; }
  s.append(text.slice(0, i), el('mark', {}, text.slice(i, i + u.length)), text.slice(i + u.length));
  return s;
}

/* ---------------------------- Indicators ---------------------------- */
export function indicatorsDialog(app) {
  const favs = new Set(store.get('favIndicators', ['ema', 'rsi', 'macd', 'bb', 'vol']));
  let cat = 'all';
  const input = el('input', { class: 'inp', placeholder: 'Search', autocomplete: 'off' });
  const side = el('div', { class: 'ind-side' });
  const list = el('div', { class: 'ind-list' });
  const groups = ['Favorites', 'All', ...new Set(INDICATORS.map((d) => d.group)), 'My scripts'];
  for (const g of groups) {
    const b = el('button', { class: 'ind-cat' + (g === 'All' ? ' on' : '') }, g);
    b.addEventListener('click', () => { cat = g.toLowerCase(); side.querySelectorAll('.ind-cat').forEach((x) => x.classList.remove('on')); b.classList.add('on'); render(); });
    side.append(b);
  }
  const render = () => {
    const q = input.value.trim().toLowerCase();
    let defs = INDICATORS.map((d) => ({ def: d, script: false }));
    defs = defs.concat(app.customScripts.map((s) => ({ def: { id: s.id, name: s.name, short: s.name, group: 'My scripts' }, script: true })));
    if (cat === 'favorites') defs = defs.filter((x) => favs.has(x.def.id));
    else if (cat !== 'all') defs = defs.filter((x) => (x.def.group || '').toLowerCase() === cat);
    if (q) defs = defs.filter((x) => x.def.name.toLowerCase().includes(q) || x.def.short.toLowerCase().includes(q));
    list.innerHTML = '';
    if (!defs.length) list.append(el('div', { class: 'empty' }, cat === 'my scripts' ? 'Write a script in the Script Editor (bottom panel) and click “Save” to add it here.' : 'Nothing found'));
    for (const { def, script } of defs) {
      const star = el('button', { class: 'ind-star' + (favs.has(def.id) ? ' on' : ''), html: favs.has(def.id) ? I.starFill : I.star });
      star.addEventListener('click', (e) => { e.stopPropagation(); if (favs.has(def.id)) favs.delete(def.id); else favs.add(def.id); store.set('favIndicators', [...favs]); render(); });
      const row = el('div', { class: 'ind-row' }, star, el('span', { class: 'ind-name' }, def.name), el('span', { class: 'ind-grp' }, def.overlay ? 'overlay' : script ? 'script' : 'pane'));
      row.addEventListener('click', () => {
        const real = app.resolveDef(def.id);
        if (!real) return;
        app.active.addIndicator(real);
        toast(`${real.name} added`, 'success', 1500);
      });
      list.append(row);
    }
  };
  input.addEventListener('input', render);
  dialog({ title: 'Indicators, Metrics & Strategies', width: 760, cls: 'dlg-ind', body: el('div', { class: 'ind' }, el('div', { class: 'ind-search' }, el('span', { html: I.search }), input), el('div', { class: 'ind-main' }, side, list)) });
  render();
}

export function indicatorSettings(w, inst) {
  const def = inst.def, c = w.chart;
  const inputs = { ...inst.inputs };
  const styles = JSON.parse(JSON.stringify(inst.styles));
  const apply = () => { inst.inputs = { ...inputs }; inst.styles = JSON.parse(JSON.stringify(styles)); c.updateIndicator(inst); w.syncIndicatorCfg(inst); };
  const inForm = el('div', { class: 'form' });
  if (!def.inputs.length) inForm.append(el('p', { class: 'muted' }, 'This indicator has no inputs.'));
  for (const inp of def.inputs) {
    let ctrl;
    const set = (v) => { inputs[inp.id] = v; apply(); };
    if (inp.type === 'int' || inp.type === 'float') ctrl = numberEl(inputs[inp.id], (v) => set(inp.type === 'int' ? Math.round(v) : v), { min: inp.min, max: inp.max, step: inp.step || (inp.type === 'int' ? 1 : 0.1) });
    else if (inp.type === 'bool') ctrl = switchEl(inputs[inp.id], set);
    else if (inp.type === 'select') ctrl = selectEl(inp.options, inputs[inp.id], set);
    else if (inp.type === 'source') ctrl = selectEl(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'], inputs[inp.id], set);
    else ctrl = el('input', { class: 'inp', value: inputs[inp.id] });
    inForm.append(formRow(inp.name, ctrl));
  }
  const stForm = el('div', { class: 'form' });
  for (const pl of def.plots) {
    const st = styles[pl.id];
    const vis = switchEl(st.visible, (v) => { st.visible = v; apply(); });
    const col = colorSwatch(st.color, (v) => { st.color = v; apply(); });
    const width = selectEl([1, 2, 3, 4], st.width || 1, (v) => { st.width = +v; apply(); });
    const type = selectEl([{ value: '', label: 'Default' }, 'line', 'step', 'histogram', 'columns', 'circles', 'cross', 'area'], st.type || '', (v) => { st.type = v || undefined; apply(); });
    stForm.append(formRow(pl.name, vis, col, width, type));
  }
  if (def.fills?.length) stForm.append(formRow('Background fills', switchEl(styles._fills !== false, (v) => { styles._fills = v; apply(); })));
  if (def.bands?.length) stForm.append(formRow('Band background', colorSwatch(styles._bandColor || def.bands[0].color, (v) => { styles._bandColor = v; apply(); })));
  const orig = { inputs: { ...inst.inputs }, styles: JSON.parse(JSON.stringify(inst.styles)) };
  dialog({
    title: def.name, width: 480, tabs: [{ label: 'Inputs', body: inForm }, { label: 'Style', body: stForm }],
    buttons: [
      { label: 'Defaults', left: true, onClick: () => { inst.inputs = defaultInputs(def); for (const pl of def.plots) inst.styles[pl.id] = { color: pl.color, width: pl.width || 1, visible: true }; c.updateIndicator(inst); w.syncIndicatorCfg(inst); } },
      { label: 'Cancel', onClick: () => { inst.inputs = orig.inputs; inst.styles = orig.styles; c.updateIndicator(inst); w.syncIndicatorCfg(inst); } },
      { label: 'Ok', primary: true },
    ],
  });
}

/* ---------------------------- Drawing settings ---------------------------- */
export function drawingSettings(w, d) {
  const c = w.chart, tool = TOOLS[d.type]; if (!tool) return;
  const props = tool.props || [];
  const before = JSON.stringify(c._ser(d));
  c.snapshot();
  const upd = (o) => { Object.assign(d.style, o); c.render(); };
  const st = el('div', { class: 'form' });
  if (props.includes('color')) st.append(formRow('Line', colorSwatch(d.style.color, (v) => upd({ color: v })), props.includes('width') ? selectEl([1, 2, 3, 4], d.style.width, (v) => upd({ width: +v })) : null, props.includes('lineStyle') ? selectEl([{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }], d.style.lineStyle, (v) => upd({ lineStyle: v })) : null));
  else if (props.includes('width')) st.append(formRow('Line width', selectEl([1, 2, 3, 4], d.style.width, (v) => upd({ width: +v }))));
  if (props.includes('fill')) st.append(formRow('Background', switchEl(d.style.fillOn, (v) => upd({ fillOn: v })), colorSwatch(d.style.fill, (v) => upd({ fill: v, fillOn: true }))));
  if (props.includes('extend')) st.append(formRow('Extend', el('label', { class: 'chk' }, switchEl(d.style.extendLeft, (v) => upd({ extendLeft: v })), ' Left'), el('label', { class: 'chk' }, switchEl(d.style.extendRight, (v) => upd({ extendRight: v })), ' Right')));
  if (props.includes('labels')) st.append(formRow('Labels', switchEl(d.style.showLabels, (v) => upd({ showLabels: v }))));
  if (props.includes('qty')) st.append(formRow('Quantity', numberEl(d.style.qty, (v) => upd({ qty: v }), { min: 0, step: 'any' })));
  if (props.includes('levels') && d.style.levels) {
    const lv = el('div', { class: 'levels' });
    d.style.levels.forEach((l, i) => {
      const n = el('input', { class: 'inp sm', type: 'number', step: 'any', value: l.v });
      n.addEventListener('input', () => { d.style.levels[i].v = parseFloat(n.value) || 0; c.render(); });
      lv.append(el('div', { class: 'lvl' }, switchEl(l.on, (v) => { d.style.levels[i].on = v; c.render(); }), n, colorSwatch(l.color, (v) => { d.style.levels[i].color = v; c.render(); }, { alpha: false })));
    });
    st.append(el('div', { class: 'flabel' }, 'Levels'), lv);
  }
  if (!st.children.length) st.append(el('p', { class: 'muted' }, 'No style options.'));
  const tx = el('div', { class: 'form' });
  if (props.includes('text')) { const ta = el('textarea', { class: 'inp', rows: 3 }); ta.value = d.style.text || ''; ta.addEventListener('input', () => upd({ text: ta.value })); tx.append(ta); }
  if (props.includes('textColor')) tx.append(formRow('Text color', colorSwatch(d.style.textColor || d.style.color, (v) => upd({ textColor: v }))));
  if (props.includes('fontSize') || props.includes('text')) tx.append(formRow('Font size', selectEl([10, 11, 12, 14, 16, 20, 24, 28, 32, 40, 48], d.style.fontSize, (v) => upd({ fontSize: +v }))));
  if (props.includes('bold')) tx.append(formRow('Bold', switchEl(d.style.bold, (v) => upd({ bold: v }))));
  if (props.includes('bg')) tx.append(formRow('Background', switchEl(d.style.bgOn, (v) => upd({ bgOn: v })), colorSwatch(d.style.bg, (v) => upd({ bg: v, bgOn: true }))));
  const co = el('div', { class: 'form' });
  d.points.forEach((p, i) => {
    const pr = el('input', { class: 'inp', type: 'number', step: 'any', value: +p.p.toFixed(c.info.precision) });
    pr.addEventListener('input', () => { const v = parseFloat(pr.value); if (isFinite(v)) { d.points[i].p = v; c.render(); } });
    const dt = el('input', { class: 'inp', type: 'datetime-local', value: toLocalInput(p.t) });
    dt.addEventListener('change', () => { const t = new Date(dt.value).getTime(); if (isFinite(t)) { d.points[i].t = t; c.render(); } });
    co.append(formRow(`#${i + 1} Price`, pr), formRow(`#${i + 1} Time`, dt));
  });
  const tabs = [{ label: 'Style', body: st }];
  if (tx.children.length) tabs.push({ label: 'Text', body: tx });
  if (d.points.length <= 8) tabs.push({ label: 'Coordinates', body: co });
  dialog({
    title: tool.name, width: 460, tabs,
    buttons: [
      { label: 'Save as default', left: true, onClick: () => { c.lastStyles = { ...(c.lastStyles || {}), [d.type]: { ...d.style } }; for (const x of w.app.widgets) x.chart.lastStyles = c.lastStyles; toast('Default style saved', 'success', 1500); return false; } },
      { label: 'Cancel', onClick: () => { const o = JSON.parse(before); d.style = o.style; d.points = o.points; c.undoStack.pop(); c._changed(); } },
      { label: 'Ok', primary: true, onClick: () => c._changed() },
    ],
  });
}
function toLocalInput(t) { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }

/* ---------------------------- Chart settings ---------------------------- */
export function chartSettings(app) {
  const s = { ...app.active.chart.settings, ...app.settings };
  const set = (o) => app.applySettings(o);
  const sw = (k) => switchEl(s[k], (v) => set({ [k]: v }));
  const cs = (k) => colorSwatch(s[k] || '#2962FF', (v) => set({ [k]: v }));
  const sym = el('div', { class: 'form' },
    el('div', { class: 'fsec' }, 'CANDLES'),
    formRow('Body', sw('showBody'), cs('upColor'), cs('downColor')),
    formRow('Borders', sw('showBorders'), cs('borderUp'), cs('borderDown')),
    formRow('Wick', sw('showWicks'), cs('wickUp'), cs('wickDown')),
    el('div', { class: 'fsec' }, 'LINE / AREA'),
    formRow('Line', cs('lineColor'), selectEl([1, 2, 3, 4], s.lineWidth, (v) => set({ lineWidth: +v }))),
    el('div', { class: 'fsec' }, 'RENKO / LINE BREAK'),
    formRow('Renko box size (0 = ATR)', numberEl(s.renkoBox || 0, (v) => set({ renkoBox: v }), { min: 0, step: 'any' })),
    formRow('Line break lines', numberEl(s.lbLines || 3, (v) => set({ lbLines: Math.max(1, Math.round(v)) }), { min: 1, max: 10 })),
  );
  const status = el('div', { class: 'form' },
    formRow('OHLC values', sw('showOHLC')), formRow('Bar change values', sw('showChange')),
    formRow('Indicator values', sw('showIndValues')), formRow('Indicator inputs', sw('showIndInputs')),
    formRow('Buy/Sell buttons', switchEl(app.settings.tradeButtons !== false, (v) => set({ tradeButtons: v }))),
  );
  const scales = el('div', { class: 'form' },
    formRow('Last price label & line', sw('showLastPrice')), formRow('Countdown to bar close', sw('showCountdown')),
    formRow('Indicator value labels', sw('showIndLabels')), formRow('High / low price labels', sw('showHighLow')),
    formRow('Previous day close line', sw('showPrevClose')),
    formRow('Scale text size', selectEl([10, 11, 12, 13, 14], s.scaleText, (v) => set({ scaleText: +v }))),
    formRow('Time zone', selectEl(TIMEZONES.map((z) => ({ value: z, label: z === 'local' ? 'Local' : z })), s.timezone || 'local', (v) => set({ timezone: v }))),
  );
  const look = el('div', { class: 'form' },
    formRow('Background', switchEl(!!s.bg, (v) => set({ bg: v ? (app.theme === 'dark' ? '#131722' : '#ffffff') : '' })), cs('bg')),
    formRow('Vertical grid lines', sw('gridV')), formRow('Horizontal grid lines', sw('gridH')),
    formRow('Grid color', switchEl(!!s.gridColor, (v) => set({ gridColor: v ? 'rgba(120,123,134,0.15)' : '' })), cs('gridColor')),
    formRow('Crosshair', selectEl([{ value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }, { value: 'solid', label: 'Solid' }], s.crossStyle, (v) => set({ crossStyle: v })), cs('crossColor')),
    formRow('Watermark', sw('watermark')),
    formRow('Right margin (bars)', numberEl(s.rightMargin, (v) => set({ rightMargin: Math.max(0, Math.round(v)) }), { min: 0, max: 200 })),
    formRow('Favorite tools bar', switchEl(app.settings.showFavBar !== false, (v) => { set({ showFavBar: v }); app.renderFavBar(); })),
  );
  dialog({
    title: 'Chart settings', width: 520, tabs: [{ label: 'Symbol', body: sym }, { label: 'Status line', body: status }, { label: 'Scales', body: scales }, { label: 'Appearance', body: look }],
    buttons: [{ label: 'Reset to defaults', left: true, onClick: () => { app.settings = {}; for (const w of app.widgets) { w.chart.settings = { ...w.chart.settings, ...defaultsCopy() }; w.chart.setSettings({}); } app.save(); } }, { label: 'Ok', primary: true }],
  });
}
function defaultsCopy() {
  return { upColor: '#089981', downColor: '#F23645', borderUp: '#089981', borderDown: '#F23645', wickUp: '#089981', wickDown: '#F23645', showBody: true, showBorders: true, showWicks: true, lineColor: '#2962FF', lineWidth: 2, bg: '', gridV: true, gridH: true, gridColor: '', crossStyle: 'dashed', crossColor: '', watermark: true, showLastPrice: true, showCountdown: true, showIndLabels: true, showHighLow: true, showPrevClose: false, showOHLC: true, showChange: true, showIndValues: true, showIndInputs: true, rightMargin: 8, timezone: 'local', scaleText: 11 };
}

/* ---------------------------- Alerts ---------------------------- */
export function alertDialog(app, opts = {}) {
  const w = app.active, edit = opts.edit;
  const sym = findSymbol(edit ? edit.symbol : w.cfg.symbol);
  const q = hub.quote(sym.id);
  const prec = symbolPrecision(sym, q?.last || sym.price);
  const a = edit ? { ...edit } : { symbol: sym.id, cond: 'crossing', price: +(opts.price ?? q?.last ?? w.chart.disp[w.chart.disp.length - 1]?.c ?? sym.price).toFixed(prec), message: '', freq: 'once', sound: true };
  const price = el('input', { class: 'inp', type: 'number', step: 'any', value: a.price });
  price.addEventListener('input', () => { a.price = parseFloat(price.value); });
  const msg = el('textarea', { class: 'inp', rows: 2, placeholder: `${sym.symbol} ${condLabel(a.cond)} ${a.price}` });
  msg.value = a.message || '';
  msg.addEventListener('input', () => { a.message = msg.value; });
  const symSel = selectEl(SYMBOLS.map((s) => ({ value: s.id, label: s.symbol })), a.symbol, (v) => { a.symbol = v; const qq = hub.quote(v); if (qq) { a.price = +qq.last.toFixed(symbolPrecision(findSymbol(v), qq.last)); price.value = a.price; } });
  const body = el('div', { class: 'form' },
    formRow('Symbol', symSel),
    formRow('Condition', selectEl(['crossing', 'crossing_up', 'crossing_down', 'greater', 'less'].map((v) => ({ value: v, label: condLabel(v) })), a.cond, (v) => { a.cond = v; })),
    formRow('Price', price),
    formRow('Trigger', selectEl([{ value: 'once', label: 'Only once' }, { value: 'every', label: 'Every time' }], a.freq, (v) => { a.freq = v; })),
    formRow('Play sound', switchEl(a.sound !== false, (v) => { a.sound = v; })),
    el('label', { class: 'flabel' }, 'Message'), msg,
    el('p', { class: 'muted sm' }, q ? `Current price: ${fmtPrice(q.last, prec)}. Alerts are evaluated in your browser while this page is open; browser notifications are used when permitted.` : ''),
  );
  dialog({
    title: edit ? 'Edit alert' : `Create alert on ${sym.symbol}`, width: 440, body,
    buttons: [{ label: 'Cancel' }, {
      label: edit ? 'Save' : 'Create', primary: true, onClick: () => {
        if (!isFinite(a.price)) { toast('Enter a valid price', 'error'); return false; }
        if (edit) { Object.assign(edit, a, { active: true }); app.saveAlerts(); toast('Alert updated', 'success'); }
        else app.addAlert(a);
      },
    }],
  });
}

/* ---------------------------- Go to date / interval ---------------------------- */
export function gotoDialog(app) {
  const c = app.active.chart;
  const inp = el('input', { class: 'inp', type: 'datetime-local', value: toLocalInput(c.idxT(Math.round(c.xToIdx(c.plotW / 2)))) });
  dialog({
    title: 'Go to', width: 340, body: el('div', { class: 'form' }, formRow('Date & time', inp)),
    buttons: [{ label: 'Cancel' }, {
      label: 'Go to', primary: true, onClick: async () => {
        const t = new Date(inp.value).getTime(); if (!isFinite(t)) return false;
        const w = app.active;
        let guard = 0;
        while (c.bars.length && t < c.bars[0].t && !w.noMore && guard++ < 20) await w.loadMore();
        c.goToTime(t);
      },
    }],
  });
}

export function intervalPrompt(app, initial) {
  const inp = el('input', { class: 'inp big', value: initial, placeholder: 'e.g. 5, 1h, 4h, D, W' });
  const hint = el('div', { class: 'muted sm' });
  const parse = (v) => {
    v = v.trim().toLowerCase(); if (!v) return null;
    const m = v.match(/^(\d+)?\s*([smhdwM]?)$/i); if (!m) return null;
    const n = +(m[1] || 1); let u = m[2] || 'm';
    if (v.endsWith('M')) u = 'M';
    let ms = u === 'h' ? n * HOUR : u === 'd' ? n * DAY : u === 'w' ? n * WEEK : u === 'M' ? n * 30 * DAY : n * MIN;
    if (!m[2] && n >= 60 && n % 60 === 0) ms = (n / 60) * HOUR;
    return INTERVALS.reduce((b, iv) => (Math.abs(iv.ms - ms) < Math.abs(b.ms - ms) ? iv : b));
  };
  const upd = () => { const iv = parse(inp.value); hint.textContent = iv ? `→ ${iv.label}` : 'Unknown interval'; };
  inp.addEventListener('input', upd); upd();
  const d = dialog({ title: 'Change interval', width: 300, body: el('div', { class: 'form' }, inp, hint) });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const iv = parse(inp.value); if (iv) { app.setIntervalActive(iv.id); d.close(); } } });
  setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 30);
  void intervalById;
}

export function shortcutsDialog() {
  const rows = [
    ['Symbol search', 'Start typing / Ctrl+K'], ['Change interval', 'Type a number / ,'], ['Indicators', '/'], ['Trend line', 'Alt+T'], ['Horizontal line', 'Alt+H'], ['Horizontal ray', 'Alt+J'],
    ['Vertical line', 'Alt+V'], ['Cross line', 'Alt+C'], ['Fib retracement', 'Alt+F'], ['Rectangle', 'Alt+X'], ['Brush', 'Alt+B'], ['Path', 'Alt+P'], ['Measure', 'Shift + Click'],
    ['Finish path / polyline', 'Enter or double-click'], ['Cancel drawing', 'Esc'], ['Delete selected drawing', 'Del'], ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Add alert', 'Alt+A'],
    ['Reset chart', 'Alt+R / double-click time axis'], ['Auto-fit price scale', 'Double-click price axis'], ['Invert scale', 'Alt+I'], ['Log scale', 'Alt+L'], ['Go to date', 'Alt+G'],
    ['Snapshot', 'Alt+S'], ['Save layout', 'Ctrl+S'], ['Zoom', 'Mouse wheel / ↑ ↓ / + -'], ['Scroll', '← → / Shift + wheel / drag'], ['Toggle watchlist', 'Alt+W'],
  ];
  dialog({ title: 'Keyboard shortcuts', width: 520, body: el('table', { class: 'tbl kb' }, ...rows.map(([a, b]) => el('tr', {}, el('td', {}, a), el('td', {}, el('kbd', {}, b))))) });
}

void $; void fmtPct; void menu;
