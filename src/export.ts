// Ways off the paper: PNG from the renderer, SVG from the scene, WebM from
// the canvas while the timeline plays once.

import { inkColor, THEMES, type Theme } from "./appearance.ts";
import { widthFor, type Paper } from "./paper.ts";
import { arcPoints, PAPER_H, PAPER_W, shapeVertices, type Item, type Scene } from "./scene.ts";
import { toData } from "./svgpath.ts";
import { poseAt } from "./motion.ts";
import { transformItem } from "./scene.ts";

export function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function exportPNG(paper: Paper, name = "desk.png") {
  const canvas = paper.snapshot(2);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (blob) download(name, blob);
}

/** The sheet as an SVG document, at the timeline's current time. */
export function toSVG(scene: Scene, theme: Theme, time = 0): string {
  const t = THEMES[theme];
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  const r = (n: number) => Math.round(n * 10) / 10;
  const parts: string[] = [];
  for (const raw of scene.items) {
    if (raw.hidden) continue;
    const pose = raw.motion ? poseAt(raw, time) : null;
    if (pose && pose.opacity <= 0) continue;
    const item = pose?.moving ? transformItem(raw, pose.transform) : raw;
    const pen = item.pen;
    const stroke = inkColor(pen.color, theme);
    const opacity = pen.opacity * (pose?.opacity ?? 1);
    const fill = pen.fillColor ? inkColor(pen.fillColor, theme) : "none";
    const dash = pen.dash ? ` stroke-dasharray="${r(Math.max(6, pen.width * 3))} ${r(Math.max(5, pen.width * 2.5))}"` : "";
    const common = `stroke="${stroke}" stroke-width="${r(pen.width)}" stroke-linecap="round" stroke-linejoin="round" opacity="${r(opacity)}"${dash}`;
    const title = `<title>${esc(item.label)}</title>`;
    switch (item.kind) {
      case "line":
        parts.push(`<line x1="${r(item.from.x)}" y1="${r(item.from.y)}" x2="${r(item.to.x)}" y2="${r(item.to.y)}" ${common}>${title}</line>`);
        if (item.arrow) {
          const size = Math.max(10, pen.width * 3);
          const ang = Math.atan2(item.to.y - item.from.y, item.to.x - item.from.x);
          const a = { x: item.to.x - size * Math.cos(ang - Math.PI / 6), y: item.to.y - size * Math.sin(ang - Math.PI / 6) };
          const b = { x: item.to.x - size * Math.cos(ang + Math.PI / 6), y: item.to.y - size * Math.sin(ang + Math.PI / 6) };
          parts.push(`<path d="M${r(a.x)} ${r(a.y)} L${r(item.to.x)} ${r(item.to.y)} L${r(b.x)} ${r(b.y)}" fill="none" ${common}/>`);
        }
        break;
      case "arc": {
        if (Math.abs(item.end - item.start) >= 360) {
          parts.push(`<circle cx="${r(item.cx)}" cy="${r(item.cy)}" r="${r(item.r)}" fill="${fill}" ${common}>${title}</circle>`);
        } else {
          const pts = arcPoints(item, 64);
          parts.push(`<polyline points="${pts.map((p) => `${r(p.x)},${r(p.y)}`).join(" ")}" fill="none" ${common}>${title}</polyline>`);
        }
        break;
      }
      case "shape": {
        const v = shapeVertices(item);
        parts.push(`<polygon points="${v.map((p) => `${r(p.x)},${r(p.y)}`).join(" ")}" fill="${fill}" ${common}>${title}</polygon>`);
        break;
      }
      case "path":
        parts.push(`<path d="${toData(item.segments)}" fill="${fill}" ${common}>${title}</path>`);
        break;
      case "stroke": {
        // Freehand keeps its average pressure width; ribbons don't survive SVG cleanly.
        for (const path of item.paths) {
          if (path.length === 0) continue;
          const avg = path.reduce((s, p) => s + widthFor(pen, p.p), 0) / path.length;
          if (path.length === 1) {
            parts.push(`<circle cx="${r(path[0].x)}" cy="${r(path[0].y)}" r="${r(avg / 2)}" fill="${stroke}" opacity="${r(opacity)}"/>`);
            continue;
          }
          parts.push(`<polyline points="${path.map((p) => `${r(p.x)},${r(p.y)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${r(avg)}" stroke-linecap="round" stroke-linejoin="round" opacity="${r(opacity)}">${title}</polyline>`);
        }
        break;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER_W} ${PAPER_H}" width="${PAPER_W}" height="${PAPER_H}">
<rect width="${PAPER_W}" height="${PAPER_H}" fill="${t.paper}"/>
${parts.join("\n")}
</svg>`;
}

export function exportSVG(scene: Scene, theme: Theme, time: number, name = "desk.svg") {
  download(name, new Blob([toSVG(scene, theme, time)], { type: "image/svg+xml" }));
}

/** Record one loop of the timeline from the canvas. Resolves when the file is offered. */
export function exportVideo(canvas: HTMLCanvasElement, paper: Paper, scene: Scene, name = "desk.webm"): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = (canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream }).captureStream?.(30);
    if (!stream || typeof MediaRecorder === "undefined") {
      reject(new Error("This browser can't record the canvas. Screen-record the sheet instead."));
      return;
    }
    const mime = ["video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      download(name, new Blob(chunks, { type: "video/webm" }));
      resolve();
    };
    const wasLoop = scene.timeline.loop;
    paper.pause();
    paper.seek(0);
    rec.start();
    scene.setTimeline({ loop: false });
    paper.play({ once: true });
    const check = () => {
      if (paper.playing) setTimeout(check, 60);
      else setTimeout(() => {
        scene.setTimeline({ loop: wasLoop });
        rec.stop();
      }, 200);
    };
    check();
  });
}

export type { Item };
