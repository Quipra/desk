// Paper renders the scene to a canvas. Agent marks are revealed progressively
// with a glow so a person can watch the agent draw, then everything settles
// into plain ink. Replay re-reveals every item in order.

import { PAPER_H, PAPER_W, shapeVertices, type Item, type Pen, type Pt, type Scene } from "./scene";

const GLOW_MS = 1400;
const INK_SPEED = 900; // paper units per second
const MIN_MS = 220;
const MAX_MS = 1800;

interface Reveal {
  item: Item;
  start: number;
  duration: number;
}

export class Paper {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scene: Scene;
  scale = 1;
  private dpr = 1;
  private progress = new Map<string, number>();
  private glowUntil = new Map<string, number>();
  private queue: Item[] = [];
  private current: Reveal | null = null;
  private tip: Pt | null = null;
  private raf = 0;
  private idleResolvers: (() => void)[] = [];
  private accent: string;
  /** A temporary item drawn on top while a person is mid-gesture. */
  preview: Item | null = null;
  onActivity: ((active: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, scene: Scene) {
    this.canvas = canvas;
    this.scene = scene;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.accent = getComputedStyle(document.documentElement).getPropertyValue("--agent").trim() || "#5b5bd6";
    scene.on((e) => {
      if (e.type === "add" && e.item.author === "agent") this.enqueue(e.item);
      if (e.type === "remove") for (const id of e.ids) this.forget(id);
      if (e.type === "clear") {
        this.progress.clear();
        this.glowUntil.clear();
        this.queue = [];
        this.current = null;
      }
      this.render();
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    this.scale = Math.min(cw / PAPER_W, ch / PAPER_H);
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.round(PAPER_W * this.scale);
    const h = Math.round(PAPER_H * this.scale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.render();
  }

  /** Convert a pointer event to paper coordinates. */
  toPaper(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  enqueue(item: Item) {
    this.progress.set(item.id, 0);
    this.queue.push(item);
    this.tick();
  }

  private forget(id: string) {
    this.progress.delete(id);
    this.glowUntil.delete(id);
    this.queue = this.queue.filter((i) => i.id !== id);
    if (this.current?.item.id === id) this.current = null;
  }

  /** Re-reveal every item in creation order, as if watching the sheet being drawn. */
  replay() {
    if (this.scene.items.length === 0) return;
    this.queue = [];
    this.current = null;
    for (const item of this.scene.items) this.progress.set(item.id, 0);
    this.queue.push(...this.scene.items);
    this.tick();
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /** Resolves once all queued reveals have finished. */
  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private tick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    if (!this.current && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.current = { item, start: now, duration: durationFor(item) };
      this.onActivity?.(true);
    }
    if (this.current) {
      const { item, start, duration } = this.current;
      const t = Math.min(1, (now - start) / duration);
      this.progress.set(item.id, t);
      this.tip = tipAt(item, t);
      if (t >= 1) {
        this.progress.delete(item.id);
        this.glowUntil.set(item.id, now + GLOW_MS);
        this.current = null;
        this.tip = null;
        if (this.queue.length === 0) {
          this.onActivity?.(false);
          const rs = this.idleResolvers;
          this.idleResolvers = [];
          for (const r of rs) r();
        }
      }
    }
    for (const [id, until] of this.glowUntil) if (until <= now) this.glowUntil.delete(id);
    this.render(now);
    if (this.busy || this.glowUntil.size > 0) this.tick();
  }

  render(now = performance.now()) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, 0, 0);
    this.drawPaper(ctx);
    for (const item of this.scene.items) {
      const t = this.progress.get(item.id) ?? 1;
      if (t <= 0) continue;
      const glowEnd = this.glowUntil.get(item.id);
      const glow = t < 1 ? 1 : glowEnd ? Math.max(0, (glowEnd - now) / GLOW_MS) : 0;
      if (glow > 0) this.drawItem(ctx, item, t, { halo: glow });
      this.drawItem(ctx, item, t);
    }
    if (this.preview) this.drawItem(ctx, this.preview, 1);
    if (this.tip) this.drawTip(ctx, this.tip);
  }

  private drawPaper(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#fcfbf7";
    ctx.fillRect(0, 0, PAPER_W, PAPER_H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(20, 24, 40, 0.07)";
    ctx.beginPath();
    if (this.scene.paper === "grid") {
      for (let x = 50; x < PAPER_W; x += 50) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, PAPER_H);
      }
      for (let y = 50; y < PAPER_H; y += 50) {
        ctx.moveTo(0, y);
        ctx.lineTo(PAPER_W, y);
      }
    } else if (this.scene.paper === "lined") {
      for (let y = 60; y < PAPER_H; y += 40) {
        ctx.moveTo(0, y);
        ctx.lineTo(PAPER_W, y);
      }
    }
    ctx.stroke();
  }

  private drawTip(ctx: CanvasRenderingContext2D, p: Pt) {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
    g.addColorStop(0, withAlpha(this.accent, 0.9));
    g.addColorStop(0.4, withAlpha(this.accent, 0.35));
    g.addColorStop(1, withAlpha(this.accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawItem(ctx: CanvasRenderingContext2D, item: Item, t: number, opts?: { halo: number }) {
    const pen = item.pen;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (opts) {
      ctx.strokeStyle = withAlpha(this.accent, 0.28 * opts.halo);
      ctx.fillStyle = withAlpha(this.accent, 0.28 * opts.halo);
      ctx.lineWidth = pen.width + 10;
    } else {
      ctx.strokeStyle = pen.color;
      ctx.fillStyle = pen.color;
      ctx.globalAlpha = pen.opacity;
      ctx.lineWidth = pen.width;
    }
    switch (item.kind) {
      case "stroke":
        this.drawStroke(ctx, item.points, pen, t, opts ? 10 : 0);
        break;
      case "line": {
        const to = lerp(item.from, item.to, t);
        ctx.beginPath();
        ctx.moveTo(item.from.x, item.from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        if (item.arrow && t >= 1) drawArrowHead(ctx, item.from, item.to, Math.max(10, pen.width * 3));
        break;
      }
      case "arc": {
        const end = item.start + (item.end - item.start) * t;
        ctx.beginPath();
        ctx.arc(item.cx, item.cy, item.r, (item.start * Math.PI) / 180, (end * Math.PI) / 180);
        ctx.stroke();
        break;
      }
      case "shape": {
        const verts = shapeVertices(item);
        drawPartialPolygon(ctx, verts, t);
        break;
      }
      case "text": {
        const n = Math.ceil(item.text.length * t);
        ctx.font = `${item.size}px "Geist Pixel", monospace`;
        ctx.textBaseline = "alphabetic";
        if (opts) {
          ctx.lineWidth = 6;
          ctx.strokeText(item.text.slice(0, n), item.x, item.y);
        }
        ctx.fillText(item.text.slice(0, n), item.x, item.y);
        break;
      }
    }
    ctx.restore();
  }

  private drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[], pen: Pen, t: number, extra: number) {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, widthFor(pen, pts[0].p) / 2 + extra / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const total = (pts.length - 1) * t;
    const whole = Math.floor(total);
    for (let i = 0; i < whole; i++) segment(ctx, pts[i], pts[i + 1], widthFor(pen, pts[i + 1].p) + extra);
    if (whole < pts.length - 1) {
      const frac = total - whole;
      if (frac > 0) segment(ctx, pts[whole], lerp(pts[whole], pts[whole + 1], frac), widthFor(pen, pts[whole + 1].p) + extra);
    }
  }
}

function segment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, width: number) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** How pressure shapes the line for each instrument. Brushes respond most. */
export function widthFor(pen: Pen, pressure = 0.5): number {
  const p = Math.max(0, Math.min(1, pressure));
  switch (pen.kind) {
    case "pencil":
      return pen.width * (0.7 + 0.6 * p);
    case "marker":
      return pen.width * (0.85 + 0.3 * p);
    case "brush":
      return pen.width * (0.25 + 1.5 * p);
  }
}

function drawPartialPolygon(ctx: CanvasRenderingContext2D, verts: Pt[], t: number) {
  const edges: [Pt, Pt][] = verts.map((v, i) => [v, verts[(i + 1) % verts.length]]);
  const lengths = edges.map(([a, b]) => dist(a, b));
  const perimeter = lengths.reduce((s, l) => s + l, 0);
  let remaining = perimeter * t;
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 0; i < edges.length && remaining > 0; i++) {
    const [a, b] = edges[i];
    if (remaining >= lengths[i]) {
      ctx.lineTo(b.x, b.y);
      remaining -= lengths[i];
    } else {
      const p = lerp(a, b, remaining / lengths[i]);
      ctx.lineTo(p.x, p.y);
      remaining = 0;
    }
  }
  if (t >= 1) ctx.closePath();
  ctx.stroke();
}

function drawArrowHead(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, size: number) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(ang - Math.PI / 6), to.y - size * Math.sin(ang - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(ang + Math.PI / 6), to.y - size * Math.sin(ang + Math.PI / 6));
  ctx.stroke();
}

function durationFor(item: Item): number {
  let len = 0;
  switch (item.kind) {
    case "stroke":
      for (let i = 1; i < item.points.length; i++) len += dist(item.points[i - 1], item.points[i]);
      break;
    case "line":
      len = dist(item.from, item.to);
      break;
    case "arc":
      len = (Math.abs(item.end - item.start) / 360) * 2 * Math.PI * item.r;
      break;
    case "shape": {
      const v = shapeVertices(item);
      for (let i = 0; i < v.length; i++) len += dist(v[i], v[(i + 1) % v.length]);
      break;
    }
    case "text":
      len = item.text.length * 40;
      break;
  }
  return Math.max(MIN_MS, Math.min(MAX_MS, (len / INK_SPEED) * 1000));
}

/** Where the pen tip is while an item is being revealed. */
function tipAt(item: Item, t: number): Pt | null {
  switch (item.kind) {
    case "stroke": {
      const pos = (item.points.length - 1) * t;
      const i = Math.min(item.points.length - 2, Math.floor(pos));
      if (item.points.length < 2) return item.points[0] ?? null;
      return lerp(item.points[i], item.points[i + 1], pos - i);
    }
    case "line":
      return lerp(item.from, item.to, t);
    case "arc": {
      const a = ((item.start + (item.end - item.start) * t) * Math.PI) / 180;
      return { x: item.cx + item.r * Math.cos(a), y: item.cy + item.r * Math.sin(a) };
    }
    case "shape": {
      const v = shapeVertices(item);
      const lens = v.map((p, i) => dist(p, v[(i + 1) % v.length]));
      let rem = lens.reduce((s, l) => s + l, 0) * t;
      for (let i = 0; i < v.length; i++) {
        if (rem <= lens[i]) return lerp(v[i], v[(i + 1) % v.length], lens[i] ? rem / lens[i] : 0);
        rem -= lens[i];
      }
      return v[0];
    }
    case "text":
      return { x: item.x + item.text.length * t * item.size * 0.62, y: item.y - item.size * 0.35 };
  }
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
