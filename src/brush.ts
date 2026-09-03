// A stamp brush engine. A tip is a small alpha image; a stroke is that tip
// stamped along the path at a spacing, with pressure driving size and flow.
// Pencil and chalk deposits are masked by paper grain. Tips and grain are
// generated once and cached; jitter is seeded, so a stroke always looks the
// same and only line boil changes it on purpose.

import type { Pen, Pt } from "./scene.ts";

export type Tip = "round" | "soft" | "flat" | "bristle" | "chalk" | "pencil";

export interface BrushDef {
  tip: Tip;
  /** Stamp spacing as a fraction of size. */
  spacing: number;
  /** Size multiplier as pressure goes 0..1: size = width * (base + gain * p). */
  sizeBase: number;
  sizeGain: number;
  /** Flow (per-stamp alpha) at pressure 0 and 1. */
  flowBase: number;
  flowGain: number;
  /** Random scatter of stamps across the path, in fractions of size. */
  scatter: number;
  /** Paper grain strength 0..1. */
  grain: number;
  /** Multiply blending, the way translucent markers behave on paper. */
  multiply: boolean;
  /** Tip follows the stroke direction. */
  oriented: boolean;
  /** Random size variation per stamp, 0..1 of the stamp size. */
  sizeJitter: number;
  /** Random flow variation per stamp, 0..1 of the stamp alpha. */
  flowJitter: number;
  /** Random tumble per stamp for non-oriented tips, 0..1 of a full turn. */
  angleJitter: number;
  /** Exponent applied to pressure before size and flow, 0.3 (eager) .. 3 (reluctant). */
  pressureCurve: number;
  /** Drying stroke: each stamp fades toward the paper as the stroke runs on, 0..1. */
  wet: number;
  /** Stamp a second tip at half size for a darker, textured core. */
  dual: boolean;
}

/** How each pen kind behaves under the engine. Fineliner stays a crisp vector ribbon. */
export const BRUSHES: Record<Exclude<Pen["kind"], "fineliner">, BrushDef> = {
  pencil: { tip: "pencil", spacing: 0.12, sizeBase: 0.75, sizeGain: 0.55, flowBase: 0.35, flowGain: 0.5, scatter: 0.08, grain: 0.85, multiply: true, oriented: false, sizeJitter: 0.12, flowJitter: 0.1, angleJitter: 1, pressureCurve: 1, wet: 0, dual: false },
  marker: { tip: "flat", spacing: 0.07, sizeBase: 0.9, sizeGain: 0.25, flowBase: 0.6, flowGain: 0.3, scatter: 0, grain: 0.2, multiply: true, oriented: true, sizeJitter: 0.12, flowJitter: 0.1, angleJitter: 0, pressureCurve: 1, wet: 0, dual: false },
  brush: { tip: "soft", spacing: 0.11, sizeBase: 0.2, sizeGain: 1.5, flowBase: 0.32, flowGain: 0.4, scatter: 0, grain: 0, multiply: false, oriented: false, sizeJitter: 0.12, flowJitter: 0.1, angleJitter: 0, pressureCurve: 1, wet: 0, dual: false },
  highlighter: { tip: "flat", spacing: 0.06, sizeBase: 1, sizeGain: 0, flowBase: 0.3, flowGain: 0, scatter: 0, grain: 0.15, multiply: true, oriented: true, sizeJitter: 0.12, flowJitter: 0.1, angleJitter: 0, pressureCurve: 1, wet: 0, dual: false },
};

const TIP_PX = 96;
const GRAIN_PX = 256;

const tipCache = new Map<string, HTMLCanvasElement>();
let grainTile: HTMLCanvasElement | null = null;
const grainAtStrength = new Map<number, HTMLCanvasElement>();

function canvasFactory(): ((w: number, h: number) => HTMLCanvasElement | null) {
  return (w, h) => {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };
}

