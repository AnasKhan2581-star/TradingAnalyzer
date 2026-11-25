// Drawing tools. Each tool renders itself and registers hit primitives into d._hit.
import { fmtPct, hexToRgba } from './util.js';

export const FONT = (s = 13, b = false) => `${b ? '600 ' : ''}${s}px -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif`;

export function applyStroke(ctx, st, color) {
  ctx.strokeStyle = color || st.color;
  ctx.lineWidth = st.width || 1;
  ctx.setLineDash(st.lineStyle === 'dashed' ? [6, 5] : st.lineStyle === 'dotted' ? [1.5, 3.5] : []);
  ctx.lineCap = st.lineStyle === 'dotted' ? 'round' : 'butt';
}
const line = (ctx, a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
export function extendSeg(a, b, c, left, right) {
  let p = { ...a }, q = { ...b };
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6) {
    if (right) q = { x: b.x, y: dy >= 0 ? c.B : c.T };
    if (left) p = { x: a.x, y: dy >= 0 ? c.T : c.B };
    return [p, q];
  }
  const k = dy / dx;
  if (right) { const X = dx > 0 ? c.R : c.L; q = { x: X, y: a.y + k * (X - a.x) }; }
  if (left) { const X = dx > 0 ? c.L : c.R; p = { x: X, y: a.y + k * (X - a.x) }; }
  return [p, q];
}
export function distSeg(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((x - a.x) * dx + (y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
function inPoly(x, y, pts) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}
export function hitDrawing(d, x, y, tol = 6) {
  for (const h of d._hit || []) {
    if (h.seg && distSeg(x, y, h.seg[0], h.seg[1]) < tol) return true;
    if (h.rect) {
      const [rx, ry, rw, rh, filled] = h.rect;
      const x0 = Math.min(rx, rx + rw), x1 = Math.max(rx, rx + rw), y0 = Math.min(ry, ry + rh), y1 = Math.max(ry, ry + rh);
      if (filled) { if (x >= x0 - 3 && x <= x1 + 3 && y >= y0 - 3 && y <= y1 + 3) return true; }
      else if ((x >= x0 - tol && x <= x1 + tol && (Math.abs(y - y0) < tol || Math.abs(y - y1) < tol)) || (y >= y0 - tol && y <= y1 + tol && (Math.abs(x - x0) < tol || Math.abs(x - x1) < tol))) return true;
    }
    if (h.ell) {
      const [cx, cy, rx, ry, filled] = h.ell;
      const v = ((x - cx) / (rx || 1)) ** 2 + ((y - cy) / (ry || 1)) ** 2;
      if (filled ? v <= 1.05 : Math.abs(Math.sqrt(v) - 1) * Math.min(rx, ry) < tol) return true;
    }
    if (h.poly && inPoly(x, y, h.poly)) return true;
    if (h.path) for (let i = 1; i < h.path.length; i++) if (distSeg(x, y, h.path[i - 1], h.path[i]) < tol + (h.w || 0) / 2) return true;
  }
  return false;
}

export function textBox(ctx, text, x, y, o = {}) {
  const fs = o.size || 12;
  ctx.font = FONT(fs, o.bold);
  const lines = String(text).split('\n');
  const pad = o.pad ?? 4, lh = fs * 1.25;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2, h = lines.length * lh + pad * 2 - (lh - fs) ;
  let bx = x, by = y;
  if (o.align === 'center') bx -= w / 2; else if (o.align === 'right') bx -= w;
  if (o.baseline === 'middle') by -= h / 2; else if (o.baseline === 'bottom') by -= h;
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, w, h, o.radius ?? 3); else ctx.rect(bx, by, w, h);
    ctx.fill();
    if (o.border) { ctx.setLineDash([]); ctx.strokeStyle = o.border; ctx.lineWidth = 1; ctx.stroke(); }
  }
  ctx.fillStyle = o.color || '#fff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + i * lh + (lh - fs) / 2 - (lh - fs) / 2));
  return [bx, by, w, h];
}

function arrowHead(ctx, from, to, size = 10, color) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(a - 0.45), to.y - size * Math.sin(a - 0.45));
  ctx.lineTo(to.x - size * Math.cos(a + 0.45), to.y - size * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

const FIB_RET = [
  { v: 0, color: '#787B86', on: true }, { v: 0.236, color: '#F23645', on: true }, { v: 0.382, color: '#FF9800', on: true },
  { v: 0.5, color: '#4CAF50', on: true }, { v: 0.618, color: '#089981', on: true }, { v: 0.786, color: '#00BCD4', on: true },
  { v: 1, color: '#787B86', on: true }, { v: 1.618, color: '#2962FF', on: true }, { v: 2.618, color: '#F23645', on: true },
  { v: 3.618, color: '#9C27B0', on: true }, { v: 4.236, color: '#E91E63', on: true },
];
const FIB_EXT = FIB_RET.map((l) => ({ ...l, on: l.v <= 2.618 }));

const BASE = { color: '#2962FF', width: 2, lineStyle: 'solid', fill: 'rgba(41,98,255,0.15)', fillOn: true, text: '', fontSize: 14, textColor: '', bold: false, extendLeft: false, extendRight: false, showLabels: true };

function lineTool(id, name, ext = {}) {
  return {
    id, name, group: 'lines', n: 2, props: ['color', 'width', 'lineStyle', 'extend', 'text'],
    defaults: { extendLeft: !!ext.left, extendRight: !!ext.right },
    draw(c, d, P) {
      const { ctx } = c, st = d.style;
      const [a, b] = extendSeg(P[0], P[1], c, st.extendLeft, st.extendRight);
      applyStroke(ctx, st); line(ctx, a, b);
      d._hit.push({ seg: [a, b] });
      if (ext.arrow) arrowHead(ctx, P[0], P[1], 8 + st.width * 2, st.color);
      if (st.text) {
        ctx.save(); const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x);
        const m = { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 };
        ctx.translate(m.x, m.y); ctx.rotate(Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang);
        ctx.font = FONT(st.fontSize, st.bold); ctx.fillStyle = st.textColor || st.color; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(st.text, 0, -4); ctx.restore();
      }
      if (ext.info) {
        const dp = d.points[1].p - d.points[0].p, pct = (dp / d.points[0].p) * 100;
        const bars = Math.round(c.idx(d.points[1].t) - c.idx(d.points[0].t));
        const ang = (Math.atan2(-(P[1].y - P[0].y), P[1].x - P[0].x) * 180) / Math.PI;
        const txt = `${c.fmt(dp)} (${fmtPct(pct)})\n${bars} bars, ${c.fmtSpan(bars)}\n∠ ${ang.toFixed(2)}°`;
        textBox(ctx, txt, P[1].x + 8, P[1].y + 8, { bg: c.theme.labelBg, color: c.theme.labelText, size: 12 });
      }
      if (ext.angle) {
        const ang = Math.atan2(-(P[1].y - P[0].y), P[1].x - P[0].x);
        ctx.setLineDash([2, 3]); ctx.lineWidth = 1; line(ctx, P[0], { x: P[0].x + 60, y: P[0].y });
        ctx.beginPath(); ctx.arc(P[0].x, P[0].y, 40, 0, -ang, ang > 0); ctx.stroke();
        ctx.font = FONT(12); ctx.fillStyle = st.color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`${((ang * 180) / Math.PI).toFixed(2)}°`, P[0].x + 64, P[0].y - (ang > 0 ? 10 : -10));
      }
    },
  };
}

