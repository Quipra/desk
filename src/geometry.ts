// Exact geometry for the measure tool: where marks cross, and what a mark is.
// Constructions stop being guesswork when the agent can ask instead of squint.

import { arcPoints, shapeVertices, type Item, type Pt } from "./scene.ts";

const EPS = 1e-9;

type Segment = [Pt, Pt];
type Circle = { cx: number; cy: number; r: number; start: number; end: number };

/** Every crossing point between two marks, rounded to a tenth of a unit. */
export function intersections(a: Item, b: Item): Pt[] {
  const out: Pt[] = [];
  const ca = circleOf(a);
  const cb = circleOf(b);
  if (ca && cb) out.push(...circleCircle(ca, cb));
  else if (ca) for (const seg of segmentsOf(b)) out.push(...segmentCircle(seg, ca));
  else if (cb) for (const seg of segmentsOf(a)) out.push(...segmentCircle(seg, cb));
  else for (const sa of segmentsOf(a)) for (const sb of segmentsOf(b)) {
    const p = segmentSegment(sa, sb);
    if (p) out.push(p);
  }
  return dedupe(out.map((p) => ({ x: round(p.x), y: round(p.y) })));
}

/** What the agent would learn by holding a ruler up to one mark. */
export function properties(item: Item) {
  switch (item.kind) {
    case "line": {
      const length = Math.hypot(item.to.x - item.from.x, item.to.y - item.from.y);
      return {
        kind: "line",
        from: item.from,
        to: item.to,
        length: round(length),
        angle: round((Math.atan2(item.to.y - item.from.y, item.to.x - item.from.x) * 180) / Math.PI),
        midpoint: { x: round((item.from.x + item.to.x) / 2), y: round((item.from.y + item.to.y) / 2) },
      };
    }
    case "arc":
      return {
        kind: item.end - item.start >= 360 || item.start - item.end >= 360 ? "circle" : "arc",
        center: { x: round(item.cx), y: round(item.cy) },
        radius: round(item.r),
        start: round(item.start),
        end: round(item.end),
      };
    case "shape": {
      const vertices = shapeVertices(item).map((p) => ({ x: round(p.x), y: round(p.y) }));
      return { kind: item.shape, center: { x: round(item.x), y: round(item.y) }, width: round(item.w), height: round(item.h), rotation: item.rotation, vertices };
    }
    case "stroke": {
      const all = item.paths.flat();
      const first = all[0];
      const last = all[all.length - 1];
      let length = 0;
      for (const path of item.paths) for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      return { kind: "stroke", paths: item.paths.length, points: all.length, start: first ? { x: round(first.x), y: round(first.y) } : null, end: last ? { x: round(last.x), y: round(last.y) } : null, inkLength: round(length) };
    }
  }
}

function circleOf(item: Item): Circle | null {
  return item.kind === "arc" ? { cx: item.cx, cy: item.cy, r: item.r, start: item.start, end: item.end } : null;
}

function segmentsOf(item: Item): Segment[] {
  switch (item.kind) {
    case "line":
      return [[item.from, item.to]];
    case "shape": {
      const v = shapeVertices(item);
      return v.map((p, i) => [p, v[(i + 1) % v.length]] as Segment);
    }
    case "stroke":
      return item.paths.flatMap((path) => path.slice(1).map((p, i) => [path[i], p] as Segment));
    case "arc": {
      const pts = arcPoints(item, 96);
      return pts.slice(1).map((p, i) => [pts[i], p] as Segment);
    }
  }
}

function segmentSegment([p1, p2]: Segment, [p3, p4]: Segment): Pt | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < EPS) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

function segmentCircle([a, b]: Segment, c: Circle): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.cx;
  const fy = a.y - c.cy;
  const A = dx * dx + dy * dy;
  if (A < EPS) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: Pt[] = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t < -EPS || t > 1 + EPS) continue;
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    if (onArc(p, c)) out.push(p);
  }
  return out;
}

function circleCircle(a: Circle, b: Circle): Pt[] {
  const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  if (d < EPS || d > a.r + b.r + EPS || d < Math.abs(a.r - b.r) - EPS) return [];
  const x = (d * d - b.r * b.r + a.r * a.r) / (2 * d);
  const h2 = a.r * a.r - x * x;
  const h = Math.sqrt(Math.max(0, h2));
  const px = a.cx + (x * (b.cx - a.cx)) / d;
  const py = a.cy + (x * (b.cy - a.cy)) / d;
  const rx = (-(b.cy - a.cy) * h) / d;
  const ry = ((b.cx - a.cx) * h) / d;
  const candidates = h < EPS ? [{ x: px, y: py }] : [{ x: px + rx, y: py + ry }, { x: px - rx, y: py - ry }];
  return candidates.filter((p) => onArc(p, a) && onArc(p, b));
}

/** True when a point on the circle lies within the arc's angular span. */
function onArc(p: Pt, c: Circle): boolean {
  const span = c.end - c.start;
  if (Math.abs(span) >= 360 - EPS) return true;
  const ang = (Math.atan2(p.y - c.cy, p.x - c.cx) * 180) / Math.PI;
  const lo = Math.min(c.start, c.end);
  const hi = Math.max(c.start, c.end);
  for (const k of [-720, -360, 0, 360, 720]) {
    const a = ang + k;
    if (a >= lo - 1e-6 && a <= hi + 1e-6) return true;
  }
  return false;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.some((q) => Math.abs(q.x - p.x) < 0.2 && Math.abs(q.y - p.y) < 0.2)) out.push(p);
  return out;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