/** Deterministic 0..1 noise. */
function noise(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Smooth value noise on a grid, for grain. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const n = (a: number, b: number) => noise(a * 57 + b * 131, seed);
  const top = n(xi, yi) * (1 - u) + n(xi + 1, yi) * u;
  const bottom = n(xi, yi + 1) * (1 - u) + n(xi + 1, yi + 1) * u;
  return top * (1 - v) + bottom * v;
}

/** The tip alpha image for a kind, in white, built once. */
function tip(kind: Tip): HTMLCanvasElement | null {
  const cached = tipCache.get(kind);
  if (cached) return cached;
  const make = canvasFactory();
  const c = make(TIP_PX, TIP_PX);
  if (!c) return null;
  const ctx = c.getContext("2d")!;
  const r = TIP_PX / 2;
  ctx.clearRect(0, 0, TIP_PX, TIP_PX);
  switch (kind) {
    case "round": {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "soft": {
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.55, "rgba(255,255,255,0.8)");
      g.addColorStop(0.85, "rgba(255,255,255,0.25)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TIP_PX, TIP_PX);
      break;
    }
    case "flat": {
      // A chisel: wide across the path, thin along it, soft at the ends.
      const g = ctx.createLinearGradient(0, 0, 0, TIP_PX);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.12, "rgba(255,255,255,1)");
      g.addColorStop(0.88, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(r, r, r * 0.42, r - 1, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "bristle": {
      ctx.strokeStyle = "#fff";
      ctx.lineCap = "round";
      for (let i = 0; i < 14; i++) {
        const y = 6 + noise(i, 3) * (TIP_PX - 12);
        ctx.globalAlpha = 0.35 + noise(i, 5) * 0.65;
        ctx.lineWidth = 1.5 + noise(i, 7) * 3;
        ctx.beginPath();
        ctx.moveTo(r - r * 0.7, y);
        ctx.lineTo(r + r * 0.7, y + (noise(i, 9) - 0.5) * 6);
        ctx.stroke();
      }
      break;
    }
    case "chalk": {
      // A round mass eaten away by noise: the deposit of a soft, dry stick.
      const img = ctx.createImageData(TIP_PX, TIP_PX);
      for (let y = 0; y < TIP_PX; y++) {
        for (let x = 0; x < TIP_PX; x++) {
          const d = Math.hypot(x - r, y - r) / r;
          if (d > 1) continue;
          const n = valueNoise(x / 6, y / 6, 11) * 0.6 + valueNoise(x / 2.5, y / 2.5, 13) * 0.4;
          const edge = 1 - Math.pow(d, 3);
          const a = Math.max(0, Math.min(1, (n - 0.25) * 1.6)) * edge;
          const k = (y * TIP_PX + x) * 4;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
          img.data[k + 3] = Math.round(a * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      break;
    }
    case "pencil": {
      // Graphite: a hard core with a rough halo.
      const img = ctx.createImageData(TIP_PX, TIP_PX);
      for (let y = 0; y < TIP_PX; y++) {
        for (let x = 0; x < TIP_PX; x++) {
          const d = Math.hypot(x - r, y - r) / r;
          if (d > 1) continue;
          const n = valueNoise(x / 3, y / 3, 17);
          const core = d < 0.55 ? 1 : Math.max(0, 1 - (d - 0.55) / 0.45);
          const a = Math.min(1, core * (0.55 + 0.45 * n) * (d < 0.35 ? 1 : 0.85));
          const k = (y * TIP_PX + x) * 4;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
          img.data[k + 3] = Math.round(a * 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      break;
    }
  }
  tipCache.set(kind, c);
  return c;
}

/** The tip tinted with a color, cached per color. */
function tintedTip(kind: Tip, color: string): HTMLCanvasElement | null {
  const key = `${kind}|${color}`;
  const cached = tipCache.get(key);
  if (cached) return cached;
  const base = tip(kind);
  const make = canvasFactory();
  const c = base && make(TIP_PX, TIP_PX);
  if (!c || !base) return null;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TIP_PX, TIP_PX);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(base, 0, 0);
  tipCache.set(key, c);
  return c;
}

/** A seamless paper grain tile: alpha mask, built once. */
function grain(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  const make = canvasFactory();
  const c = make(GRAIN_PX, GRAIN_PX);
  if (!c) return null;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(GRAIN_PX, GRAIN_PX);
  for (let y = 0; y < GRAIN_PX; y++) {
    for (let x = 0; x < GRAIN_PX; x++) {
      // Tileable by sampling on a torus: blend across the seams.
      const fx = x / GRAIN_PX;
      const fy = y / GRAIN_PX;
      const s = (ox: number, oy: number) => valueNoise((x + ox) / 5, (y + oy) / 5, 23) * 0.55 + valueNoise((x + ox) / 1.7, (y + oy) / 1.7, 29) * 0.45;
      const v = s(0, 0) * (1 - fx) * (1 - fy) + s(-GRAIN_PX, 0) * fx * (1 - fy) + s(0, -GRAIN_PX) * (1 - fx) * fy + s(-GRAIN_PX, -GRAIN_PX) * fx * fy;
      const k = (y * GRAIN_PX + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(Math.max(0, Math.min(1, 0.15 + v * 1.1)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
  return grainTile;
}

export interface StampOptions {
  color: string;
  /** Overall alpha from the pen. */
  opacity: number;
  /** Seed offset for boil; 0 keeps the stroke fixed. */
  boil?: number;
  /** Taper the ends by this many paper units. */
  taper?: number;
  /** Override brush definition (custom brushes). */
  def?: Partial<BrushDef>;
}

/** Stamp one path (already smoothed) onto ctx in paper units. Returns false when tips are unavailable. */
export function stampPath(ctx: CanvasRenderingContext2D, pts: Pt[], pen: Pen, opts: StampOptions): boolean {
  if (pen.kind === "fineliner" || pts.length === 0) return false;
  const def: BrushDef = { ...BRUSHES[pen.kind], ...(opts.def ?? {}) };
  const img = tintedTip(def.tip, opts.color);
  if (!img) return false;
  const seed = Math.round(pts[0].x * 7 + pts[0].y * 13) + (opts.boil ?? 0) * 101;
  // Pressure is shaped once, then drives both size and flow.
  const curve = (p: number) => Math.pow(Math.max(0, Math.min(1, p)), def.pressureCurve);
  const size = (p: number) => Math.max(0.6, pen.width * (def.sizeBase + def.sizeGain * p));
  const flow = (p: number) => Math.max(0.02, Math.min(1, def.flowBase + def.flowGain * p));

  // Walk the path, laying stamps every `spacing * size` units.
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const taperLen = opts.taper ?? 0;
  ctx.save();
  if (def.multiply) ctx.globalCompositeOperation = "multiply";
  let carried = 0;
  let travelled = 0;
  let n = 0;
  const stamp = (x: number, y: number, raw: number, angle: number, dist: number) => {
    const p = curve(raw);
    let s = size(p);
    if (taperLen > 0) s *= Math.min(1, dist / taperLen, (total - dist) / taperLen, 1) || 0.15;
    const jitterS = 1 + (noise(n, seed) - 0.5) * def.sizeJitter;
    const sx = def.scatter ? (noise(n * 3, seed + 1) - 0.5) * def.scatter * s : 0;
    const sy = def.scatter ? (noise(n * 3 + 1, seed + 2) - 0.5) * def.scatter * s : 0;
    // A drying stroke: the deposit thins the further the brush has travelled.
    const drying = def.wet > 0 && total > 0 ? 1 - def.wet * Math.min(1, dist / total) : 1;
    ctx.globalAlpha = opts.opacity * flow(p) * (1 - def.flowJitter + def.flowJitter * noise(n * 5, seed + 3)) * drying;
    const w = s * jitterS;
    ctx.save();
    ctx.translate(x + sx, y + sy);
    if (def.oriented) ctx.rotate(angle);
    else if (def.angleJitter > 0) ctx.rotate(noise(n, seed + 4) * Math.PI * 2 * def.angleJitter);
    ctx.drawImage(img, -w / 2, -w / 2, w, w);
    if (def.dual) ctx.drawImage(img, -w / 4, -w / 4, w / 2, w / 2);
    ctx.restore();
    n++;
  };
  if (pts.length === 1) stamp(pts[0].x, pts[0].y, pts[0].p ?? 0.5, 0, 0);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen === 0) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let d = carried;
    while (d <= segLen) {
      const t = d / segLen;
      const p = (a.p ?? 0.5) + ((b.p ?? 0.5) - (a.p ?? 0.5)) * t;
      stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, p, angle, travelled + d);
      d += Math.max(0.35, def.spacing * size(curve(p)));
    }
    carried = d - segLen;
    travelled += segLen;
  }
  ctx.restore();
  return true;
}

/**
 * Apply paper grain to whatever was just drawn inside `rect` on `layer`
 * (device space). The grain is aligned to paper space so it stays put.
 */
export function applyGrain(layer: CanvasRenderingContext2D, strength: number, transform: DOMMatrix, seedShift = 0) {
  const tile = grainMask(strength);
  if (!tile || strength <= 0) return;
  layer.save();
  layer.setTransform(transform);
  layer.globalCompositeOperation = "destination-in";
  const pattern = layer.createPattern(tile, "repeat");
  if (!pattern) {
    layer.restore();
    return;
  }
  const m = new DOMMatrix().scale(1.4, 1.4).translate(seedShift * 37, seedShift * 19);
  pattern.setTransform(m);
  layer.fillStyle = pattern;
  layer.globalAlpha = 1;
  layer.fillRect(-1e5, -1e5, 2e5, 2e5);
  layer.restore();
}

/** The grain tile weakened to a strength: alpha = 1 - strength * (1 - grain). */
function grainMask(strength: number): HTMLCanvasElement | null {
  const q = Math.round(Math.max(0, Math.min(1, strength)) * 10) / 10;
  const cached = grainAtStrength.get(q);
  if (cached) return cached;
  const base = grain();
  const make = canvasFactory();
  const c = base && make(GRAIN_PX, GRAIN_PX);
  if (!c || !base) return null;
  const ctx = c.getContext("2d")!;
  // Start opaque, then cut away (1 - grain) scaled by strength.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, GRAIN_PX, GRAIN_PX);
  const inverse = make(GRAIN_PX, GRAIN_PX)!;
  const ictx = inverse.getContext("2d")!;
  ictx.fillStyle = "#fff";
  ictx.fillRect(0, 0, GRAIN_PX, GRAIN_PX);
  ictx.globalCompositeOperation = "destination-out";
  ictx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = q;
  ctx.drawImage(inverse, 0, 0);
  grainAtStrength.set(q, c);
  return c;
}

/** The brush definition for a pen: the kind's engine settings plus any overrides, including a full `engine` block. */
export function brushFor(pen: Pen): BrushDef {
  const base = pen.kind === "fineliner" ? BRUSHES.pencil : BRUSHES[pen.kind];
  const def: BrushDef = { ...base };
  if (pen.texture === "chalk") Object.assign(def, { tip: "chalk", grain: Math.max(def.grain, 0.7), spacing: 0.1, scatter: 0.05, multiply: true });
  if (pen.texture === "grain") def.grain = Math.max(def.grain, 0.9);
  if (pen.tip) def.tip = pen.tip;
  if (pen.spacing !== undefined) def.spacing = pen.spacing;
  if (pen.scatter !== undefined) def.scatter = pen.scatter;
  if (pen.grain !== undefined) def.grain = pen.grain;
  // Dry tips tumble so their texture never repeats along a line, unless the
  // brush was designed with its own angleJitter.
  if ((def.tip === "chalk" || def.tip === "pencil") && pen.engine?.angleJitter === undefined) def.angleJitter = 1;
  if (pen.engine) Object.assign(def, pen.engine);
  return def;
}

/** Tips the engine knows, for custom brushes. */
export const TIPS: Tip[] = ["round", "soft", "flat", "bristle", "chalk", "pencil"];