function patternTool(id, name, n, labels, opts = {}) {
  return {
    id, name, group: 'patterns', n, props: ['color', 'width', 'fill', 'textColor', 'fontSize'],
    defaults: { color: opts.color || '#2962FF', fill: hexToRgba(opts.color || '#2962FF', 0.15), fillOn: !!opts.fill, fontSize: 12 },
    draw(c, d, P) {
      const { ctx } = c, st = d.style;
      if (opts.fill && st.fillOn) {
        ctx.fillStyle = st.fill;
        for (const tri of opts.fill) {
          if (tri.some((k) => !P[k])) continue;
          ctx.beginPath(); tri.forEach((k, i) => (i ? ctx.lineTo(P[k].x, P[k].y) : ctx.moveTo(P[k].x, P[k].y))); ctx.closePath(); ctx.fill();
          d._hit.push({ poly: tri.map((k) => P[k]) });
        }
      }
      applyStroke(ctx, st);
      ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      d._hit.push({ path: P });
      if (opts.ratios) {
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        for (const [a, b, r1, r2, r3, r4] of opts.ratios) {
          if (!P[a] || !P[b] || !d.points[r4]) continue;
          line(ctx, P[a], P[b]);
          const ratio = Math.abs((d.points[r2].p - d.points[r1].p) / (d.points[r4].p - d.points[r3].p || 1));
          textBox(ctx, ratio.toFixed(3), (P[a].x + P[b].x) / 2, (P[a].y + P[b].y) / 2, { align: 'center', baseline: 'middle', bg: st.color, color: '#fff', size: 11 });
        }
      }
      if (opts.neck && P[opts.neck[1]]) {
        const [a, b] = extendSeg(P[opts.neck[0]], P[opts.neck[1]], c, false, true);
        ctx.setLineDash([5, 4]); line(ctx, a, b);
      }
      ctx.setLineDash([]);
      P.forEach((p, i) => {
        const lbl = labels[i]; if (!lbl) return;
        const prev = P[i - 1] || P[i + 1], next = P[i + 1] || P[i - 1];
        const isHigh = !prev || !next ? p.y < (prev || next).y : p.y <= prev.y && p.y <= next.y ? true : p.y >= prev.y && p.y >= next.y ? false : p.y < prev.y;
        textBox(ctx, lbl, p.x, isHigh ? p.y - 6 : p.y + 6, { align: 'center', baseline: isHigh ? 'bottom' : 'top', bg: st.color, color: st.textColor || '#fff', size: st.fontSize, radius: 3 });
      });
    },
  };
}

function rangeInfo(c, d) {
  const [a, b] = d.points;
  const dp = b.p - a.p, pct = (dp / a.p) * 100, bars = Math.round(c.idx(b.t) - c.idx(a.t));
  return { dp, pct, bars };
}

function posTool(id, name, long) {
  return {
    id, name, group: 'forecast', n: 1, props: ['qty'],
    defaults: { width: 1, qty: 1, profit: 'rgba(8,153,129,0.22)', loss: 'rgba(242,54,69,0.22)' },
    create(pt, c) {
      const r = (c.pRange || pt.p * 0.05);
      const t1 = c.toT(c.toX(pt.t) + 30 * c.spacing);
      return [pt, { t: t1, p: pt.p + (long ? 1 : -1) * r * 0.1 }, { t: t1, p: pt.p - (long ? 1 : -1) * r * 0.05 }];
    },
    handles(c, d, P) { return [P[0], { x: P[0].x, y: P[1].y }, { x: P[0].x, y: P[2].y }, { x: P[1].x, y: P[0].y }]; },
    drag(d, i, pt) {
      const [e, tg, sl] = d.points;
      if (i === 0) { const dp = pt.p - e.p; d.points[0] = pt; tg.p += 0; sl.p += 0; void dp; }
      else if (i === 1) tg.p = pt.p;
      else if (i === 2) sl.p = pt.p;
      else { tg.t = pt.t; sl.t = pt.t; }
    },
    draw(c, d, P) {
      const { ctx } = c, st = d.style;
      const x0 = P[0].x, x1 = Math.max(P[1].x, x0 + 10), yE = P[0].y, yT = P[1].y, yS = P[2].y;
      ctx.fillStyle = st.profit; ctx.fillRect(x0, Math.min(yE, yT), x1 - x0, Math.abs(yT - yE));
      ctx.fillStyle = st.loss; ctx.fillRect(x0, Math.min(yE, yS), x1 - x0, Math.abs(yS - yE));
      d._hit.push({ rect: [x0, Math.min(yT, yS), x1 - x0, Math.abs(yT - yS), true] });
      ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.strokeStyle = '#787B86'; line(ctx, { x: x0, y: yE }, { x: x1, y: yE });
      const [e, tg, sl] = d.points;
      // Live progress: follow price after entry
      const i0 = Math.ceil(c.idx(e.t)), i1 = Math.floor(c.idx(tg.t));
      let hit = 0, exitI = -1;
      for (let i = Math.max(0, i0); i <= Math.min(i1, c.bars.length - 1); i++) {
        const b = c.bars[i];
        if (long ? b.h >= tg.p : b.l <= tg.p) { hit = 1; exitI = i; break; }
        if (long ? b.l <= sl.p : b.h >= sl.p) { hit = -1; exitI = i; break; }
      }
      const lastI = exitI >= 0 ? exitI : Math.min(i1, c.bars.length - 1);
      if (lastI >= i0 && c.bars[lastI]) {
        const px = hit === 1 ? tg.p : hit === -1 ? sl.p : c.bars[lastI].c;
        const xx = c.toX(c.bars[lastI].t), yy = c.toY(px);
        ctx.fillStyle = (long ? px >= e.p : px <= e.p) ? 'rgba(8,153,129,0.35)' : 'rgba(242,54,69,0.35)';
        ctx.fillRect(x0, Math.min(yE, yy), xx - x0, Math.abs(yy - yE));
        ctx.strokeStyle = '#9598A1'; ctx.setLineDash([4, 3]); line(ctx, { x: x0, y: yE }, { x: xx, y: yy }); ctx.setLineDash([]);
      }
      const tp = Math.abs(tg.p - e.p), sp = Math.abs(sl.p - e.p), q = +st.qty || 1;
      const rr = sp ? tp / sp : 0, xm = (x0 + x1) / 2;
      const tTxt = `Target: ${c.fmt(tp)} (${((tp / e.p) * 100).toFixed(2)}%) Amount: ${c.fmt(tp * q)}`;
      const sTxt = `Stop: ${c.fmt(sp)} (${((sp / e.p) * 100).toFixed(2)}%) Amount: ${c.fmt(sp * q)}`;
      const up = (y1, y2) => y1 < y2;
      textBox(ctx, tTxt, xm, yT + (up(yT, yE) ? -4 : 4), { align: 'center', baseline: up(yT, yE) ? 'bottom' : 'top', bg: '#089981', color: '#fff', size: 11 });
      textBox(ctx, sTxt, xm, yS + (up(yS, yE) ? -4 : 4), { align: 'center', baseline: up(yS, yE) ? 'bottom' : 'top', bg: '#F23645', color: '#fff', size: 11 });
      const pnl = hit === 1 ? 'Closed (target)' : hit === -1 ? 'Closed (stop)' : 'Open';
      textBox(ctx, `${long ? 'Long' : 'Short'} · ${pnl}\nRisk/Reward Ratio: ${rr.toFixed(2)}`, xm, yE, { align: 'center', baseline: up(yT, yE) ? 'top' : 'bottom', bg: c.theme.labelBg, color: c.theme.labelText, size: 11 });
    },
    axis: (d) => [{ p: d.points[0].p, color: '#787B86' }, { p: d.points[1].p, color: '#089981' }, { p: d.points[2].p, color: '#F23645' }],
  };
}

