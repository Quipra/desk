// How an agent sees the paper. Tool results are text, so "looking" returns a
// labeled inventory of every mark plus a coarse character raster of the sheet.

import { arcPoints, bbox, PAPER_H, PAPER_W, shapeVertices, type BBox, type Item, type Pt, type Scene } from "./scene.ts";

const CELL = 25; // paper units per raster cell
const COLS = PAPER_W / CELL; // 48
const ROWS = PAPER_H / CELL; // 32

const HUMAN = 1;
const AGENT = 2;

export interface ItemSummary {
  id: string;
  label: string;
  group?: string;
  author: string;
  kind: string;
  pen: string;
  bbox: { x: number; y: number; w: number; h: number };
  detail: string;
}

export function describe(scene: Scene, options: { region?: BBox; detail?: boolean; offset?: number; limit?: number } = {}) {
  const matches = options.region ? scene.inRegion(options.region) : scene.items;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 60;
  const items = matches.slice(offset, offset + limit);
  return {
    paper: scene.paper,
    size: { width: PAPER_W, height: PAPER_H, origin: "top-left, y grows downward" },
    count: scene.items.length,
    matched: matches.length,
    region: options.region ?? null,
    items: items.map((item) => ({ ...summarize(item), ...(options.detail ? { geometry: geometryOf(item) } : {}) })),
    nextOffset: offset + items.length < matches.length ? offset + items.length : null,
    note: "Labels are author-supplied, not visual recognition. The raster is occupancy, not a legible image. Detail includes sampled stroke geometry for inspection.",
    raster: {
      legend: `${COLS} columns x ${ROWS} rows, one cell = ${CELL}x${CELL} paper units. '.' empty, 'o' human ink, '#' agent ink, '@' both. Shows all matching marks, not only this page.`,
      rows: raster(matches),
    },
  };
}

function summarize(item: Item): ItemSummary {
  const b = bbox(item);
  const r = (n: number) => Math.round(n);
  return {
    id: item.id,
    label: item.label,
    ...(item.group ? { group: item.group } : {}),
    author: item.author,
    kind: item.kind,
    pen: `${item.pen.kind} ${item.pen.color} w${item.pen.width}${item.pen.dash ? " dashed" : ""}`,
    bbox: { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) },
    detail: detailOf(item),
  };
}

function detailOf(item: Item): string {
  const r = (n: number) => Math.round(n);
  switch (item.kind) {
    case "stroke": {
      const first = item.paths[0][0];
      const last = item.paths.at(-1)!.at(-1)!;
      return `${item.paths.length} strokes, ${item.paths.reduce((sum, path) => sum + path.length, 0)} points from (${r(first.x)},${r(first.y)}) to (${r(last.x)},${r(last.y)})`;
    }
    case "line":
      return `from (${r(item.from.x)},${r(item.from.y)}) to (${r(item.to.x)},${r(item.to.y)})${item.arrow ? " with arrowhead" : ""}`;
    case "arc":
      return `center (${r(item.cx)},${r(item.cy)}) radius ${r(item.r)} from ${r(item.start)}° to ${r(item.end)}°`;
    case "shape":
      return `${item.shape}${item.shape === "polygon" ? ` ${item.sides} sides` : ""} center (${r(item.x)},${r(item.y)}) ${r(item.w)}x${r(item.h)} rotation ${r(item.rotation)}°`;
  }
}

function geometryOf(item: Item) {
  const { id: _id, label: _label, author: _author, pen: _pen, group: _group, ...geometry } = item;
  if (geometry.kind !== "stroke") return geometry;
  // Bounded detail preserves endpoints and pen lifts without returning tens of
  // thousands of smoothed points to the model for each word.
  return { kind: "stroke", sampled: geometry.paths.some((path) => path.length > 32), paths: geometry.paths.map((path) => {
    const count = Math.min(32, path.length);
    return Array.from({ length: count }, (_, i) => {
      const p = path[Math.round(i * (path.length - 1) / Math.max(1, count - 1))];
      return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, p: p.p };
    });
  }) };
}

function raster(items: Item[]): string[] {
  const grid = new Uint8Array(COLS * ROWS);
  const mark = (p: Pt, bit: number) => {
    const c = Math.floor(p.x / CELL);
    const rr = Math.floor(p.y / CELL);
    if (c < 0 || c >= COLS || rr < 0 || rr >= ROWS) return;
    grid[rr * COLS + c] |= bit;
  };
  for (const item of items) {
    const bit = item.author === "agent" ? AGENT : HUMAN;
    for (const line of polylines(item)) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 3)));
        for (let s = 0; s <= steps; s++) mark({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }, bit);
      }
      if (line.length === 1) mark(line[0], bit);
    }
  }
  const rows: string[] = [];
  for (let rr = 0; rr < ROWS; rr++) {
    let s = "";
    for (let c = 0; c < COLS; c++) {
      const v = grid[rr * COLS + c];
      if ((v & HUMAN) && (v & AGENT)) s += "@";
      else if (v & AGENT) s += "#";
      else if (v & HUMAN) s += "o";
      else s += ".";
    }
    rows.push(s);
  }
  return rows;
}

function polylines(item: Item): Pt[][] {
  switch (item.kind) {
    case "stroke":
      return item.paths;
    case "line":
      return [[item.from, item.to]];
    case "arc":
      return [arcPoints(item, Math.max(8, Math.min(48, Math.ceil((Math.abs(item.end - item.start) / 360) * 48))))];
    case "shape": {
      const v = shapeVertices(item);
      return [[...v, v[0]]];
    }
  }
}
