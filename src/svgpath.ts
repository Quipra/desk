// A small SVG path-data parser: the pen tool's language. Supports M L H V C S Q
// T Z in absolute and relative forms and normalizes everything to absolute
// M, L, C, Q and Z segments so the rest of the desk never sees shorthand.

import type { Pt } from "./scene.ts";

export type Segment =
  | { c: "M"; x: number; y: number }
  | { c: "L"; x: number; y: number }
  | { c: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: "Q"; x1: number; y1: number; x: number; y: number }
  | { c: "Z" };

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

export function parsePath(d: string): Segment[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length === 0) throw new Error("d must be SVG path data, e.g. 'M 100 100 C 150 50 250 50 300 100 Z'");
  const out: Segment[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: Pt | null = null;
  let lastQ: Pt | null = null;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`path command ${cmd} is missing a number`);
    return Number(t);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
    } else if (!cmd) {
      throw new Error("path data must start with M");
    } else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    if (!(upper in ARGS)) throw new Error(`unknown path command ${cmd}`);
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (upper) {
      case "M": {
        x = ox + num();
        y = oy + num();
        sx = x;
        sy = y;
        out.push({ c: "M", x, y });
        lastC = lastQ = null;
        break;
      }
      case "L": {
        x = ox + num();
        y = oy + num();
        out.push({ c: "L", x, y });
        lastC = lastQ = null;
        break;
      }
      case "H": {
        x = ox + num();
        out.push({ c: "L", x, y });
        lastC = lastQ = null;
        break;
      }
      case "V": {
        y = oy + num();
        out.push({ c: "L", x, y });
        lastC = lastQ = null;
        break;
      }
      case "C": {
        const x1 = ox + num();
        const y1 = oy + num();
        const x2 = ox + num();
        const y2 = oy + num();
        x = ox + num();
        y = oy + num();
        out.push({ c: "C", x1, y1, x2, y2, x, y });
        lastC = { x: x2, y: y2 };
        lastQ = null;
        break;
      }
      case "S": {
        const x1: number = lastC ? 2 * x - lastC.x : x;
        const y1: number = lastC ? 2 * y - lastC.y : y;
        const x2 = ox + num();
        const y2 = oy + num();
        x = ox + num();
        y = oy + num();
        out.push({ c: "C", x1, y1, x2, y2, x, y });
        lastC = { x: x2, y: y2 };
        lastQ = null;
        break;
      }
      case "Q": {
        const x1 = ox + num();
        const y1 = oy + num();
        x = ox + num();
        y = oy + num();
        out.push({ c: "Q", x1, y1, x, y });
        lastQ = { x: x1, y: y1 };
        lastC = null;
        break;
      }
      case "T": {
        const x1: number = lastQ ? 2 * x - lastQ.x : x;
        const y1: number = lastQ ? 2 * y - lastQ.y : y;
        x = ox + num();
        y = oy + num();
        out.push({ c: "Q", x1, y1, x, y });
        lastQ = { x: x1, y: y1 };
        lastC = null;
        break;
      }
      case "Z": {
        out.push({ c: "Z" });
        x = sx;
        y = sy;
        lastC = lastQ = null;
        break;
      }
    }
    if (out.length > 2000) throw new Error("path has too many segments (max 2000)");
  }
  if (out[0]?.c !== "M") throw new Error("path data must start with M");
  return out;
}

/** Flatten a path into polylines, one per subpath, with curves sampled. */
export function flatten(segments: Segment[], steps = 12): Pt[][] {
  const paths: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  let start: Pt = { x: 0, y: 0 };
  for (const s of segments) {
    switch (s.c) {
      case "M":
        if (cur.length) paths.push(cur);
        cur = [{ x: s.x, y: s.y }];
        x = s.x;
        y = s.y;
        start = { x, y };
        break;
      case "L":
        cur.push({ x: s.x, y: s.y });
        x = s.x;
        y = s.y;
        break;
      case "C":
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const v = 1 - u;
          cur.push({
            x: v * v * v * x + 3 * v * v * u * s.x1 + 3 * v * u * u * s.x2 + u * u * u * s.x,
            y: v * v * v * y + 3 * v * v * u * s.y1 + 3 * v * u * u * s.y2 + u * u * u * s.y,
          });
        }
        x = s.x;
        y = s.y;
        break;
      case "Q":
        for (let i = 1; i <= steps; i++) {
          const u = i / steps;
          const v = 1 - u;
          cur.push({ x: v * v * x + 2 * v * u * s.x1 + u * u * s.x, y: v * v * y + 2 * v * u * s.y1 + u * u * s.y });
        }
        x = s.x;
        y = s.y;
        break;
      case "Z":
        cur.push({ ...start });
        x = start.x;
        y = start.y;
        break;
    }
  }
  if (cur.length) paths.push(cur);
  return paths;
}

/** Serialize segments back to compact path data. */
export function toData(segments: Segment[]): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return segments
    .map((s) => {
      switch (s.c) {
        case "M":
        case "L":
          return `${s.c}${r(s.x)} ${r(s.y)}`;
        case "C":
          return `C${r(s.x1)} ${r(s.y1)} ${r(s.x2)} ${r(s.y2)} ${r(s.x)} ${r(s.y)}`;
        case "Q":
          return `Q${r(s.x1)} ${r(s.y1)} ${r(s.x)} ${r(s.y)}`;
        case "Z":
          return "Z";
      }
    })
    .join(" ");
}

export function isClosed(segments: Segment[]): boolean {
  return segments.some((s) => s.c === "Z");
}
