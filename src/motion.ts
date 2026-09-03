// Motion: where a mark is at a moment in time. A keyframe is an edit at a
// time; between keyframes the desk tweens with an easing curve. Wiggle and
// boil add the hand-made shimmer of drawn animation without more keyframes.

import type { Item, Pt, Transform } from "./scene.ts";

export type EaseName = "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut" | "bounce";
export const EASES: EaseName[] = ["linear", "ease", "easeIn", "easeOut", "easeInOut", "bounce"];

export interface Keyframe {
  /** Seconds on the timeline. */
  at: number;
  dx?: number;
  dy?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
  /** 0..1 how much of the mark has been drawn (write-on). */
  reveal?: number;
  /** How to arrive at this key from the previous one. */
  ease?: EaseName;
  /** Cubic bezier control points (x1, y1, x2, y2), used when ease is absent. */
  bezier?: [number, number, number, number];
  about?: Pt;
}

export interface Motion {
  keys: Keyframe[];
  /** Smooth random drift: amplitude in paper units, frequency in Hz. */
  wiggle?: { amp: number; freq: number };
  /** Re-noise textured edges this many times per second (line boil). */
  boil?: number;
}

export interface Pose {
  transform: Transform;
  opacity: number;
  reveal: number;
  /** True when the pose differs from the mark at rest. */
  moving: boolean;
}

type Channel = "dx" | "dy" | "scale" | "rotate" | "opacity" | "reveal";
const REST: Record<Channel, number> = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1, reveal: 1 };

/** The pose of a mark at time t (seconds). */
export function poseAt(item: Item, t: number): Pose {
  const m = item.motion;
  if (!m) return { transform: {}, opacity: 1, reveal: 1, moving: false };
  const keys = [...m.keys].sort((a, b) => a.at - b.at);
  const v: Record<Channel, number> = { ...REST };
  for (const ch of Object.keys(REST) as Channel[]) v[ch] = channelAt(keys, ch, t);
  let about: Pt | undefined;
  for (const k of keys) if (k.about) about = k.about;
  if (m.wiggle && m.wiggle.amp > 0) {
    const seed = hash(item.id);
    v.dx += m.wiggle.amp * (smoothNoise(t * m.wiggle.freq, seed) * 2 - 1);
    v.dy += m.wiggle.amp * (smoothNoise(t * m.wiggle.freq, seed + 17) * 2 - 1);
  }
  const transform: Transform = {};
  if (v.dx) transform.dx = v.dx;
  if (v.dy) transform.dy = v.dy;
  if (v.scale !== 1) transform.scale = v.scale;
  if (v.rotate) transform.rotate = v.rotate;
  if (about) transform.about = about;
  const moving = Object.keys(transform).some((k) => k !== "about") || v.opacity !== 1 || v.reveal !== 1;
  return { transform, opacity: clamp01(v.opacity), reveal: clamp01(v.reveal), moving };
}

/**
 * Value of one channel at t. Like After Effects: hold the first key's value
 * before it, hold the last key's value after it, tween in between. A single
 * key is a constant; put a key at 0 to start from rest.
 */
function channelAt(keys: Keyframe[], ch: Channel, t: number): number {
  const defined = keys.filter((k) => k[ch] !== undefined);
  if (defined.length === 0) return REST[ch];
  let prev: Keyframe | null = null;
  let next: Keyframe | null = null;
  for (const k of defined) {
    if (k.at <= t) prev = k;
    else {
      next = k;
      break;
    }
  }
  if (!prev) return defined[0][ch]!;
  if (!next) return prev[ch]!;
  const span = next.at - prev.at;
  const u = span <= 0 ? 1 : (t - prev.at) / span;
  return prev[ch]! + (next[ch]! - prev[ch]!) * easeValue(next, u);
}

