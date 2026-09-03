import "./style.css";
import { applyTheme, type Theme } from "./appearance.ts";
import { exportPNG, exportSVG, exportVideo } from "./export.ts";
import { ICONS, type IconName } from "./icons.ts";
import { Instruments, type Mode } from "./instruments.ts";
import { deleteSheet, listSheets, saveSheet, thumbnail } from "./library.ts";
import { keyTimes } from "./motion.ts";
import { Paper } from "./paper.ts";
import { PALETTE, PEN_PRESETS, Scene, type PaperKind, type PenKind, type StencilShape } from "./scene.ts";
import { registerDesk } from "./webmcp.ts";

const COLORS: [string, string][] = [
  [PALETTE.ink, "ink"],
  [PALETTE.accent, "accent"],
  [PALETTE.blue, "blue"],
  [PALETTE.green, "green"],
  [PALETTE.ochre, "ochre"],
];
const WIDTHS: [number, string][] = [
  [1.5, "thin"],
  [3, "medium"],
  [7, "thick"],
];
const PENS: PenKind[] = ["pencil", "fineliner", "marker", "brush", "highlighter"];
const STENCILS: StencilShape[] = ["rectangle", "triangle", "polygon"];
const PAPERS: PaperKind[] = ["grid", "blank", "lined"];

let theme: Theme = "paper";
try {
  if (localStorage.getItem("desk-theme") === "charcoal") theme = "charcoal";
} catch {
  /* Drawing works without storage. */
}
applyTheme(theme);

const icon = (name: IconName) => ICONS[name];
const tool = (id: string, name: IconName, title: string, extra = "") =>
  `<button type="button" class="tool" id="${id}" title="${title}" aria-label="${title}" ${extra}>${icon(name)}</button>`;

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="top">
    <div class="identity">
      <button type="button" class="wordmark" id="menu-button" aria-haspopup="menu" aria-expanded="false">DESK</button>
    </div>
    <div class="status">
      <span id="cursor" aria-hidden="true"></span>
      <div class="zoom" role="group" aria-label="Zoom">
        ${tool("zoom-out", "minus", "Zoom out")}
        <button type="button" class="tool readout" id="zoom-readout" title="Fit to screen">100%</button>
        ${tool("zoom-in", "plus", "Zoom in")}
      </div>
      ${tool("layers-toggle", "front", "Layers", 'aria-pressed="false"')}
      <span class="chip off" id="agent" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span id="agent-label">agent: connecting</span></span>
    </div>
  </header>
  <div class="menu" id="menu" hidden role="menu"></div>
  <main class="stage" id="stage">
    <canvas id="paper" role="img" aria-label="Shared drawing sheet"></canvas>
    <p class="sr-only" id="paper-status" aria-live="polite">The grid sheet is empty.</p>
    <div class="hint" id="hint"><span>a shared sheet. draw on it, or ask your agent to.</span></div>
    <aside class="layers" id="layers" hidden aria-label="Layers"></aside>
    <div class="picker" id="picker" hidden></div>
  </main>
  <footer class="tray">
  <section class="strip" id="strip" hidden aria-label="Timeline">
    ${tool("play", "play", "Play or pause")}
    <span class="clock" id="clock">0.00 / 4.00</span>
    <div class="scrub">
      <input type="range" id="scrub" min="0" max="4" step="0.01" value="0" aria-label="Scrub the timeline" />
      <div class="ticks" id="ticks" aria-hidden="true"></div>
    </div>
    ${tool("loop", "loop", "Loop", 'aria-pressed="true"')}
    ${tool("onion", "onion", "Onion skin", 'aria-pressed="false"')}
  </section>
    <div class="tray-inner">
      <div class="group" role="group" aria-label="Navigate">
        ${tool("mode-hand", "hand", "Hand: pan the sheet (hold space)", 'data-mode="hand"')}
      </div>
      <div class="group" role="group" aria-label="Draw">
        ${tool("mode-pen", "pencil", "Pen", 'data-mode="pen" class="tool active"')}
        ${tool("mode-eraser", "eraser", "Eraser", 'data-mode="eraser"')}
      </div>
      <div class="group" role="group" aria-label="Instruments">
        ${tool("mode-ruler", "ruler", "Ruler: drag a straight line", 'data-mode="ruler"')}
        ${tool("mode-compass", "compass", "Compass: drag a circle", 'data-mode="compass"')}
        ${tool("mode-stencil", "stencil", "Stencil: drag a shape", 'data-mode="stencil"')}
      </div>
      <div class="group" role="group" aria-label="Sheet">
        ${tool("undo", "undo", "Undo (⌘Z)")}
        ${tool("redo", "redo", "Redo (⌘⇧Z)")}
        ${tool("replay", "replay", "Replay the sheet being drawn")}
        ${tool("sheet", "grid", "Paper: grid, blank or lined")}
      </div>
    </div>
  </footer>