function freehand(id, name, highlighter) {
  return {
    id, name, group: 'shapes', n: 0, props: ['color', 'width'],
    defaults: highlighter ? { color: 'rgba(255,235,59,0.35)', width: 14 } : { color: '#2962FF', width: 2 },
    draw(c, d, P) {
      const { ctx } = c, st = d.style;
      applyStroke(ctx, st); ctx.setLineDash([]); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.lineCap = 'butt';
      d._hit.push({ path: P, w: st.width });
    },
    handles: () => [],
  };
}

function markerTool(id, name, draw) {
  return { id, name, group: 'annotation', n: 1, props: ['color', 'text', 'fontSize'], defaults: { color: id === 'arrowdown' ? '#F23645' : id === 'arrowup' ? '#089981' : '#2962FF', fontSize: 12 }, draw };
}

export const TOOLS = {};
const reg = (t) => { TOOLS[t.id] = t; return t; };

// --- Lines ---
reg(lineTool('trendline', 'Trend Line'));
reg(lineTool('ray', 'Ray', { right: true }));
reg(lineTool('extended', 'Extended Line', { left: true, right: true }));
reg(lineTool('infoline', 'Info Line', { info: true }));
reg(lineTool('trendangle', 'Trend Angle', { angle: true }));
reg(lineTool('arrow', 'Arrow', { arrow: true }));
reg({
  id: 'hline', name: 'Horizontal Line', group: 'lines', n: 1, props: ['color', 'width', 'lineStyle', 'text', 'labels'],
  drag(d, i, pt) { d.points[0].p = pt.p; d.points[0].t = pt.t; },
  draw(c, d, P) {
    const { ctx } = c, st = d.style; const y = P[0].y;
    applyStroke(ctx, st); line(ctx, { x: c.L, y }, { x: c.R, y });
    d._hit.push({ seg: [{ x: c.L, y }, { x: c.R, y }] });
    if (st.text) { ctx.font = FONT(st.fontSize, st.bold); ctx.fillStyle = st.textColor || st.color; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(st.text, c.R - 8, y - 3); }
  },
  handles: (c, d, P) => [{ x: Math.min(c.R - 40, Math.max(c.L + 20, P[0].x)), y: P[0].y }],
  axis: (d) => (d.style.showLabels ? [{ p: d.points[0].p, color: d.style.color }] : []),
});
reg({
  id: 'hray', name: 'Horizontal Ray', group: 'lines', n: 1, props: ['color', 'width', 'lineStyle', 'text', 'labels'],
  draw(c, d, P) {
    const { ctx } = c, st = d.style; const y = P[0].y;
    applyStroke(ctx, st); line(ctx, P[0], { x: c.R, y }); d._hit.push({ seg: [P[0], { x: c.R, y }] });
    if (st.text) { ctx.font = FONT(st.fontSize, st.bold); ctx.fillStyle = st.textColor || st.color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(st.text, P[0].x + 6, y - 3); }
  },
  axis: (d) => (d.style.showLabels ? [{ p: d.points[0].p, color: d.style.color }] : []),
});
reg({
  id: 'vline', name: 'Vertical Line', group: 'lines', n: 1, props: ['color', 'width', 'lineStyle', 'labels'],
  draw(c, d, P) { const { ctx } = c, x = P[0].x; applyStroke(ctx, d.style); line(ctx, { x, y: c.T }, { x, y: c.B }); d._hit.push({ seg: [{ x, y: c.T }, { x, y: c.B }] }); },
  handles: (c, d, P) => [{ x: P[0].x, y: (c.T + c.B) / 2 }],
  drag(d, i, pt) { d.points[0].t = pt.t; },
  taxis: (d) => (d.style.showLabels ? [{ t: d.points[0].t, color: d.style.color }] : []),
});
reg({
  id: 'crossline', name: 'Cross Line', group: 'lines', n: 1, props: ['color', 'width', 'lineStyle', 'labels'],
  draw(c, d, P) {
    const { ctx } = c, { x, y } = P[0]; applyStroke(ctx, d.style);
    line(ctx, { x, y: c.T }, { x, y: c.B }); line(ctx, { x: c.L, y }, { x: c.R, y });
    d._hit.push({ seg: [{ x, y: c.T }, { x, y: c.B }] }, { seg: [{ x: c.L, y }, { x: c.R, y }] });
  },
  axis: (d) => (d.style.showLabels ? [{ p: d.points[0].p, color: d.style.color }] : []),
  taxis: (d) => (d.style.showLabels ? [{ t: d.points[0].t, color: d.style.color }] : []),
});
reg({
  id: 'channel', name: 'Parallel Channel', group: 'lines', n: 3, props: ['color', 'width', 'lineStyle', 'fill', 'extend'],
  create3: true,
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    const a = P[0], b = P[1], p2 = P[2] || P[1];
    const k = Math.abs(b.x - a.x) < 1e-6 ? 0 : (b.y - a.y) / (b.x - a.x);
    const off = p2.y - (a.y + k * (p2.x - a.x));
    const a2 = { x: a.x, y: a.y + off }, b2 = { x: b.x, y: b.y + off };
    const [e1, e2] = extendSeg(a, b, c, st.extendLeft, st.extendRight), [f1, f2] = extendSeg(a2, b2, c, st.extendLeft, st.extendRight);
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.beginPath(); ctx.moveTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.lineTo(f2.x, f2.y); ctx.lineTo(f1.x, f1.y); ctx.closePath(); ctx.fill(); }
    applyStroke(ctx, st); line(ctx, e1, e2); line(ctx, f1, f2);
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    const m1 = { x: e1.x, y: (e1.y + f1.y) / 2 }, m2 = { x: e2.x, y: (e2.y + f2.y) / 2 }; line(ctx, m1, m2);
    d._hit.push({ seg: [e1, e2] }, { seg: [f1, f2] }, { poly: [e1, e2, f2, f1] });
  },
});
reg({
  id: 'regression', name: 'Regression Trend', group: 'lines', n: 2, props: ['color', 'width', 'fill'],
  defaults: { fill: 'rgba(41,98,255,0.1)' },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    let i0 = Math.round(c.idx(d.points[0].t)), i1 = Math.round(c.idx(d.points[1].t));
    if (i0 > i1) [i0, i1] = [i1, i0];
    i0 = Math.max(0, i0); i1 = Math.min(c.bars.length - 1, i1);
    const n = i1 - i0 + 1;
    if (n < 2) { applyStroke(ctx, st); line(ctx, P[0], P[1]); d._hit.push({ seg: [P[0], P[1]] }); return; }
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = i0; i <= i1; i++) { const x = i - i0, y = c.bars[i].c; sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), b0 = (sy - m * sx) / n;
    let dev = 0; for (let i = i0; i <= i1; i++) dev += (c.bars[i].c - (b0 + m * (i - i0))) ** 2;
    dev = Math.sqrt(dev / n) * 2;
    const xa = c.toX(c.bars[i0].t), xb = c.toX(c.bars[i1].t);
    const ya = b0, yb = b0 + m * (n - 1);
    const pts = [[0, '#2962FF'], [dev, '#F23645'], [-dev, '#089981']].map(([o]) => [{ x: xa, y: c.toY(ya + o) }, { x: xb, y: c.toY(yb + o) }]);
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.beginPath(); ctx.moveTo(pts[1][0].x, pts[1][0].y); ctx.lineTo(pts[1][1].x, pts[1][1].y); ctx.lineTo(pts[2][1].x, pts[2][1].y); ctx.lineTo(pts[2][0].x, pts[2][0].y); ctx.fill(); }
    applyStroke(ctx, st); line(ctx, ...pts[0]);
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.strokeStyle = st.color; line(ctx, ...pts[1]); line(ctx, ...pts[2]);
    d._hit.push({ seg: pts[0] }, { seg: pts[1] }, { seg: pts[2] });
  },
});
reg({
  id: 'pitchfork', name: 'Pitchfork', group: 'lines', n: 3, props: ['color', 'width', 'lineStyle', 'fill'],
  defaults: { fill: 'rgba(41,98,255,0.08)' },
  draw(c, d, P) {
    const { ctx } = c, st = d.style; const [a, b, cc] = [P[0], P[1], P[2] || P[1]];
    const m = { x: (b.x + cc.x) / 2, y: (b.y + cc.y) / 2 };
    const [s, e] = extendSeg(a, m, c, false, true);
    const dx = e.x - s.x, dy = e.y - s.y;
    const pb = [b, { x: b.x + dx, y: b.y + dy }], pc = [cc, { x: cc.x + dx, y: cc.y + dy }];
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.beginPath(); ctx.moveTo(pb[0].x, pb[0].y); ctx.lineTo(pb[1].x, pb[1].y); ctx.lineTo(pc[1].x, pc[1].y); ctx.lineTo(pc[0].x, pc[0].y); ctx.fill(); }
    applyStroke(ctx, st); line(ctx, s, e); line(ctx, ...pb); line(ctx, ...pc); line(ctx, b, cc);
    d._hit.push({ seg: [s, e] }, { seg: pb }, { seg: pc }, { seg: [b, cc] });
  },
});

