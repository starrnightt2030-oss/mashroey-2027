// Ink engine: smooth strokes (perfect-freehand), drawing, hit-testing.
// Strokes are stored in "page units": every coordinate is divided by the page width,
// so annotations stay in place at any zoom level or screen size.
import { getStroke } from '../vendor/perfect-freehand.mjs';

export const PEN_COLORS = ['#18202B', '#D2421A', '#1D4ED8', '#0E8A5F', '#7C3AED', '#E07B00'];
export const HI_COLORS = ['#F6C445', '#7FD8B5', '#F79AC0', '#8EC5FF'];
export const NOTE_COLORS = [
  { id: 'yellow', hex: '#FFE58A' }, { id: 'blue', hex: '#B8CBF5' }, { id: 'green', hex: '#A9DCC6' }, { id: 'pink', hex: '#F3B6CB' }
];
export const PEN_SIZES = [2.3, 3.6, 5.8];   // px at base width 360
export const HI_SIZES = [12, 18, 26];
export const BASE = 360;

const cache = new WeakMap();

function svgPath(points) {
  if (!points.length) return '';
  const d = points.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
    return acc;
  }, ['M', points[0][0].toFixed(2), points[0][1].toFixed(2), 'Q']);
  d.push('Z');
  return d.join(' ');
}

export function strokeOutline(s, W, live = false) {
  const pts = s.p.map((p) => [p[0] * W, p[1] * W, p[2] ?? 0.5]);
  const size = s.w * W;
  // finger: even, ink-like line · stylus: real pressure for natural thick/thin writing
  const finger = !s.pr;
  const opts = s.t === 'hi'
    ? { size, thinning: 0, smoothing: 0.7, streamline: 0.55, simulatePressure: false, last: !live, start: { cap: true }, end: { cap: true } }
    : { size, thinning: finger ? 0.28 : 0.62, smoothing: 0.62, streamline: 0.4, simulatePressure: finger,
        easing: (t) => Math.sin((t * Math.PI) / 2), start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last: !live };
  return getStroke(pts, opts);
}

export function strokePath(s, W, live = false) {
  if (!live) {
    const c = cache.get(s);
    if (c && c.W === W) return c.path;
  }
  const path = new Path2D(svgPath(strokeOutline(s, W, live)));
  if (!live) cache.set(s, { W, path });
  return path;
}

export function drawStroke(ctx, s, W, live = false) {
  ctx.fillStyle = s.c;
  ctx.globalAlpha = s.t === 'hi' ? 0.42 : 1;
  ctx.fill(strokePath(s, W, live));
  ctx.globalAlpha = 1;
}

// Draw all strokes: highlighter first (under), then pen.
export function drawAll(ctx, strokes, W, live) {
  for (const s of strokes) if (s.t === 'hi') drawStroke(ctx, s, W);
  if (live && live.t === 'hi') drawStroke(ctx, live, W, true);
  for (const s of strokes) if (s.t !== 'hi') drawStroke(ctx, s, W);
  if (live && live.t !== 'hi') drawStroke(ctx, live, W, true);
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

export function hitStroke(s, x, y, r) {
  const rr = r + s.w / 2;
  const p = s.p;
  if (p.length === 1) return Math.hypot(p[0][0] - x, p[0][1] - y) < rr;
  for (let i = 1; i < p.length; i++) {
    if (distSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) < rr) return true;
  }
  return false;
}

// Simplify a freshly drawn stroke to keep storage small.
export function simplify(points, tol = 0.0012) {
  if (points.length < 3) return points;
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) > tol) { out.push(p); last = p; }
  }
  out.push(points[points.length - 1]);
  return out.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5), +(p[2] ?? 0.5).toFixed(2)]);
}

// Wrap text for canvas (RTL aware).
export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

// Paint a text note box onto a canvas (used for export).
export function paintNote(ctx, n, W) {
  const col = NOTE_COLORS.find((c) => c.id === n.c) || NOTE_COLORS[0];
  const bg = { yellow: '#FFF6D6', blue: '#E3ECFF', green: '#DDF3EA', pink: '#FCE4EC' }[col.id];
  const fg = { yellow: '#4A3800', blue: '#1A3478', green: '#0C4A3B', pink: '#7A1F40' }[col.id];
  const fs = W * 0.034;
  ctx.save();
  ctx.font = `${fs}px Plex, Tahoma, sans-serif`;
  ctx.direction = 'rtl';
  const lines = wrapText(ctx, n.text, W * 0.62 - fs * 1.4);
  const lh = fs * 1.6;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + fs * 1.4, bh = lines.length * lh + fs;
  const right = n.x * W, top = n.y * W;
  const left = right - bw;
  ctx.fillStyle = bg; ctx.strokeStyle = col.hex; ctx.lineWidth = Math.max(1, W / 400);
  const r = fs * 0.7;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(left, top, bw, bh, r) : ctx.rect(left, top, bw, bh);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = fg; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, right - fs * 0.7, top + fs * 0.5 + i * lh + (lh - fs) / 2));
  ctx.restore();
}