`;

const scene = new Scene();
const canvas = document.querySelector<HTMLCanvasElement>("#paper")!;
const paper = new Paper(canvas, scene);
const stage = document.querySelector<HTMLElement>("#stage")!;
const instruments = new Instruments(paper, scene);
paper.theme = theme;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
paper.reducedMotion = motion.matches;
motion.addEventListener("change", () => {
  paper.reducedMotion = motion.matches;
});

// Theme
function updateTheme() {
  applyTheme(theme);
  paper.theme = theme;
  paper.invalidate();
}
updateTheme();
function toggleTheme() {
  theme = theme === "charcoal" ? "paper" : "charcoal";
  updateTheme();
  try {
    localStorage.setItem("desk-theme", theme);
  } catch {
    /* Theme still works for this tab. */
  }
}

new ResizeObserver(() => paper.resize()).observe(stage);
paper.resize();

// Tray: modes, and a picker row above for the active tool's options.
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const picker = document.querySelector<HTMLElement>("#picker")!;
const sheetBtn = document.querySelector<HTMLButtonElement>("#sheet")!;
let sheetPicker = false;
// The picker is a popover: it opens when a tool is clicked and gets out of the way when you draw.
let pickerOpen = false;

function renderPicker() {
  const mode = instruments.mode;
  const parts: string[] = [];
  if (sheetPicker) {
    parts.push(`<div class="pgroup">${PAPERS.map((p) => `<button type="button" class="tool${scene.paper === p ? " active" : ""}" data-paper="${p}" title="${p} paper">${icon(p)}</button>`).join("")}</div>`);
  } else if (mode === "pen") {
    parts.push(`<div class="pgroup">${PENS.map((k) => `<button type="button" class="tool${instruments.pen.kind === k ? " active" : ""}" data-pen="${k}" title="${k}">${icon(k)}</button>`).join("")}</div>`);
    parts.push(`<div class="pgroup">${WIDTHS.map(([w, name]) => `<button type="button" class="tool width${Math.abs(instruments.pen.width - w) < 0.01 ? " active" : ""}" data-width="${w}" title="${name}"><i style="height:${Math.max(2, w)}px"></i></button>`).join("")}<button type="button" class="tool${instruments.pen.dash ? " active" : ""}" data-dash title="${instruments.pen.dash ? "dashed" : "solid"}">${icon(instruments.pen.dash ? "dash" : "solid")}</button></div>`);
    parts.push(`<div class="pgroup colors">${COLORS.map(([c, name]) => `<button type="button" class="swatch${instruments.pen.color === c ? " active" : ""}" data-color="${c}" title="${name}" style="--swatch:${c === "auto" ? "var(--ink)" : c}"></button>`).join("")}<label class="swatch custom${COLORS.some(([c]) => c === instruments.pen.color) ? "" : " active"}" title="custom color" style="--swatch:${COLORS.some(([c]) => c === instruments.pen.color) ? "transparent" : instruments.pen.color}"><input type="color" id="custom-color" aria-label="Custom color" value="${/^#[0-9a-f]{6}$/i.test(instruments.pen.color) ? instruments.pen.color : "#dc716b"}"></label></div>`);
  } else if (mode === "stencil") {
    parts.push(`<div class="pgroup">${STENCILS.map((s) => `<button type="button" class="tool${instruments.stencil === s ? " active" : ""}" data-stencil="${s}" title="${s}">${icon(s)}</button>`).join("")}</div>`);
  } else if (mode === "ruler" || mode === "compass") {
    parts.push(`<div class="pgroup">${WIDTHS.map(([w, name]) => `<button type="button" class="tool width${Math.abs(instruments.pen.width - w) < 0.01 ? " active" : ""}" data-width="${w}" title="${name}"><i style="height:${Math.max(2, w)}px"></i></button>`).join("")}<button type="button" class="tool${instruments.pen.dash ? " active" : ""}" data-dash title="${instruments.pen.dash ? "dashed" : "solid"}">${icon(instruments.pen.dash ? "dash" : "solid")}</button></div>`);
    parts.push(`<div class="pgroup colors">${COLORS.map(([c, name]) => `<button type="button" class="swatch${instruments.pen.color === c ? " active" : ""}" data-color="${c}" title="${name}" style="--swatch:${c === "auto" ? "var(--ink)" : c}"></button>`).join("")}</div>`);
  }
  picker.hidden = parts.length === 0 || !pickerOpen;
  picker.innerHTML = parts.join('<span class="sep"></span>');
  for (const b of modeButtons) {
    const active = b.dataset.mode === mode && !sheetPicker;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  document.querySelector("#mode-pen")!.innerHTML = icon(instruments.pen.kind);
  sheetBtn.innerHTML = icon(scene.paper);
  sheetBtn.classList.toggle("active", sheetPicker);
}
picker.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-pen],[data-width],[data-dash],[data-color],[data-stencil],[data-paper]");
  if (!el) return;
  if (el.dataset.pen) instruments.setPenKind(el.dataset.pen as PenKind);
  else if (el.dataset.width) instruments.setWidth(Number(el.dataset.width));
  else if (el.hasAttribute("data-dash")) instruments.setDash(!instruments.pen.dash);
  else if (el.dataset.color) instruments.setColor(el.dataset.color);
  else if (el.dataset.stencil) {
    instruments.stencil = el.dataset.stencil as StencilShape;
    renderPicker();
  } else if (el.dataset.paper) {
    scene.setPaper(el.dataset.paper as PaperKind);
    sheetPicker = false;
    renderPicker();
  }
});
picker.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "custom-color") instruments.setColor(input.value);
});
for (const b of modeButtons) {
  b.addEventListener("click", () => {
    const mode = b.dataset.mode as Mode;
    const again = instruments.mode === mode && !sheetPicker;
    sheetPicker = false;
    pickerOpen = again ? !pickerOpen : true;
    instruments.setMode(mode);
    canvas.style.cursor = mode === "hand" ? "grab" : "crosshair";
  });
}
sheetBtn.addEventListener("click", () => {
  sheetPicker = !sheetPicker;
  pickerOpen = sheetPicker;
  renderPicker();
});
canvas.addEventListener("pointerdown", () => {
  if (!pickerOpen) return;
  pickerOpen = false;
  sheetPicker = false;
  renderPicker();
});
instruments.onChange = renderPicker;
renderPicker();
document.querySelector("#undo")!.addEventListener("click", () => instruments.undo());
document.querySelector("#redo")!.addEventListener("click", () => instruments.redo());
document.querySelector("#replay")!.addEventListener("click", () => paper.replay());