// --- Fibonacci & Gann ---
reg({
  id: 'fibretrace', name: 'Fib Retracement', group: 'fib', n: 2, props: ['width', 'lineStyle', 'extend', 'labels', 'levels', 'fill'],
  defaults: { levels: FIB_RET, width: 1, fillOn: true, reverse: false },
  draw(c, d, P) {
    const { ctx } = c, st = d.style; const [p0, p1] = d.points;
    let xa = Math.min(P[0].x, P[1].x), xb = Math.max(P[0].x, P[1].x);
    if (st.extendLeft) xa = c.L; if (st.extendRight) xb = c.R;
    const lv = st.levels.filter((l) => l.on).sort((a, b) => a.v - b.v);
    const ys = lv.map((l) => c.toY(p1.p + (p0.p - p1.p) * l.v));
    if (st.fillOn) for (let i = 1; i < lv.length; i++) { ctx.fillStyle = hexToRgba(lv[i].color, 0.1); ctx.fillRect(xa, ys[i - 1], xb - xa, ys[i] - ys[i - 1]); }
    lv.forEach((l, i) => {
      applyStroke(ctx, st, l.color); line(ctx, { x: xa, y: ys[i] }, { x: xb, y: ys[i] });
      d._hit.push({ seg: [{ x: xa, y: ys[i] }, { x: xb, y: ys[i] }] });
      if (st.showLabels) { ctx.font = FONT(11); ctx.fillStyle = l.color; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`${l.v} (${c.fmt(p1.p + (p0.p - p1.p) * l.v)})`, xa - 4, ys[i]); }
    });
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = '#787B86'; line(ctx, P[0], P[1]);
    d._hit.push({ seg: [P[0], P[1]] });
  },
});
reg({
  id: 'fibext', name: 'Trend-Based Fib Extension', group: 'fib', n: 3, props: ['width', 'lineStyle', 'labels', 'levels', 'fill'],
  defaults: { levels: FIB_EXT, width: 1, fillOn: true },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = '#787B86';
    ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    d._hit.push({ path: P });
    if (P.length < 3) return;
    const [p0, p1, p2] = d.points;
    const xa = Math.min(P[1].x, P[2].x), xb = st.extendRight ? c.R : Math.max(P[2].x, P[1].x) + Math.max(80, Math.abs(P[1].x - P[0].x));
    const lv = st.levels.filter((l) => l.on).sort((a, b) => a.v - b.v);
    const ys = lv.map((l) => c.toY(p2.p + (p1.p - p0.p) * l.v));
    if (st.fillOn) for (let i = 1; i < lv.length; i++) { ctx.fillStyle = hexToRgba(lv[i].color, 0.1); ctx.fillRect(xa, ys[i - 1], xb - xa, ys[i] - ys[i - 1]); }
    lv.forEach((l, i) => {
      applyStroke(ctx, st, l.color); line(ctx, { x: xa, y: ys[i] }, { x: xb, y: ys[i] });
      d._hit.push({ seg: [{ x: xa, y: ys[i] }, { x: xb, y: ys[i] }] });
      if (st.showLabels) { ctx.font = FONT(11); ctx.fillStyle = l.color; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`${l.v} (${c.fmt(p2.p + (p1.p - p0.p) * l.v)})`, xa - 4, ys[i]); }
    });
  },
});
reg({
  id: 'fibtime', name: 'Fib Time Zone', group: 'fib', n: 2, props: ['color', 'width', 'lineStyle', 'labels'],
  defaults: { width: 1, color: '#2962FF' },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, dx = P[1].x - P[0].x;
    const seq = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
    applyStroke(ctx, st);
    for (const k of seq) {
      const x = P[0].x + dx * k; if ((dx > 0 && x > c.R + 1) || (dx < 0 && x < c.L - 1)) break;
      line(ctx, { x, y: c.T }, { x, y: c.B }); d._hit.push({ seg: [{ x, y: c.T }, { x, y: c.B }] });
      if (st.showLabels) { ctx.font = FONT(11); ctx.fillStyle = st.color; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(String(k), x + 3, c.T + 4); }
    }
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; line(ctx, P[0], P[1]);
  },
});
reg({
  id: 'fibfan', name: 'Fib Speed Resistance Fan', group: 'fib', n: 2, props: ['width', 'labels', 'fill'],
  defaults: { width: 1, fillOn: true },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, [a, b] = P;
    const lv = [[0, '#787B86'], [0.25, '#F23645'], [0.382, '#FF9800'], [0.5, '#4CAF50'], [0.618, '#089981'], [0.75, '#00BCD4'], [1, '#787B86']];
    let prev = null;
    for (const [v, col] of lv) {
      const tgt = { x: b.x, y: b.y + (a.y - b.y) * v };
      const [s, e] = extendSeg(a, tgt, c, false, true);
      if (prev && st.fillOn) { ctx.fillStyle = hexToRgba(col, 0.08); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(prev.x, prev.y); ctx.lineTo(e.x, e.y); ctx.closePath(); ctx.fill(); }
      applyStroke(ctx, st, col); line(ctx, s, e); d._hit.push({ seg: [s, e] });
      if (st.showLabels) { ctx.font = FONT(11); ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(String(v), tgt.x + 4, tgt.y); }
      prev = e;
    }
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#787B86'; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  },
});
reg({
  id: 'gannfan', name: 'Gann Fan', group: 'fib', n: 2, props: ['width', 'labels'],
  defaults: { width: 1 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, [a, b] = P, dx = b.x - a.x, dy = b.y - a.y;
    const fans = [['1/8', 1, 8, '#FF9800'], ['1/4', 1, 4, '#089981'], ['1/3', 1, 3, '#4CAF50'], ['1/2', 1, 2, '#00BCD4'], ['1/1', 1, 1, '#2962FF'], ['2/1', 2, 1, '#9C27B0'], ['3/1', 3, 1, '#E91E63'], ['4/1', 4, 1, '#F23645'], ['8/1', 8, 1, '#795548']];
    for (const [lbl, py, px, col] of fans) {
      const tgt = { x: a.x + dx * (px >= py ? 1 : px / py), y: a.y + dy * (py >= px ? 1 : py / px) };
      const t2 = { x: a.x + (dx * px) / Math.max(px, py), y: a.y + (dy * py) / Math.max(px, py) };
      void tgt;
      const [s, e] = extendSeg(a, t2, c, false, true);
      applyStroke(ctx, st, col); line(ctx, s, e); d._hit.push({ seg: [s, e] });
      if (st.showLabels) { ctx.font = FONT(11); ctx.fillStyle = col; ctx.fillText(lbl, t2.x + 3, t2.y); }
    }
  },
});

