// How an agent sees the paper. Tool results are text, so "looking" returns a
// labeled inventory of every mark plus a coarse character raster of the sheet.

import { bbox, PAPER_H, PAPER_W, shapeVertices, type Item, type Pt, type Scene } from "./scene";

const CELL = 25; // paper units per raster cell
const COLS = PAPER_W / CELL; // 48
const ROWS = PAPER_H / CELL; // 32

const HUMAN = 1;
const AGENT = 2;
const TEXT = 4;

export interface ItemSummary {
  id: string;
  label: string;
  author: string;
  kind: string;
  pen: string;
  bbox: { x: number; y: number; w: number; h: number };
  detail: string;
}

export function describe(scene: Scene) {
  return {
    paper: scene.paper,
    size: { width: PAPER_W, height: PAPER_H, origin: "top-left, y grows downward" },
    count: scene.items.length,
    items: scene.items.map(summarize),
    raster: {
      legend: `${COLS} columns x ${ROWS} rows, one cell = ${CELL}x${CELL} paper units. '.' empty, 'o' human ink, '#' agent ink, '@' both, 'T' text.`,
      rows: raster(scene.items),
    },
  };
}

function summarize(item: Item): ItemSummary {
  const b = bbox(item);
  const r = (n: number) => Math.round(n);
  return {
    id: item.id,
    label: item.label,
    author: item.author,
    kind: item.kind,
    pen: `${item.pen.kind} ${item.pen.color} w${item.pen.width}`,
    bbox: { x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) },
    detail: detailOf(item),
  };
}

function detailOf(item: Item): string {
  const r = (n: number) => Math.round(n);
  switch (item.kind) {
    case "stroke": {
      const first = item.points[0];
      const last = item.points[item.points.length - 1];
      return `${item.points.length} points from (${r(first.x)},${r(first.y)}) to (${r(last.x)},${r(last.y)})`;
    }
    case "line":
      return `from (${r(item.from.x)},${r(item.from.y)}) to (${r(item.to.x)},${r(item.to.y)})${item.arrow ? " with arrowhead" : ""}`;
    case "arc":
      return `center (${r(item.cx)},${r(item.cy)}) radius ${r(item.r)} from ${r(item.start)}° to ${r(item.end)}°`;
    case "shape":
      return `${item.shape}${item.shape === "polygon" ? ` ${item.sides} sides` : ""} center (${r(item.x)},${r(item.y)}) ${r(item.w)}x${r(item.h)} rotation ${r(item.rotation)}°`;
    case "text":
      return `"${item.text}" at (${r(item.x)},${r(item.y)}) size ${r(item.size)}`;
  }
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
    if (item.kind === "text") {
      const b = bbox(item);
      for (let x = b.x; x <= b.x + b.w; x += CELL / 2) mark({ x, y: item.y - item.size * 0.4 }, TEXT | bit);
      continue;
    }
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
      if (v & TEXT) s += "T";
      else if ((v & HUMAN) && (v & AGENT)) s += "@";
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
      return [item.points];
    case "line":
      return [[item.from, item.to]];
    case "arc": {
      const pts: Pt[] = [];
      const span = item.end - item.start;
      const steps = Math.max(8, Math.ceil((Math.abs(span) / 360) * 48));
      for (let i = 0; i <= steps; i++) {
        const a = ((item.start + (span * i) / steps) * Math.PI) / 180;
        pts.push({ x: item.cx + item.r * Math.cos(a), y: item.cy + item.r * Math.sin(a) });
      }
      return [pts];
    }
    case "shape": {
      const v = shapeVertices(item);
      return [[...v, v[0]]];
    }
    case "text":
      return [];
  }
}