// Zoom and pan
const readout = document.querySelector<HTMLButtonElement>("#zoom-readout")!;
paper.onView = (v) => {
  readout.textContent = `${Math.round(v.k * 100)}%`;
};
document.querySelector("#zoom-in")!.addEventListener("click", () => paper.zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2));
document.querySelector("#zoom-out")!.addEventListener("click", () => paper.zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2));
readout.addEventListener("click", () => paper.fit());
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) paper.zoomAt(Math.exp(-e.deltaY * 0.004), e.clientX - r.left, e.clientY - r.top);
    else paper.panBy(-e.deltaX, -e.deltaY);
  },
  { passive: false },
);
let space = false;
let panning: { id: number; x: number; y: number } | null = null;
canvas.addEventListener(
  "pointerdown",
  (e) => {
    const pan = instruments.mode === "hand" || space || e.button === 1;
    if (!pan) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  },
  { capture: true },
);
canvas.addEventListener(
  "pointermove",
  (e) => {
    if (!panning || e.pointerId !== panning.id) return;
    e.stopImmediatePropagation();
    paper.panBy(e.clientX - panning.x, e.clientY - panning.y);
    panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
  },
  { capture: true },
);
const endPan = (e: PointerEvent) => {
  if (!panning || e.pointerId !== panning.id) return;
  e.stopImmediatePropagation();
  panning = null;
  canvas.style.cursor = instruments.mode === "hand" || space ? "grab" : "crosshair";
};
canvas.addEventListener("pointerup", endPan, { capture: true });
canvas.addEventListener("pointercancel", endPan, { capture: true });
window.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement)?.tagName === "INPUT";
  if (typing) return;
  if (e.key === "Escape") {
    pickerOpen = false;
    sheetPicker = false;
    renderPicker();
    openMenu(false);
  }
  if (e.code === "Space" && !e.repeat) {
    space = true;
    canvas.style.cursor = "grab";
    if (!strip.hidden) {
      e.preventDefault();
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) instruments.redo();
    else instruments.undo();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    instruments.redo();
  }
  if (e.key === "0" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    paper.fit();
  }
  if ((e.key === "=" || e.key === "+") && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    paper.zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2);
  }
  if (e.key === "-" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    paper.zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    space = false;
    canvas.style.cursor = instruments.mode === "hand" ? "grab" : "crosshair";
    if (!strip.hidden && !panning && (e.target as HTMLElement)?.tagName !== "INPUT") paper.toggle();
  }
});