// --- Patterns ---
reg(patternTool('xabcd', 'XABCD Pattern', 5, ['X', 'A', 'B', 'C', 'D'], { fill: [[0, 1, 2], [2, 3, 4]], ratios: [[0, 2, 1, 2, 0, 1], [1, 3, 2, 3, 1, 2], [2, 4, 3, 4, 2, 3], [0, 4, 1, 4, 0, 1]] }));
reg(patternTool('abcd', 'ABCD Pattern', 4, ['A', 'B', 'C', 'D'], { color: '#089981', ratios: [[0, 2, 1, 2, 0, 1], [1, 3, 2, 3, 1, 2]] }));
reg(patternTool('trianglepat', 'Triangle Pattern', 4, ['A', 'B', 'C', 'D'], { color: '#9C27B0', fill: [[0, 1, 2, 3]] }));
reg(patternTool('hs', 'Head and Shoulders', 7, ['', 'Left Shoulder', '', 'Head', '', 'Right Shoulder', ''], { color: '#089981', fill: [[0, 1, 2], [2, 3, 4], [4, 5, 6]], neck: [2, 4] }));
reg(patternTool('elliott5', 'Elliott Impulse Wave (12345)', 6, ['(0)', '(1)', '(2)', '(3)', '(4)', '(5)'], { color: '#2962FF' }));
reg(patternTool('elliott3', 'Elliott Correction Wave (ABC)', 4, ['(0)', '(A)', '(B)', '(C)'], { color: '#F23645' }));
reg(patternTool('elliotttri', 'Elliott Triangle Wave (ABCDE)', 6, ['(0)', '(A)', '(B)', '(C)', '(D)', '(E)'], { color: '#FF9800' }));
reg(patternTool('elliottwxy', 'Elliott Double Combo (WXY)', 4, ['(0)', '(W)', '(X)', '(Y)'], { color: '#4CAF50' }));
reg(patternTool('threedrives', 'Three Drives Pattern', 7, ['', '1', 'A', '2', 'B', '3', ''], { color: '#E91E63' }));

