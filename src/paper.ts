// Paper renders the scene to a canvas. Agent marks are revealed progressively
// with a glow so a person can watch the agent draw, then everything settles
// into plain ink. Replay re-reveals every item in order.
//
// Performance model: settled ink is cached on an offscreen "dried" layer, so a
// frame only redraws the paper, that layer, and whatever is still moving or
// glowing. Reveal durations share a time budget per batch, so a whole
// construct call lands in about two seconds no matter how many marks it has.

import { bbox, clampPt, PAPER_H, PAPER_W, pathPoints, shapeVertices, transformItem, type Item, type Pen, type Pt, type Scene } from "./scene.ts";
import { inkColor, THEMES, type Theme } from "./appearance.ts";
import { poseAt, type Pose } from "./motion.ts";
import { applyGrain, brushFor, stampPath } from "./brush.ts";

const GLOW_MS = 1100;
const INK_SPEED = 1600; // paper units per second, before the batch budget
const MIN_MS = 60;
const MAX_MS = 700;
const BATCH_MS = 2400; // a queue of reveals finishes within about this long
const IDLE_TIMEOUT_MS = 3000;

// The glow is a slow-turning gradient rather than one flat color.
const GLOW: Record<Theme, [string, string, string]> = {
  charcoal: ["#8b8cf0", "#5fd4c8", "#f08cb9"],
  paper: ["#5759ac", "#1f9c90", "#d6608e"],
};

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
  private idleResolvers = new Set<() => void>();
  private _theme: Theme = "charcoal";
  reducedMotion = false;
  /** Offscreen layer holding settled ink. Null where offscreen canvases are unavailable. */
  private dried: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  private driedIds = new Set<string>();
  private driedDirty = true;
  /** Scratch layer for grain-masked strokes, sized on demand. */
  private scratch: CanvasRenderingContext2D | null = null;
  /** The view the dried layer was painted for; while the view moves it is reused, scaled. */
  private driedView = { k: 1, x: 0, y: 0 };
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private boilSeed = 0;
  /** A temporary item drawn on top while a person is mid-gesture. */
  preview: Item | null = null;
  /** Drawn last, in paper coordinates, for selection boxes and pen-tool handles. */
  overlay: ((ctx: CanvasRenderingContext2D, view: { k: number; scale: number }) => void) | null = null;
  onActivity: ((active: boolean) => void) | null = null;
  /** Zoom factor and pan offset in CSS pixels, applied on top of the fit scale. */
  view = { k: 1, x: 0, y: 0 };
  onView: ((view: { k: number; x: number; y: number }) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, scene: Scene) {
    this.canvas = canvas;
    this.scene = scene;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.dried = makeLayer();
    this.scratch = makeLayer()?.ctx ?? null;
    scene.on((e) => {
      if (e.type === "add") {
        if (e.item.author === "agent") this.enqueue(e.item);
        else this.dry(e.item);
      }
      if (e.type === "remove") {
        for (const id of e.ids) this.forget(id);
        this.driedDirty = true;
      }
      if (e.type === "change") {
        for (const id of e.ids) this.glowUntil.set(id, performance.now() + GLOW_MS);
        this.driedDirty = true;
      }
      if (e.type === "motion") {
        this.driedDirty = true;
        if (!this.reducedMotion) this.play({ once: true });
      }
      if (e.type === "clear") {
        this.progress.clear();
        this.glowUntil.clear();
        this.queue = [];
        this.current = null;
        this.tip = null;
        this.driedDirty = true;
        this.playing = false;
        this.time = 0;
        this.finishIfIdle();
      }
      this.render();
      if (e.type === "change" || e.type === "motion") this.tick();
      if (e.type === "timeline" || e.type === "motion") this.onTime?.(this.time, this.playing);
    });
  }

  // Playback
  /** Current timeline position in seconds. */
  time = 0;
  playing = false;
  private playOnce = false;
  private lastTick = 0;
  onTime: ((time: number, playing: boolean) => void) | null = null;

  play(opts: { once?: boolean } = {}) {
    if (!this.scene.animated) return;
    this.playOnce = opts.once === true && !this.scene.timeline.loop;
    if (this.time >= this.scene.timeline.duration - 1e-6) this.time = 0;
    this.playing = true;
    this.lastTick = 0;
    this.tick();
    this.onTime?.(this.time, true);
  }

  pause() {
    this.playing = false;
    this.onTime?.(this.time, false);
    this.render();
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(this.scene.timeline.duration, t));
    this.onTime?.(this.time, this.playing);
    this.render();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  get theme(): Theme {
    return this._theme;
  }

  set theme(t: Theme) {
    if (t === this._theme) return;
    this._theme = t;
    this.driedDirty = true;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const style = getComputedStyle(parent);
    const cw = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const ch = parent.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    this.scale = Math.max(0.01, Math.min(cw / PAPER_W, ch / PAPER_H));
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.round(PAPER_W * this.scale);
    const h = Math.round(PAPER_H * this.scale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this.dried) {
      this.dried.canvas.width = this.canvas.width;
      this.dried.canvas.height = this.canvas.height;
    }
    this.driedDirty = true;
    this.render();
  }

  /** Convert a pointer event to paper coordinates. */
  toPaper(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    const k = this.scale * this.view.k;
    return { x: (e.clientX - r.left - this.view.x) / k, y: (e.clientY - r.top - this.view.y) / k };
  }

  private applyView(ctx: CanvasRenderingContext2D) {
    const k = this.dpr * this.scale * this.view.k;
    ctx.setTransform(k, 0, 0, k, this.dpr * this.view.x, this.dpr * this.view.y);
  }

  /** Zoom about a point given in CSS pixels relative to the canvas. */
  zoomAt(factor: number, cx: number, cy: number) {
    const k = Math.max(0.5, Math.min(8, this.view.k * factor));
    const ratio = k / this.view.k;
    this.setView({ k, x: cx - (cx - this.view.x) * ratio, y: cy - (cy - this.view.y) * ratio });
  }

  panBy(dx: number, dy: number) {
    this.setView({ ...this.view, x: this.view.x + dx, y: this.view.y + dy });
  }

  /** Back to the sheet fitted in the stage. */
  fit() {
    this.setView({ k: 1, x: 0, y: 0 });
  }

  setView(view: { k: number; x: number; y: number }) {
    this.view = view;
    this.onView?.(view);
    // Reuse the dried layer, scaled, while the view is moving; repaint it crisp once it settles.
    if (this.viewTimer !== undefined) clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => {
      this.viewTimer = undefined;
      this.driedDirty = true;
      this.invalidate();
    }, 140);
    this.invalidate();
  }

  /** Ask for a redraw on the next frame; many calls in one frame cost one render. */
  invalidate() {
    this.tick();
  }

  /** Render the sheet alone at a given pixel scale, for PNG export. */
  snapshot(pixelScale = 2): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = Math.round(PAPER_W * pixelScale);
    out.height = Math.round(PAPER_H * pixelScale);
    const ctx = out.getContext("2d")!;
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    this.drawPaper(ctx);
    for (const item of this.scene.items) {
      if (item.hidden) continue;
      if (item.motion) {
        const pose = poseAt(item, this.time);
        this.drawPosed(ctx, item, pose, 1, 1);
      } else this.drawItem(ctx, item, 1);
    }
    return out;
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
    if (this.current?.item.id === id) {
      this.current = null;
      this.tip = null;
    }
    if (this.busy) this.tick();
    else this.finishIfIdle();
  }

  /** Re-reveal every item in creation order, as if watching the sheet being drawn. */
  replay() {
    this.queue = [];
    this.current = null;
    this.tip = null;
    this.driedDirty = true;
    if (this.scene.items.length === 0) {
      this.finishIfIdle();
      return;
    }
    for (const item of this.scene.items) this.progress.set(item.id, 0);
    this.queue.push(...this.scene.items);
    this.tick();
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /**
   * Resolves once queued reveals have finished, or after a timeout. The scene is
   * already final when a mark is added; waiting is only ever cosmetic.
   */
  whenIdle(signal?: AbortSignal, timeoutMs = IDLE_TIMEOUT_MS): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(), timeoutMs);
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.idleResolvers.delete(done);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        this.idleResolvers.delete(done);
        reject(signal?.reason);
      };
      this.idleResolvers.add(done);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  private tick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    if (this.reducedMotion) {
      this.current = null;
      this.queue = [];
      this.progress.clear();
      this.glowUntil.clear();
      this.tip = null;
      this.driedDirty = true;
      this.finishIfIdle();
      this.render(now);
      return;
    }
    if (this.playing) {
      const dt = this.lastTick ? (now - this.lastTick) / 1000 : 0;
      this.lastTick = now;
      const { duration, loop } = this.scene.timeline;
      this.time += dt;
      if (this.time >= duration) {
        if (loop && !this.playOnce) this.time = this.time % Math.max(0.001, duration);
        else {
          this.time = duration;
          this.playing = false;
        }
      }
      this.onTime?.(this.time, this.playing);
    }
    if (!this.current && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.current = { item, start: now, duration: this.durationFor(item) };
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
        if (this.queue.length === 0) this.finishIfIdle();
      }
    }
    for (const [id, until] of this.glowUntil) {
      if (until > now) continue;
      this.glowUntil.delete(id);
      const item = this.scene.get(id);
      if (item) this.dry(item);
    }
    this.render(now);
    if (this.busy || this.glowUntil.size > 0 || this.playing) this.tick();
  }

  /** Natural reveal time, squeezed so the whole queue fits the batch budget. */
  private durationFor(item: Item): number {
    const natural = (i: Item) => Math.max(MIN_MS, Math.min(MAX_MS, (inkLength(i) / INK_SPEED) * 1000));
    const total = natural(item) + this.queue.reduce((s, i) => s + natural(i), 0);
    const factor = Math.min(1, BATCH_MS / total);
    return Math.max(40, natural(item) * factor);
  }

  private finishIfIdle() {
    if (this.busy) return;
    this.onActivity?.(false);
    for (const resolve of this.idleResolvers) resolve();
  }

  /** Paint one settled item onto the dried layer. */
  private dry(item: Item) {
    // Moving marks are drawn every frame; only still ink dries.
    if (!this.dried || this.driedDirty || this.driedIds.has(item.id) || item.motion) return;
    const ctx = this.dried.ctx;
    this.applyView(ctx);
    this.drawItem(ctx, item, 1);
    this.driedIds.add(item.id);
  }

  /** Rebuild the dried layer from every settled item. */
  private rebuildDried() {
    if (!this.dried) return;
    const ctx = this.dried.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.dried.canvas.width, this.dried.canvas.height);
    this.applyView(ctx);
    this.driedIds.clear();
    this.driedView = { ...this.view };
    for (const item of this.scene.items) {
      if (item.hidden) {
        this.driedIds.add(item.id);
        continue;
      }
      if (this.isLive(item.id)) continue;
      this.drawItem(ctx, item, 1);
      this.driedIds.add(item.id);
    }
    this.driedDirty = false;
  }

  private isLive(id: string): boolean {
    if (this.progress.has(id) || this.glowUntil.has(id)) return true;
    const item = this.scene.get(id);
    return !!item?.motion;
  }

  render(now = performance.now()) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyView(ctx);
    this.drawPaper(ctx);
    if (this.dried) {
      if (this.driedDirty && this.viewTimer === undefined) this.rebuildDried();
      const dv = this.driedView;
      const r = this.view.k / dv.k;
      ctx.save();
      ctx.setTransform(r, 0, 0, r, this.dpr * (this.view.x - dv.x * r), this.dpr * (this.view.y - dv.y * r));
      ctx.drawImage(this.dried.canvas, 0, 0);
      ctx.restore();
      this.applyView(ctx);
    }
    const { onion, fps } = this.scene.timeline;
    const showOnion = onion && !this.playing && this.scene.animated && this.time > 0;
    for (const item of this.scene.items) {
      if (item.hidden) continue;
      if (this.dried && this.driedIds.has(item.id)) continue;
      const t = this.progress.get(item.id) ?? 1;
      if (t <= 0) continue;
      const glowEnd = this.glowUntil.get(item.id);
      const glow = t < 1 ? 1 : glowEnd ? Math.max(0, (glowEnd - now) / GLOW_MS) : 0;
      if (item.motion) {
        if (showOnion) this.drawPosed(ctx, item, poseAt(item, this.time - 1 / fps), t, 0.22);
        const pose = poseAt(item, this.time);
        if (glow > 0) this.drawPosed(ctx, item, pose, t, 1, { halo: glow, now });
        this.drawPosed(ctx, item, pose, t, 1);
        continue;
      }
      if (glow > 0) this.drawItem(ctx, item, t, { halo: glow, now });
      this.drawItem(ctx, item, t);
    }
    if (this.preview) this.drawItem(ctx, this.preview, 1);
    if (this.tip) this.drawTip(ctx, this.tip, now);
    if (this.overlay) {
      ctx.save();
      this.overlay(ctx, { k: this.view.k, scale: this.scale });
      ctx.restore();
    }
  }

  /** Draw a mark where its motion puts it at the current time. */
  private drawPosed(ctx: CanvasRenderingContext2D, item: Item, pose: Pose, revealProgress: number, alphaScale: number, opts?: { halo: number; now: number }) {
    const posed = pose.moving ? transformItem(item, pose.transform) : item;
    const alpha = pose.opacity * alphaScale;
    if (alpha <= 0.001) return;
    const boil = item.motion?.boil ? Math.floor(this.time * item.motion.boil) : 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    this.drawItem(ctx, posed, Math.min(revealProgress, pose.reveal), opts, boil);
    ctx.restore();
  }

  /**
   * The sheet, plus a desk grid that keeps the same density at any zoom, the
   * way an infinite canvas does: the spacing steps by 2 as you zoom so the
   * pattern reads the same going in and out.
   */
  private drawPaper(ctx: CanvasRenderingContext2D) {
    const t = THEMES[this._theme];
    const k = this.scale * this.view.k;
    // Visible viewport in paper units.
    const vx = -this.view.x / k;
    const vy = -this.view.y / k;
    const vw = this.canvas.width / this.dpr / k;
    const vh = this.canvas.height / this.dpr / k;
    ctx.fillStyle = t.paper;
    ctx.fillRect(0, 0, PAPER_W, PAPER_H);
    if (this.scene.paper !== "blank") {
      // 50 paper units at 100%; halve or double so cells stay 25..100px on screen.
      let step = 50;
      while (step * k > 100) step /= 2;
      while (step * k < 25) step *= 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, PAPER_W, PAPER_H);
      ctx.clip();
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = t.grid;
      ctx.beginPath();
      const x0 = Math.max(0, Math.floor(vx / step) * step);
      const x1 = Math.min(PAPER_W, vx + vw);
      const y0 = Math.max(0, Math.floor(vy / step) * step);
      const y1 = Math.min(PAPER_H, vy + vh);
      if (this.scene.paper === "grid") for (let x = x0; x <= x1; x += step) {
        ctx.moveTo(x, Math.max(0, vy));
        ctx.lineTo(x, Math.min(PAPER_H, vy + vh));
      }
      for (let y = y0; y <= y1; y += step) {
        ctx.moveTo(Math.max(0, vx), y);
        ctx.lineTo(Math.min(PAPER_W, vx + vw), y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // A hairline edge so the sheet reads as paper on the desk when zoomed out.
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = t.line;
    ctx.strokeRect(0, 0, PAPER_W, PAPER_H);
  }

  /** The pen tip: a bright core inside a soft, slowly shifting bloom. */
  private drawTip(ctx: CanvasRenderingContext2D, p: Pt, now: number) {
    const [a, b, c] = GLOW[this._theme];
    const phase = (now / 1800) % 1;
    const bloom = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
    bloom.addColorStop(0, withAlpha(a, 0.55));
    bloom.addColorStop(0.35 + 0.15 * Math.sin(phase * Math.PI * 2), withAlpha(b, 0.28));
    bloom.addColorStop(0.75, withAlpha(c, 0.12));
    bloom.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();
    const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 6);
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(1, withAlpha(a, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  /** A gradient that slowly turns across the mark's bounds, for halos. */
  private haloStyle(ctx: CanvasRenderingContext2D, item: Item, alpha: number, now: number): CanvasGradient | string {
    const [a, b, c] = GLOW[this._theme];
    if (typeof ctx.createLinearGradient !== "function") return withAlpha(a, alpha);
    const r = bbox(item);
    const ang = (now / 2600) * Math.PI * 2;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const reach = Math.max(40, Math.hypot(r.w, r.h) / 2);
    const g = ctx.createLinearGradient(cx - Math.cos(ang) * reach, cy - Math.sin(ang) * reach, cx + Math.cos(ang) * reach, cy + Math.sin(ang) * reach);
    g.addColorStop(0, withAlpha(a, alpha));
    g.addColorStop(0.5, withAlpha(b, alpha));
    g.addColorStop(1, withAlpha(c, alpha));
    return g;
  }

  private drawItem(ctx: CanvasRenderingContext2D, item: Item, t: number, opts?: { halo: number; now: number }, boil = 0) {
    const pen = item.pen;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    this.boilSeed = boil;
    if (opts) {
      const style = this.haloStyle(ctx, item, 0.34 * opts.halo, opts.now);
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = pen.width + 10;
    } else {
      ctx.strokeStyle = inkColor(pen.color, this._theme);
      ctx.fillStyle = inkColor(pen.color, this._theme);
      ctx.globalAlpha *= pen.opacity;
      ctx.lineWidth = pen.width;
      if (pen.dash) ctx.setLineDash([Math.max(6, pen.width * 3), Math.max(5, pen.width * 2.5)]);
      applyEffects(ctx, pen);
    }
    switch (item.kind) {
      case "stroke":
        if (pen.dash && !opts) {
          // Dashed freehand: a stroked polyline at the pen's base width.
          for (const { points, progress } of pathProgress(item.paths, t)) {
            const pts = revealed(points, progress);
            if (pts.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        } else if (t >= 1) {
          for (const points of item.paths) this.drawStroke(ctx, points, pen, 1, opts ? 10 : 0);
        } else {
          for (const { points, progress } of pathProgress(item.paths, t)) {
            if (progress > 0) this.drawStroke(ctx, points, pen, progress, opts ? 10 : 0);
          }
        }
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
        ctx.arc(item.cx, item.cy, item.r, (item.start * Math.PI) / 180, (end * Math.PI) / 180, item.end < item.start);
        ctx.stroke();
        if (t >= 1 && !opts && Math.abs(item.end - item.start) >= 360) {
          if (pen.fillColor) {
            ctx.beginPath();
            ctx.arc(item.cx, item.cy, item.r, 0, Math.PI * 2);
            this.solidFill(ctx, pen);
            ctx.beginPath();
            ctx.arc(item.cx, item.cy, item.r, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (pen.fill) {
            ctx.beginPath();
            ctx.arc(item.cx, item.cy, item.r, 0, Math.PI * 2);
            this.drawFill(ctx, item, pen, { x: item.cx - item.r, y: item.cy - item.r, w: item.r * 2, h: item.r * 2 });
          }
        }
        break;
      }
      case "shape": {
        const verts = shapeVertices(item);
        if (pen.fillColor && t >= 1 && !opts) {
          ctx.beginPath();
          ctx.moveTo(verts[0].x, verts[0].y);
          for (const v of verts.slice(1)) ctx.lineTo(v.x, v.y);
          ctx.closePath();
          this.solidFill(ctx, pen);
        }
        drawPartialPolygon(ctx, verts, t);
        if (pen.fill && t >= 1 && !opts) {
          ctx.beginPath();
          ctx.moveTo(verts[0].x, verts[0].y);
          for (const v of verts.slice(1)) ctx.lineTo(v.x, v.y);
          ctx.closePath();
          this.drawFill(ctx, item, pen, bbox(item));
        }
        break;
      }
      case "path": {
        if (t >= 1) {
          ctx.beginPath();
          for (const seg of item.segments) {
            if (seg.c === "M") ctx.moveTo(seg.x, seg.y);
            else if (seg.c === "L") ctx.lineTo(seg.x, seg.y);
            else if (seg.c === "C") ctx.bezierCurveTo(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y);
            else if (seg.c === "Q") ctx.quadraticCurveTo(seg.x1, seg.y1, seg.x, seg.y);
            else ctx.closePath();
          }
          if (pen.fillColor && !opts) this.solidFill(ctx, pen);
          ctx.stroke();
          if (pen.fill && !opts) this.drawFill(ctx, item, pen, bbox(item));
        } else {
          // Revealing: the pen travels the flattened path, subpath by subpath.
          for (const { points, progress } of pathProgress(pathPoints(item), t)) {
            const pts = revealed(points, progress);
            if (pts.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
          }
        }
        break;
      }
    }
    ctx.restore();
  }

  /** Fill the current path with the pen's solid fill, keeping the stroke's alpha. */
  private solidFill(ctx: CanvasRenderingContext2D, pen: Pen) {
    ctx.save();
    ctx.fillStyle = inkColor(pen.fillColor === "auto" ? "auto" : pen.fillColor!, this._theme);
    ctx.fill();
    ctx.restore();
  }

  /** Illustrative fills are ink too: hatch lines or stipple dots clipped to the current path. */
  private drawFill(ctx: CanvasRenderingContext2D, item: Item, pen: Pen, b: { x: number; y: number; w: number; h: number }) {
    ctx.save();
    ctx.clip();
    ctx.setLineDash([]);
    ctx.lineWidth = Math.max(0.8, pen.width * 0.45);
    const seed = item.id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
    if (pen.fill === "stipple") {
      const count = Math.min(2500, Math.round((b.w * b.h) / Math.max(12, pen.width * 6)));
      for (let i = 0; i < count; i++) {
        const x = b.x + noise(i * 2, seed) * b.w;
        const y = b.y + noise(i * 2 + 1, seed) * b.h;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, pen.width * 0.25) * (0.6 + noise(i, seed + 1)), 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const spacing = Math.max(6, pen.width * 3.5);
      const angles = pen.fill === "crosshatch" ? [pen.hatchAngle ?? 45, (pen.hatchAngle ?? 45) + 90] : [pen.hatchAngle ?? 45];
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const reach = Math.hypot(b.w, b.h) / 2 + spacing;
      for (const deg of angles) {
        const a = (deg * Math.PI) / 180;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        ctx.beginPath();
        for (let o = -reach; o <= reach; o += spacing) {
          const ox = cx - dy * o;
          const oy = cy + dx * o;
          ctx.moveTo(ox - dx * reach, oy - dy * reach);
          ctx.lineTo(ox + dx * reach, oy + dy * reach);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Strokes are filled ribbons so width can vary smoothly with pressure. */
  /**
   * Freehand ink. The fineliner is a crisp vector ribbon; every other pen is a
   * stamp brush: a tip laid along the path with pressure driving size and
   * flow, masked by paper grain where the kind calls for it. Halos stay ribbons.
   */
  private drawStroke(ctx: CanvasRenderingContext2D, all: Pt[], pen: Pen, t: number, extra: number) {
    if (extra || pen.kind === "fineliner") {
      this.drawRibbon(ctx, all, pen, t, extra);
      return;
    }
    const pts = revealed(all, t);
    if (pts.length === 0) return;
    const def = brushFor(pen);
    const color = inkColor(pen.color, this._theme);
    const alpha = ctx.globalAlpha;
    const taper = pen.taper ? 36 : 0;
    if (def.grain > 0.02 && this.scratch) {
      // Stamp into a scratch layer in device space, mask it with grain, composite once.
      const m = ctx.getTransform();
      const pad = pen.width * 2 + 4;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        x0 = Math.min(x0, p.x - pad); y0 = Math.min(y0, p.y - pad);
        x1 = Math.max(x1, p.x + pad); y1 = Math.max(y1, p.y + pad);
      }
      const corners = [m.transformPoint({ x: x0, y: y0 }), m.transformPoint({ x: x1, y: y1 })];
      const rx = Math.max(0, Math.floor(Math.min(corners[0].x, corners[1].x)));
      const ry = Math.max(0, Math.floor(Math.min(corners[0].y, corners[1].y)));
      const rw = Math.min(this.canvas.width, Math.ceil(Math.max(corners[0].x, corners[1].x))) - rx;
      const rh = Math.min(this.canvas.height, Math.ceil(Math.max(corners[0].y, corners[1].y))) - ry;
      if (rw <= 0 || rh <= 0) return;
      const layer = this.scratch;
      if (layer.canvas.width < rw || layer.canvas.height < rh) {
        layer.canvas.width = Math.max(layer.canvas.width, rw);
        layer.canvas.height = Math.max(layer.canvas.height, rh);
      }
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, rw, rh);
      const local = new DOMMatrix([m.a, m.b, m.c, m.d, m.e - rx, m.f - ry]);
      layer.setTransform(local);
      const ok = stampPath(layer, pts, pen, { color, opacity: 1, boil: this.boilSeed, taper, def: { ...def, multiply: false } });
      if (!ok) {
        this.drawRibbon(ctx, all, pen, t, extra);
        return;
      }
      applyGrain(layer, def.grain, local, this.boilSeed);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      if (def.multiply) ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(layer.canvas, 0, 0, rw, rh, rx, ry, rw, rh);
      ctx.restore();
      return;
    }
    const ok = stampPath(ctx, pts, pen, { color, opacity: alpha, boil: this.boilSeed, taper, def });
    if (!ok) this.drawRibbon(ctx, all, pen, t, extra);
    ctx.globalAlpha = alpha;
  }

  private drawRibbon(ctx: CanvasRenderingContext2D, all: Pt[], pen: Pen, t: number, extra: number) {
    const pts = revealed(all, t);
    if (pts.length === 0) return;
    const n = pts.length;
    const taperLen = pen.taper ? Math.max(2, Math.min(14, Math.floor(n / 3))) : 0;
    // Boil re-seeds the texture a few times a second, the shimmer of drawn animation.
    const grain = (pen.texture === "grain" || (this.boilSeed > 0 && pen.kind !== "fineliner")) && !extra;
    const seed = Math.round(pts[0].x + pts[0].y) + this.boilSeed * 101;
    const half = (i: number) => {
      let w = widthFor(pen, pts[i].p) / 2 + extra / 2;
      if (taperLen) w *= Math.min(1, (i + 1) / taperLen, (n - i) / taperLen);
      if (grain) w *= 0.8 + 0.4 * noise(i, seed);
      return Math.max(0.3, w);
    };
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, half(0), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const w = half(i);
      const g = grain ? (noise(i * 7, 3 + seed) - 0.5) * w : 0;
      left.push({ x: pts[i].x + nx * (w + g), y: pts[i].y + ny * (w + g) });
      right.push({ x: pts[i].x - nx * (w - g), y: pts[i].y - ny * (w - g) });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fill();
    // Round joints at every point hide the spikes a ribbon grows at sharp turns,
    // and give the ends their caps. Grain keeps its broken edge on purpose.
    if (!grain) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const r = half(i);
        ctx.moveTo(pts[i].x + r, pts[i].y);
        ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, half(0), 0, Math.PI * 2);
      ctx.arc(pts[n - 1].x, pts[n - 1].y, half(n - 1), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Shadow, glow and blur for one mark. Canvas shadows and filters are measured in
 * device pixels while the context is transformed into paper units, so every size
 * is scaled by the current transform. There is only one shadow slot, so a glow
 * takes it over from a drop shadow when a pen asks for both.
 */
function applyEffects(ctx: CanvasRenderingContext2D, pen: Pen) {
  if (!pen.shadow && !pen.glow && !pen.blur) return;
  const s = typeof ctx.getTransform === "function" ? ctx.getTransform().a || 1 : 1;
  if (pen.shadow) {
    ctx.shadowOffsetX = pen.shadow.dx * s;
    ctx.shadowOffsetY = pen.shadow.dy * s;
    ctx.shadowBlur = pen.shadow.blur * s;
    ctx.shadowColor = pen.shadow.color;
  }
  if (pen.glow) {
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowBlur = pen.glow.blur * s;
    ctx.shadowColor = pen.glow.color;
  }
  // Older canvases have no filter support; the mark still draws, just unblurred.
  if (pen.blur && "filter" in ctx) ctx.filter = `blur(${pen.blur * s}px)`;
}

/** An offscreen canvas for dried ink, when the environment can make one. */
function makeLayer(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

/** The prefix of a point list visible at reveal progress t, ending on an interpolated point. */
function revealed(pts: Pt[], t: number): Pt[] {
  if (t >= 1 || pts.length < 2) return pts;
  const total = (pts.length - 1) * t;
  const whole = Math.floor(total);
  const out = pts.slice(0, whole + 1);
  const frac = total - whole;
  if (frac > 0 && whole < pts.length - 1) {
    const a = pts[whole];
    const b = pts[whole + 1];
    out.push({ ...lerp(a, b, frac), p: (a.p ?? 0.5) + ((b.p ?? 0.5) - (a.p ?? 0.5)) * frac });
  }
  return out;
}

/**
 * Agents give sparse points; a hand gives hundreds. Pass sparse strokes through a
 * Catmull-Rom curve so they bend like a pen moved, not a polyline.
 */
export function smooth(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  let spacing = 0;
  for (let i = 1; i < pts.length; i++) spacing += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  spacing /= pts.length - 1;
  if (spacing < 6) return pts;
  const out: Pt[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const steps = Math.max(2, Math.min(24, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 4)));
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const u2 = u * u;
      const u3 = u2 * u;
      const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
      out.push(clampPt({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y), p: (p1.p ?? 0.5) + ((p2.p ?? 0.5) - (p1.p ?? 0.5)) * u }));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** How pressure shapes the line for each instrument. Brushes respond most; fineliner and highlighter not at all. */
export function widthFor(pen: Pen, pressure = 0.5): number {
  const p = Math.max(0, Math.min(1, pressure));
  switch (pen.kind) {
    case "pencil":
      return pen.width * (0.7 + 0.6 * p);
    case "marker":
      return pen.width * (0.85 + 0.3 * p);
    case "brush":
      return pen.width * (0.25 + 1.5 * p);
    case "fineliner":
    case "highlighter":
      return pen.width;
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

function inkLength(item: Item): number {
  switch (item.kind) {
    case "stroke":
      return item.paths.reduce((s, points) => s + pathLength(points), 0);
    case "path":
      return pathPoints(item).reduce((s, points) => s + pathLength(points), 0);
    case "line":
      return dist(item.from, item.to);
    case "arc":
      return (Math.abs(item.end - item.start) / 360) * 2 * Math.PI * item.r;
    case "shape": {
      const v = shapeVertices(item);
      let len = 0;
      for (let i = 0; i < v.length; i++) len += dist(v[i], v[(i + 1) % v.length]);
      return len;
    }
  }
}

/** Where the pen tip is while an item is being revealed. */
function tipAt(item: Item, t: number): Pt | null {
  switch (item.kind) {
    case "path":
    case "stroke": {
      const visible = pathProgress(item.kind === "path" ? pathPoints(item) : item.paths, t).filter((path) => path.progress > 0);
      const current = visible.at(-1);
      return current ? revealed(current.points, current.progress).at(-1) ?? null : null;
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
  }
}

function pathLength(points: Pt[]): number {
  return points.reduce((length, p, index) => length + (index ? dist(points[index - 1], p) : 0), 0);
}

/** Pen lifts consume no ink: separate paths must never be joined by a line. */
export function pathProgress(paths: Pt[][], t: number) {
  const lengths = paths.map((points) => Math.max(1, pathLength(points)));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * t;
  return paths.map((points, index) => {
    const progress = Math.max(0, Math.min(1, remaining / lengths[index]));
    remaining -= lengths[index];
    return { points, progress };
  });
}

/** Deterministic 0..1 noise so textures stay put between frames and replays. */
function noise(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
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