// Timeline strip: appears once anything moves.
const strip = document.querySelector<HTMLElement>("#strip")!;
const playBtn = document.querySelector<HTMLButtonElement>("#play")!;
const clock = document.querySelector<HTMLElement>("#clock")!;
const scrub = document.querySelector<HTMLInputElement>("#scrub")!;
const ticks = document.querySelector<HTMLElement>("#ticks")!;
const loopBtn = document.querySelector<HTMLButtonElement>("#loop")!;
const onionBtn = document.querySelector<HTMLButtonElement>("#onion")!;
function syncStrip() {
  const { duration, loop, onion } = scene.timeline;
  strip.hidden = !scene.animated;
  scrub.max = String(duration);
  loopBtn.classList.toggle("active", loop);
  loopBtn.setAttribute("aria-pressed", String(loop));
  onionBtn.classList.toggle("active", onion);
  onionBtn.setAttribute("aria-pressed", String(onion));
  ticks.replaceChildren(
    ...keyTimes(scene.items).map((t) => {
      const el = document.createElement("i");
      el.style.left = `${(t / duration) * 100}%`;
      return el;
    }),
  );
}
paper.onTime = (time, playing) => {
  scrub.value = String(time);
  clock.textContent = `${time.toFixed(2)} / ${scene.timeline.duration.toFixed(2)}`;
  playBtn.innerHTML = icon(playing ? "pause" : "play");
  playBtn.title = playing ? "Pause" : "Play";
};
playBtn.addEventListener("click", () => paper.toggle());
scrub.addEventListener("input", () => {
  if (paper.playing) paper.pause();
  paper.seek(Number(scrub.value));
});
loopBtn.addEventListener("click", () => scene.setTimeline({ loop: !scene.timeline.loop }));
onionBtn.addEventListener("click", () => scene.setTimeline({ onion: !scene.timeline.onion }));