// --- Forecasting & measurement ---
reg(posTool('long', 'Long Position', true));
reg(posTool('short', 'Short Position', false));
function rangeTool(id, name, mode) {
  return {
    id, name, group: 'forecast', n: 2, props: ['color', 'fill'],
    defaults: { color: '#2962FF', fill: 'rgba(41,98,255,0.15)', width: 1 },
    draw(c, d, P) {
      const { ctx } = c, st = d.style, [a, b] = P;
      const up = d.points[1].p >= d.points[0].p;
      const col = mode === 'measure' ? (up ? '#2962FF' : '#F23645') : st.color;
      const fill = mode === 'measure' ? hexToRgba(col, 0.15) : st.fill;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      if (st.fillOn || mode === 'measure') { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      d._hit.push({ rect: [x, y, w, h, true] });
      ctx.setLineDash([]); ctx.strokeStyle = col; ctx.lineWidth = 1;
      if (mode === 'price' || mode === 'both' || mode === 'measure') { line(ctx, { x, y: a.y }, { x: x + w, y: a.y }); line(ctx, { x, y: b.y }, { x: x + w, y: b.y }); const xm = x + w / 2; line(ctx, { x: xm, y: a.y }, { x: xm, y: b.y }); arrowHead(ctx, { x: xm, y: a.y }, { x: xm, y: b.y }, 8, col); }
      if (mode === 'date' || mode === 'both' || mode === 'measure') { line(ctx, { x: a.x, y }, { x: a.x, y: y + h }); line(ctx, { x: b.x, y }, { x: b.x, y: y + h }); const ym = y + h / 2; line(ctx, { x: a.x, y: ym }, { x: b.x, y: ym }); arrowHead(ctx, { x: a.x, y: ym }, { x: b.x, y: ym }, 8, col); }
      const r = rangeInfo(c, d);
      let vol = 0; const i0 = Math.max(0, Math.round(Math.min(c.idx(d.points[0].t), c.idx(d.points[1].t)))), i1 = Math.min(c.bars.length - 1, Math.round(Math.max(c.idx(d.points[0].t), c.idx(d.points[1].t))));
      for (let i = i0; i <= i1; i++) vol += c.bars[i].v || 0;
      const parts = [];
      if (mode !== 'date') parts.push(`${c.fmt(r.dp)} (${fmtPct(r.pct)})`);
      if (mode !== 'price') parts.push(`${r.bars} bars, ${c.fmtSpan(r.bars)}`);
      if (mode === 'both' || mode === 'measure') parts.push(`Vol ${c.fmtVol(vol)}`);
      const below = b.y >= a.y;
      textBox(ctx, parts.join('\n'), x + w / 2, below ? y + h + 6 : y - 6, { align: 'center', baseline: below ? 'top' : 'bottom', bg: col, color: '#fff', size: 12 });
    },
  };
}
reg(rangeTool('pricerange', 'Price Range', 'price'));
reg(rangeTool('daterange', 'Date Range', 'date'));
reg(rangeTool('datepricerange', 'Date and Price Range', 'both'));
reg({ ...rangeTool('measure', 'Measure', 'measure'), group: 'hidden', temp: true });
reg({
  id: 'zoom', name: 'Zoom In', group: 'hidden', n: 2, temp: true, defaults: {},
  draw(c, d, P) { const { ctx } = c; ctx.fillStyle = 'rgba(41,98,255,0.12)'; ctx.strokeStyle = '#2962FF'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.fillRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); ctx.strokeRect(P[0].x, P[0].y, P[1].x - P[0].x, P[1].y - P[0].y); },
});
reg({
  id: 'projection', name: 'Projection', group: 'forecast', n: 3, props: ['color', 'fill'],
  defaults: { fill: 'rgba(41,98,255,0.12)', width: 1 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    if (P[2]) { ctx.fillStyle = st.fill; ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(P[1].x, P[1].y); ctx.lineTo(P[2].x, P[2].y); ctx.closePath(); ctx.fill(); d._hit.push({ poly: P }); }
    applyStroke(ctx, st); ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    d._hit.push({ path: P });
    if (P[2]) {
      const r = Math.abs((d.points[2].p - d.points[1].p) / ((d.points[1].p - d.points[0].p) || 1));
      textBox(ctx, `${(r * 100).toFixed(1)}%`, P[2].x + 6, P[2].y, { baseline: 'middle', bg: st.color, color: '#fff', size: 11 });
    }
  },
});