function easeValue(key: Keyframe, u: number): number {
  const x = clamp01(u);
  if (key.bezier) return cubicBezier(key.bezier, x);
  switch (key.ease ?? "easeInOut") {
    case "linear":
      return x;
    case "ease":
      return cubicBezier([0.25, 0.1, 0.25, 1], x);
    case "easeIn":
      return x * x * x;
    case "easeOut":
      return 1 - (1 - x) ** 3;
    case "easeInOut":
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case "bounce": {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x - 1.5 / d1) * (x - 1.5 / d1) + 0.75;
      if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) * (x - 2.25 / d1) + 0.9375;
      return n1 * (x - 2.625 / d1) * (x - 2.625 / d1) + 0.984375;
    }
  }
}

/** y for a CSS-style cubic bezier at progress x, solved by bisection. */
export function cubicBezier([x1, y1, x2, y2]: [number, number, number, number], x: number): number {
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** Smooth 0..1 noise over a continuous input, for wiggle. */
export function smoothNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lattice(i, seed) * (1 - u) + lattice(i + 1, seed) * u;
}

function lattice(i: number, seed: number): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100000;
  return h;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Built-in motions, the way an animate menu offers them. Times are relative to
 * where the preset is applied; the agent can make its own with `make`.
 */
export const LIBRARY: Record<string, { motion: Motion; description: string }> = {
  rise: { description: "fade up from 40 below", motion: { keys: [{ at: 0, dy: 40, opacity: 0 }, { at: 0.5, dy: 0, opacity: 1, ease: "easeOut" }] } },
  drop: { description: "fall in from above and settle", motion: { keys: [{ at: 0, dy: -60, opacity: 0 }, { at: 0.6, dy: 0, opacity: 1, ease: "bounce" }] } },
  pop: { description: "scale up with overshoot", motion: { keys: [{ at: 0, scale: 0, opacity: 0 }, { at: 0.35, scale: 1.12, opacity: 1, ease: "easeOut" }, { at: 0.5, scale: 1 }] } },
  fade: { description: "fade in", motion: { keys: [{ at: 0, opacity: 0 }, { at: 0.5, opacity: 1, ease: "ease" }] } },
  wipe: { description: "write on, as if drawn", motion: { keys: [{ at: 0, reveal: 0 }, { at: 0.8, reveal: 1, ease: "linear" }] } },
  typewriter: { description: "fast write-on, for lettering with stagger", motion: { keys: [{ at: 0, reveal: 0, opacity: 1 }, { at: 0.25, reveal: 1, ease: "linear" }] } },
  breathe: { description: "slow scale pulse", motion: { keys: [{ at: 0, scale: 1 }, { at: 1, scale: 1.06, ease: "easeInOut" }, { at: 2, scale: 1, ease: "easeInOut" }] } },
  spin: { description: "one full turn", motion: { keys: [{ at: 0, rotate: 0 }, { at: 1, rotate: 360, ease: "easeInOut" }] } },
  shake: { description: "quick side-to-side", motion: { keys: [{ at: 0, dx: 0 }, { at: 0.08, dx: -8, ease: "linear" }, { at: 0.16, dx: 8, ease: "linear" }, { at: 0.24, dx: -5, ease: "linear" }, { at: 0.32, dx: 0, ease: "linear" }] } },
  drift: { description: "gentle floating wiggle", motion: { keys: [], wiggle: { amp: 6, freq: 0.6 } } },
  sketchy: { description: "line boil, hand-drawn shimmer", motion: { keys: [], boil: 8 } },
  fadeOut: { description: "fade away", motion: { keys: [{ at: 0, opacity: 1 }, { at: 0.5, opacity: 0, ease: "ease" }] } },
  sink: { description: "drop and fade out", motion: { keys: [{ at: 0, dy: 0, opacity: 1 }, { at: 0.5, dy: 40, opacity: 0, ease: "easeIn" }] } },
};

/** Keyframe times across a set of marks, for the scrubber. */
export function keyTimes(items: Item[]): number[] {
  const out = new Set<number>();
  for (const item of items) for (const k of item.motion?.keys ?? []) out.add(Math.round(k.at * 1000) / 1000);
  return [...out].sort((a, b) => a - b);
}