// Layers panel: opt-in, groups as layers, with visibility and z-order.
const layersEl = document.querySelector<HTMLElement>("#layers")!;
const layersToggle = document.querySelector<HTMLButtonElement>("#layers-toggle")!;
let layersOpen = false;
try {
  layersOpen = localStorage.getItem("desk-layers") === "open";
} catch {
  /* fine */
}
layersToggle.addEventListener("click", () => {
  layersOpen = !layersOpen;
  try {
    localStorage.setItem("desk-layers", layersOpen ? "open" : "closed");
  } catch {
    /* fine */
  }
  syncLayers();
});
function syncLayers() {
  const groups = new Map<string, { ids: string[]; hidden: boolean; moving: boolean }>();
  for (const item of scene.items) {
    const key = item.group ?? `· ${item.label}`;
    const g = groups.get(key) ?? { ids: [], hidden: true, moving: false };
    g.ids.push(item.id);
    g.hidden = g.hidden && !!item.hidden;
    g.moving = g.moving || !!item.motion;
    groups.set(key, g);
  }
  layersEl.hidden = !layersOpen || groups.size === 0;
  layersToggle.classList.toggle("active", layersOpen);
  layersToggle.setAttribute("aria-pressed", String(layersOpen));
  layersToggle.title = groups.size ? `Layers (${groups.size})` : "Layers";
  const rows = [...groups].reverse().map(([name, g]) => {
    const row = document.createElement("div");
    row.className = "layer" + (g.hidden ? " off" : "");
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye";
    eye.innerHTML = icon(g.hidden ? "eyeOff" : "eye");
    eye.title = g.hidden ? "show" : "hide";
    eye.setAttribute("aria-label", `${g.hidden ? "Show" : "Hide"} ${name}`);
    eye.addEventListener("click", () => {
      scene.update(
        g.ids.map((id) => {
          const item = scene.get(id)!;
          if (g.hidden) {
            const { hidden: _h, ...rest } = item;
            return rest as typeof item;
          }
          return { ...item, hidden: true };
        }),
      );
    });
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name.startsWith("· ") ? name.slice(2) : name;
    label.title = `${g.ids.length} mark${g.ids.length === 1 ? "" : "s"}${g.moving ? ", animated" : ""}`;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${g.moving ? "◆ " : ""}${g.ids.length}`;
    const up = document.createElement("button");
    up.type = "button";
    up.className = "order";
    up.innerHTML = icon("front");
    up.title = "bring to front";
    up.addEventListener("click", () => scene.reorder(g.ids, "front"));
    row.append(eye, label, meta, up);
    return row;
  });
  const title = document.createElement("div");
  title.className = "layers-title";
  title.textContent = "layers";
  layersEl.replaceChildren(title, ...rows);
}

// Menu under the wordmark: new, save, export, and the library of saved sheets.
const menu = document.querySelector<HTMLElement>("#menu")!;
const menuButton = document.querySelector<HTMLButtonElement>("#menu-button")!;
let currentSheetId: string | undefined;
let currentSheetName = "untitled";
function renderMenu() {
  const sheets = listSheets();
  menu.innerHTML = `
    <div class="menu-row">
      <button type="button" class="mitem" data-act="new">${icon("blank")}<span>New sheet</span></button>
      <button type="button" class="mitem" data-act="save">${icon("save")}<span>Save</span><kbd>⌘S</kbd></button>
    </div>
    <div class="menu-row">
      <button type="button" class="mitem" data-act="theme">${icon("blank")}<span>${theme === "charcoal" ? "Paper theme" : "Charcoal theme"}</span></button>
    </div>
    <div class="menu-row">
      <button type="button" class="mitem" data-act="png">${icon("export")}<span>PNG</span></button>
      <button type="button" class="mitem" data-act="svg">${icon("export")}<span>SVG</span></button>
      <button type="button" class="mitem" data-act="video" ${scene.animated ? "" : "disabled"}>${icon("video")}<span>Video</span></button>
    </div>
    <div class="menu-title">${icon("library")}<span>library</span><em>${sheets.length ? `${sheets.length} saved` : "nothing saved yet"}</em></div>
    <div class="library">
      ${sheets
        .map(
          (s) => `<div class="card${s.id === currentSheetId ? " current" : ""}" data-id="${s.id}">
        <img src="${s.thumb}" alt="" />
        <div class="card-meta"><span class="card-name">${s.name.replace(/[<>&]/g, "")}</span><span class="card-date">${new Date(s.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div>
        <button type="button" class="card-delete" data-delete="${s.id}" title="delete">${icon("trash")}</button>
      </div>`,
        )
        .join("")}
    </div>`;
}
function openMenu(open: boolean) {
  menu.hidden = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  if (open) renderMenu();
}
menuButton.addEventListener("click", () => openMenu(Boolean(menu.hidden)));
document.addEventListener("pointerdown", (e) => {
  if (menu.hidden) return;
  const t = e.target as HTMLElement;
  if (!menu.contains(t) && t !== menuButton) openMenu(false);
});
function save() {
  const thumb = thumbnail(paper.snapshot(0.3));
  const name = currentSheetId ? currentSheetName : window.prompt("Name this sheet", currentSheetName) ?? "";
  if (!name.trim()) return;
  const saved = saveSheet({ id: currentSheetId, name: name.trim(), paper: scene.paper, timeline: scene.timeline, items: scene.items, thumb });
  if (!saved) {
    addNotice("Couldn't save: this browser's storage is full or blocked.", "alert");
    return;
  }
  currentSheetId = saved.id;
  currentSheetName = saved.name;
  addNotice(`Saved “${saved.name}”.`);
  if (!menu.hidden) renderMenu();
}
menu.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const del = target.closest<HTMLElement>("[data-delete]");
  if (del) {
    deleteSheet(del.dataset.delete!);
    if (currentSheetId === del.dataset.delete) currentSheetId = undefined;
    renderMenu();
    return;
  }
  const card = target.closest<HTMLElement>(".card");
  if (card) {
    const sheet = listSheets().find((s) => s.id === card.dataset.id);
    if (!sheet) return;
    scene.load({ items: sheet.items, paper: sheet.paper, timeline: sheet.timeline });
    currentSheetId = sheet.id;
    currentSheetName = sheet.name;
    paper.fit();
    openMenu(false);
    return;
  }
  const item = target.closest<HTMLElement>("[data-act]");
  if (!item) return;
  switch (item.dataset.act) {
    case "new":
      if (scene.items.length && !window.confirm("Start a new sheet? Unsaved marks are lost.")) return;
      scene.clear();
      currentSheetId = undefined;
      currentSheetName = "untitled";
      paper.fit();
      openMenu(false);
      break;
    case "save":
      save();
      break;
    case "theme":
      toggleTheme();
      renderMenu();
      break;
    case "png":
      await exportPNG(paper, `${currentSheetName}.png`);
      openMenu(false);
      break;
    case "svg":
      exportSVG(scene, theme, paper.time, `${currentSheetName}.svg`);
      openMenu(false);
      break;
    case "video":
      openMenu(false);
      addNotice("Recording one loop…");
      try {
        await exportVideo(canvas, paper, scene, `${currentSheetName}.webm`);
      } catch (err) {
        addNotice(err instanceof Error ? err.message : String(err), "alert");
      }
      break;
  }
});
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    save();
  }
});

// Scene-driven UI state
const hint = document.querySelector<HTMLElement>("#hint")!;
const paperStatus = document.querySelector<HTMLElement>("#paper-status")!;
scene.on((e) => {
  if (e.type === "paper" || e.type === "clear") renderPicker();
  hint.hidden = scene.items.length > 0;
  paperStatus.textContent = `The ${scene.paper} sheet has ${scene.items.length} ${scene.items.length === 1 ? "mark" : "marks"}.`;
  if (e.type === "motion" || e.type === "timeline" || e.type === "clear" || e.type === "remove") syncStrip();
  syncLayers();
});

// Pointer readout in paper units, useful when talking to the agent about positions.
const cursorEl = document.querySelector<HTMLElement>("#cursor")!;
canvas.addEventListener("pointermove", (e) => {
  const p = paper.toPaper(e);
  cursorEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
});
canvas.addEventListener("pointerleave", () => (cursorEl.textContent = ""));

// Agent status chip
const agentChip = document.querySelector<HTMLElement>("#agent")!;
const agentLabel = document.querySelector<HTMLElement>("#agent-label")!;
let activeUntil = 0;
let idleLabel = "agent: connecting";
let activityTimer: ReturnType<typeof setTimeout> | undefined;
function setAgentActive(active: boolean) {
  if (active) {
    if (activityTimer !== undefined) clearTimeout(activityTimer);
    activeUntil = performance.now() + 600;
    agentChip.className = "chip on";
    agentLabel.textContent = "agent: drawing";
    return;
  }
  const settle = () => {
    const remaining = activeUntil - performance.now();
    if (remaining > 0) {
      activityTimer = setTimeout(settle, remaining);
      return;
    }
    activityTimer = undefined;
    if (paper.busy) return;
    agentChip.className = "chip";
    agentLabel.textContent = idleLabel;
  };
  if (activityTimer !== undefined) clearTimeout(activityTimer);
  activityTimer = setTimeout(settle, Math.max(0, activeUntil - performance.now()));
}
paper.onActivity = setAgentActive;

registerDesk(
  scene,
  paper,
  {
    onActivity: setAgentActive,
    onTool(name, source) {
      agentChip.title = `last tool: ${name} (${source})`;
    },
  },
  { waitMs: 3000 },
).then((desk) => {
  (window as unknown as { desk: unknown }).desk = desk;
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) desk.dispose();
  });
  if (desk.connected) {
    agentChip.className = "chip";
    idleLabel = "agent: ready";
    agentLabel.textContent = idleLabel;
    agentChip.title = `${desk.registered.length} instruments registered with WebMCP`;
    return;
  }
  if (desk.registrationErrors.length > 0) {
    agentChip.className = "chip off";
    idleLabel = `agent: ${desk.registered.length}/${desk.names.length} tools`;
    agentLabel.textContent = idleLabel;
    addNotice(`${desk.registrationErrors.length} of ${desk.names.length} instruments failed to register: ${desk.registrationErrors.join("; ")}`, "alert");
    return;
  }
  idleLabel = "agent: unavailable";
  agentLabel.textContent = idleLabel;
  const n = document.createElement("div");
  n.className = "notice";
  n.innerHTML = `This browser has no WebMCP, so an agent can't pick up the pens. Open Desk in ChatGPT's browser, or in Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> on. You can still draw.`;
  stage.appendChild(n);
}).catch((error: unknown) => {
  agentChip.className = "chip off";
  idleLabel = "agent: failed";
  agentLabel.textContent = idleLabel;
  addNotice(`Desk could not register its instruments: ${error instanceof Error ? error.message : String(error)}`, "alert");
});

function addNotice(message: string, role: "status" | "alert" = "status") {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.setAttribute("role", role);
  notice.textContent = message;
  stage.appendChild(notice);
  if (role === "status") setTimeout(() => notice.remove(), 2600);
}

void PEN_PRESETS;