// --- Shapes ---
reg(freehand('brush', 'Brush', false));
reg(freehand('highlighter', 'Highlighter', true));
reg({
  id: 'rect', name: 'Rectangle', group: 'shapes', n: 2, props: ['color', 'width', 'lineStyle', 'fill', 'text', 'extend'],
  defaults: { color: '#9C27B0', fill: 'rgba(156,39,176,0.2)', width: 1 },
  handles: (c, d, P) => [P[0], P[1], { x: P[0].x, y: P[1].y }, { x: P[1].x, y: P[0].y }],
  drag(d, i, pt) {
    if (i < 2) d.points[i] = pt;
    else if (i === 2) { d.points[0].t = pt.t; d.points[1].p = pt.p; }
    else { d.points[1].t = pt.t; d.points[0].p = pt.p; }
  },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    let x = Math.min(P[0].x, P[1].x), x2 = Math.max(P[0].x, P[1].x); if (st.extendLeft) x = c.L; if (st.extendRight) x2 = c.R;
    const y = Math.min(P[0].y, P[1].y), h = Math.abs(P[1].y - P[0].y), w = x2 - x;
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.fillRect(x, y, w, h); }
    applyStroke(ctx, st); ctx.strokeRect(x, y, w, h);
    d._hit.push({ rect: [x, y, w, h, st.fillOn] });
    if (st.text) { ctx.font = FONT(st.fontSize, st.bold); ctx.fillStyle = st.textColor || st.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.text, x + w / 2, y + h / 2); }
  },
});
reg({
  id: 'circle', name: 'Circle', group: 'shapes', n: 2, props: ['color', 'width', 'lineStyle', 'fill', 'text'],
  defaults: { color: '#FF9800', fill: 'rgba(255,152,0,0.2)', width: 1 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
    ctx.beginPath(); ctx.arc(P[0].x, P[0].y, r, 0, Math.PI * 2);
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.fill(); }
    applyStroke(ctx, st); ctx.stroke();
    d._hit.push({ ell: [P[0].x, P[0].y, r, r, st.fillOn] });
    if (st.text) { ctx.font = FONT(st.fontSize, st.bold); ctx.fillStyle = st.textColor || st.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.text, P[0].x, P[0].y); }
  },
});
reg({
  id: 'ellipse', name: 'Ellipse', group: 'shapes', n: 2, props: ['color', 'width', 'lineStyle', 'fill', 'text'],
  defaults: { color: '#E91E63', fill: 'rgba(233,30,99,0.2)', width: 1 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    const cx = (P[0].x + P[1].x) / 2, cy = (P[0].y + P[1].y) / 2, rx = Math.abs(P[1].x - P[0].x) / 2, ry = Math.abs(P[1].y - P[0].y) / 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.fill(); }
    applyStroke(ctx, st); ctx.stroke();
    d._hit.push({ ell: [cx, cy, rx, ry, st.fillOn] });
    if (st.text) { ctx.font = FONT(st.fontSize, st.bold); ctx.fillStyle = st.textColor || st.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(st.text, cx, cy); }
  },
});
reg({
  id: 'triangle', name: 'Triangle', group: 'shapes', n: 3, props: ['color', 'width', 'lineStyle', 'fill'],
  defaults: { color: '#089981', fill: 'rgba(8,153,129,0.2)', width: 1 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    if (st.fillOn && P.length > 2) { ctx.fillStyle = st.fill; ctx.fill(); d._hit.push({ poly: P }); }
    applyStroke(ctx, st); ctx.stroke();
    d._hit.push({ path: [...P, P[0]] });
  },
});
reg({
  id: 'path', name: 'Path', group: 'shapes', n: -1, props: ['color', 'width', 'lineStyle'],
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    applyStroke(ctx, st); ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    if (P.length > 1) arrowHead(ctx, P[P.length - 2], P[P.length - 1], 8 + st.width * 2, st.color);
    d._hit.push({ path: P });
  },
});
reg({
  id: 'polyline', name: 'Polyline', group: 'shapes', n: -1, props: ['color', 'width', 'lineStyle', 'fill'],
  defaults: { fillOn: false },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    ctx.beginPath(); P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (st.fillOn && P.length > 2) { ctx.fillStyle = st.fill; ctx.fill(); d._hit.push({ poly: P }); }
    applyStroke(ctx, st); ctx.stroke();
    d._hit.push({ path: P });
  },
});
reg({
  id: 'curve', name: 'Curve', group: 'shapes', n: 3, props: ['color', 'width', 'lineStyle'],
  draw(c, d, P) {
    const { ctx } = c, st = d.style; const [a, cp, b] = [P[0], P[2] ? P[1] : P[1], P[2] || P[1]];
    applyStroke(ctx, st); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cp.x, cp.y, b.x, b.y); ctx.stroke();
    const pts = []; for (let t = 0; t <= 1.001; t += 0.05) pts.push({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cp.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cp.y + t * t * b.y });
    d._hit.push({ path: pts });
  },
});
reg({
  id: 'arc', name: 'Arc', group: 'shapes', n: 3, props: ['color', 'width', 'fill'],
  defaults: { fill: 'rgba(41,98,255,0.15)', width: 1 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style; const [a, b] = P, cc = P[2] || P[1];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const cp = { x: 2 * cc.x - mx, y: 2 * cc.y - my };
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cp.x, cp.y, b.x, b.y); ctx.closePath();
    if (st.fillOn) { ctx.fillStyle = st.fill; ctx.fill(); }
    applyStroke(ctx, st); ctx.stroke();
    const pts = []; for (let t = 0; t <= 1.001; t += 0.05) pts.push({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cp.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cp.y + t * t * b.y });
    d._hit.push({ path: pts }, { poly: pts });
  },
});

// --- Annotation ---
reg({
  id: 'text', name: 'Text', group: 'annotation', n: 1, props: ['textColor', 'fontSize', 'bold', 'text', 'bg'], needsText: true,
  defaults: { text: 'Text', textColor: '#2962FF', fontSize: 16, bgOn: false, bg: 'rgba(41,98,255,0.15)' },
  draw(c, d, P) {
    const st = d.style;
    const r = textBox(c.ctx, st.text || 'Text', P[0].x, P[0].y, { color: st.textColor || st.color, size: st.fontSize, bold: st.bold, bg: st.bgOn ? st.bg : null, baseline: 'bottom', pad: 2 });
    d._hit.push({ rect: [...r, true] });
  },
});
reg({
  id: 'note', name: 'Note', group: 'annotation', n: 1, props: ['textColor', 'fontSize', 'bold', 'text', 'color'], needsText: true,
  defaults: { text: 'Note', color: '#2962FF', textColor: '#ffffff', fontSize: 13 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, p = P[0];
    ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    const r = textBox(ctx, st.text, p.x + 10, p.y - 10, { bg: st.color, color: st.textColor, size: st.fontSize, bold: st.bold, baseline: 'bottom', pad: 6, radius: 4 });
    d._hit.push({ rect: [...r, true] }, { ell: [p.x, p.y, 6, 6, true] });
  },
});
reg({
  id: 'callout', name: 'Callout', group: 'annotation', n: 2, props: ['color', 'textColor', 'fontSize', 'bold', 'text'], needsText: true,
  defaults: { text: 'Callout', color: '#2962FF', textColor: '#ffffff', fontSize: 13 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    ctx.font = FONT(st.fontSize, st.bold);
    const lines = String(st.text).split('\n'); const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16, h = lines.length * st.fontSize * 1.25 + 12;
    const bx = P[1].x - w / 2, by = P[1].y - h / 2;
    ctx.fillStyle = st.color; ctx.beginPath();
    const cx = Math.max(bx + 8, Math.min(bx + w - 8, P[0].x));
    ctx.moveTo(P[0].x, P[0].y); ctx.lineTo(cx - 6, P[0].y < by ? by : by + h); ctx.lineTo(cx + 6, P[0].y < by ? by : by + h); ctx.closePath(); ctx.fill();
    textBox(ctx, st.text, bx, by, { bg: st.color, color: st.textColor, size: st.fontSize, bold: st.bold, pad: 8, radius: 4 });
    d._hit.push({ rect: [bx, by, w, h, true] }, { seg: [P[0], P[1]] });
  },
});
reg({
  id: 'comment', name: 'Comment', group: 'annotation', n: 1, props: ['color', 'textColor', 'fontSize', 'text'], needsText: true,
  defaults: { text: 'Comment', color: '#FF9800', textColor: '#ffffff', fontSize: 13 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, p = P[0];
    const r = textBox(ctx, st.text, p.x, p.y - 10, { bg: st.color, color: st.textColor, size: st.fontSize, pad: 8, radius: 10, baseline: 'bottom' });
    ctx.fillStyle = st.color; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 4, p.y - 12); ctx.lineTo(p.x + 16, p.y - 12); ctx.fill();
    d._hit.push({ rect: [...r, true] });
  },
});
reg({
  id: 'pricelabel', name: 'Price Label', group: 'annotation', n: 1, props: ['color', 'textColor', 'fontSize'],
  defaults: { color: '#2962FF', textColor: '#ffffff', fontSize: 12 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, p = P[0];
    ctx.font = FONT(st.fontSize); const txt = c.fmt(d.points[0].p); const w = ctx.measureText(txt).width + 12, h = st.fontSize + 10;
    ctx.fillStyle = st.color; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 8, p.y - h); ctx.lineTo(p.x + 8 + w, p.y - h); ctx.lineTo(p.x + 8 + w, p.y - 6 ); ctx.lineTo(p.x + 14, p.y - 6); ctx.closePath();
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(p.x + 6, p.y - h - 6, w, h, 3); else ctx.rect(p.x + 6, p.y - h - 6, w, h); ctx.fill();
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 8, p.y - 8); ctx.lineTo(p.x + 16, p.y - 7); ctx.fill();
    ctx.fillStyle = st.textColor; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, p.x + 12, p.y - h / 2 - 6);
    d._hit.push({ rect: [p.x, p.y - h - 6, w + 8, h + 6, true] });
  },
});
reg({
  id: 'pricenote', name: 'Price Note', group: 'annotation', n: 2, props: ['color', 'width', 'fontSize'],
  defaults: { color: '#2962FF', width: 1, fontSize: 12 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style;
    applyStroke(ctx, st); line(ctx, P[0], P[1]);
    ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(P[0].x, P[0].y, 3, 0, Math.PI * 2); ctx.fill();
    const r = textBox(ctx, c.fmt(d.points[0].p), P[1].x, P[1].y, { bg: st.color, color: '#fff', size: st.fontSize, align: 'center', baseline: 'middle', pad: 5 });
    d._hit.push({ seg: [P[0], P[1]] }, { rect: [...r, true] });
  },
});
reg({
  id: 'signpost', name: 'Signpost', group: 'annotation', n: 1, props: ['color', 'textColor', 'fontSize', 'text'], needsText: true,
  defaults: { text: 'Signpost', color: '#2962FF', textColor: '#fff', fontSize: 12 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, p = P[0];
    ctx.strokeStyle = st.color; ctx.lineWidth = 1; ctx.setLineDash([]); line(ctx, p, { x: p.x, y: p.y - 40 });
    const r = textBox(ctx, st.text, p.x, p.y - 40, { bg: st.color, color: st.textColor, size: st.fontSize, align: 'center', baseline: 'bottom', pad: 6, radius: 10 });
    d._hit.push({ rect: [...r, true] }, { seg: [p, { x: p.x, y: p.y - 40 }] });
  },
});
reg(markerTool('arrowup', 'Arrow Mark Up', function (c, d, P) {
  const { ctx } = c, st = d.style, p = P[0];
  ctx.fillStyle = st.color; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 10, p.y + 12); ctx.lineTo(p.x - 4, p.y + 12); ctx.lineTo(p.x - 4, p.y + 26); ctx.lineTo(p.x + 4, p.y + 26); ctx.lineTo(p.x + 4, p.y + 12); ctx.lineTo(p.x + 10, p.y + 12); ctx.closePath(); ctx.fill();
  if (st.text) textBox(ctx, st.text, p.x, p.y + 30, { align: 'center', color: st.color, size: st.fontSize });
  d._hit.push({ rect: [p.x - 10, p.y, 20, 26, true] });
}));
reg(markerTool('arrowdown', 'Arrow Mark Down', function (c, d, P) {
  const { ctx } = c, st = d.style, p = P[0];
  ctx.fillStyle = st.color; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 10, p.y - 12); ctx.lineTo(p.x - 4, p.y - 12); ctx.lineTo(p.x - 4, p.y - 26); ctx.lineTo(p.x + 4, p.y - 26); ctx.lineTo(p.x + 4, p.y - 12); ctx.lineTo(p.x + 10, p.y - 12); ctx.closePath(); ctx.fill();
  if (st.text) textBox(ctx, st.text, p.x, p.y - 30, { align: 'center', baseline: 'bottom', color: st.color, size: st.fontSize });
  d._hit.push({ rect: [p.x - 10, p.y - 26, 20, 26, true] });
}));
reg(markerTool('flag', 'Flag Mark', function (c, d, P) {
  const { ctx } = c, st = d.style, p = P[0];
  ctx.strokeStyle = st.color; ctx.lineWidth = 2; ctx.setLineDash([]); line(ctx, p, { x: p.x, y: p.y - 28 });
  ctx.fillStyle = st.color; ctx.beginPath(); ctx.moveTo(p.x, p.y - 28); ctx.lineTo(p.x + 18, p.y - 22); ctx.lineTo(p.x, p.y - 15); ctx.fill();
  d._hit.push({ rect: [p.x - 2, p.y - 28, 20, 28, true] });
}));
reg({
  id: 'emoji', name: 'Emoji / Sticker', group: 'annotation', n: 1, props: ['fontSize', 'text'], needsEmoji: true,
  defaults: { text: '🚀', fontSize: 32 },
  draw(c, d, P) {
    const { ctx } = c, st = d.style, p = P[0];
    ctx.font = `${st.fontSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(st.text, p.x, p.y);
    d._hit.push({ rect: [p.x - st.fontSize / 2, p.y - st.fontSize / 2, st.fontSize, st.fontSize, true] });
  },
});

for (const t of Object.values(TOOLS)) t.defaults = { ...BASE, ...(t.defaults || {}) };

export const TOOL_GROUPS = [
  { id: 'lines', name: 'Trend line tools', tools: ['trendline', 'ray', 'infoline', 'extended', 'trendangle', 'arrow', 'hline', 'hray', 'vline', 'crossline', 'channel', 'regression', 'pitchfork'] },
  { id: 'fib', name: 'Gann and Fibonacci tools', tools: ['fibretrace', 'fibext', 'fibtime', 'fibfan', 'gannfan'] },
  { id: 'patterns', name: 'Patterns', tools: ['xabcd', 'abcd', 'trianglepat', 'hs', 'threedrives', 'elliott5', 'elliott3', 'elliotttri', 'elliottwxy'] },
  { id: 'forecast', name: 'Prediction and measurement tools', tools: ['long', 'short', 'projection', 'pricerange', 'daterange', 'datepricerange'] },
  { id: 'shapes', name: 'Geometric shapes', tools: ['brush', 'highlighter', 'rect', 'circle', 'ellipse', 'triangle', 'path', 'polyline', 'curve', 'arc'] },
  { id: 'annotation', name: 'Annotation tools', tools: ['text', 'note', 'callout', 'comment', 'pricelabel', 'pricenote', 'signpost', 'arrowup', 'arrowdown', 'flag'] },
];

export const EMOJIS = ['🚀', '🔥', '💰', '📈', '📉', '⚠️', '✅', '❌', '⭐', '💎', '🐂', '🐻', '🎯', '⏰', '🔔', '💡', '👀', '👍', '👎', '😀', '😱', '🤔', '🌙', '⚡'];
