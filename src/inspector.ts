// The inspector is the panel for whatever is selected: one place to read a
// mark's identity and to restyle its ink, fill, effects and place in the stack.
// Every edit goes through the scene like any other instrument, so agents see the
// same result a person would, and nothing here mutates an item in place.

import { align, distribute, type Align, type Axis } from "./arrange.ts";
import type { Instruments } from "./instruments.ts";
import type { Paper } from "./paper.ts";
import { PALETTE, type Fill, type Item, type Pen, type PenKind, type Scene, type Texture } from "./scene.ts";

export interface InspectorContext {
  scene: Scene;
  paper: Paper;
  instruments: Instruments;
  host: HTMLElement;
  selection: () => string[];
}

export interface Inspector {
  refresh(): void;
}

/**
 * One change to make to every selected mark. A key inside `pen` set to
 * `undefined` clears that setting rather than storing an empty value, which is
 * how "none" is spelled for fills, textures and effects.
 */
export interface MarkPatch {
  pen?: Partial<Pen>;
  label?: string;
  group?: string;
  hidden?: boolean;
}

/** Copies of the given marks with the patch applied. Pure: the originals are untouched. */
export function applyPatch(items: Item[], patch: MarkPatch): Item[] {
  return items.map((item) => {
    const next = { ...item } as Item;
    if (patch.pen) next.pen = patchPen(item.pen, patch.pen);
    if (patch.label !== undefined) next.label = patch.label;
    if ("group" in patch) {
      if (patch.group) next.group = patch.group;
      else delete next.group;
    }
    if (patch.hidden !== undefined) {
      if (patch.hidden) next.hidden = true;
      else delete next.hidden;
    }
    return next;
  });
}

/** A fresh pen with the patch merged in; keys given as `undefined` are dropped. */
function patchPen(pen: Pen, patch: Partial<Pen>): Pen {
  const next: Pen = { ...pen, ...patch };
  for (const key of Object.keys(patch) as (keyof Pen)[]) {
    // The cast is only to let `delete` touch keys the Pen type marks required;
    // no caller ever clears kind, color, width or opacity.
    if (patch[key] === undefined) delete (next as unknown as Record<string, unknown>)[key];
  }
  return next;
}

const INKS: [string, string][] = [
  ["ink", PALETTE.ink],
  ["accent", PALETTE.accent],
  ["blue", PALETTE.blue],
  ["green", PALETTE.green],
  ["ochre", PALETTE.ochre],
];
const PEN_KINDS: PenKind[] = ["pencil", "fineliner", "marker", "brush", "highlighter"];
const FILLS: Fill[] = ["hatch", "crosshatch", "stipple"];
const TEXTURES: Texture[] = ["grain", "chalk"];

const DEFAULT_SHADOW = { dx: 4, dy: 4, blur: 8, color: "#000000" };
const DEFAULT_GLOW = { blur: 12, color: "#5b5bd6" };

// The panel's glyphs are drawn here rather than pulled from the icon set: the
// set has no align or distribute marks, and keeping this module free of the
// set's raw-SVG imports lets it load outside a bundler. Same hand-wobbled
// spirit: the edge a mark lands on, and what lines up on it.
const doodle = (d: string) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EYE = doodle(
  '<path d="M2.9 12.2c3.3-4.4 6.9-6.4 10.3-6.2 3 .2 5.9 2.3 7.9 6.1-3.2 4.3-6.5 6.2-9.8 6.1-3.1-.1-5.9-2.1-8.4-6z"/><path d="M12.3 9.7c1.3-.1 2.5.9 2.5 2.3 0 1.4-1.1 2.5-2.4 2.5-1.4 0-2.4-1.2-2.3-2.5.1-1.2.9-2.2 2.2-2.3z"/>',
);
const EYE_OFF = doodle(
  '<path d="M2.9 12.2c3.3-4.4 6.9-6.4 10.3-6.2 3 .2 5.9 2.3 7.9 6.1-3.2 4.3-6.5 6.2-9.8 6.1-3.1-.1-5.9-2.1-8.4-6z"/><path d="M4.6 4.3c5.2 4.9 10.2 9.9 15.1 15.2"/>',
);
const ARRANGE_ICONS: Record<string, string> = {
  left: doodle('<path d="M4.5 4.2c-.3 5.2.2 10.4-.1 15.6"/><path d="M7.2 8.6c3.4-.4 6.8.2 10.2-.2"/><path d="M7.2 15.4c2.2-.4 4.5.2 6.7-.2"/>'),
  center: doodle('<path d="M12 4.2c-.3 5.2.2 10.4-.1 15.6"/><path d="M5.4 8.6c4.4-.4 8.8.2 13.2-.2"/><path d="M8.2 15.4c2.5-.4 5 .2 7.6-.2"/>'),
  right: doodle('<path d="M19.5 4.2c-.3 5.2.2 10.4-.1 15.6"/><path d="M6.6 8.6c3.4-.4 6.8.2 10.2-.2"/><path d="M10.1 15.4c2.2-.4 4.5.2 6.7-.2"/>'),
  top: doodle('<path d="M4.2 4.5c5.2-.3 10.4.2 15.6-.1"/><path d="M8.6 7.2c-.4 3.4.2 6.8-.2 10.2"/><path d="M15.4 7.2c-.4 2.2.2 4.5-.2 6.7"/>'),
  middle: doodle('<path d="M4.2 12c5.2-.3 10.4.2 15.6-.1"/><path d="M8.6 5.4c-.4 4.4.2 8.8-.2 13.2"/><path d="M15.4 8.2c-.4 2.5.2 5-.2 7.6"/>'),
  bottom: doodle('<path d="M4.2 19.5c5.2-.3 10.4.2 15.6-.1"/><path d="M8.6 6.6c-.4 3.4.2 6.8-.2 10.2"/><path d="M15.4 10.1c-.4 2.2.2 4.5-.2 6.7"/>'),
  horizontal: doodle('<path d="M4.5 5c-.3 4.6.2 9.2-.1 13.8"/><path d="M12 5c-.3 4.6.2 9.2-.1 13.8"/><path d="M19.5 5c-.3 4.6.2 9.2-.1 13.8"/>'),
  vertical: doodle('<path d="M5 4.5c4.6-.3 9.2.2 13.8-.1"/><path d="M5 12c4.6-.3 9.2.2 13.8-.1"/><path d="M5 19.5c4.6-.3 9.2.2 13.8-.1"/>'),
};

export function mountInspector(ctx: InspectorContext): Inspector {
  const host = ctx.host;
  // A render we had to skip to protect someone's typing, replayed once they leave.
  let stale = false;

  /** True while a text field, slider or select inside the panel is being used. */
  function editing(): boolean {
    if (typeof document === "undefined") return false;
    const active = document.activeElement;
    if (!active || !host.contains(active)) return false;
    const tag = active.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }

  function selected(): Item[] {
    const items: Item[] = [];
    for (const id of ctx.selection()) {
      const item = ctx.scene.get(id);
      if (item) items.push(item);
    }
    return items;
  }

  /**
   * Write one change to every selected mark and repaint. A patch may be built
   * from the first mark's pen as it stands now, which matters for the grouped
   * effect settings: moving between two of their sliders never re-renders the
   * panel, so a captured copy of the effect would be a frame behind.
   */
  function apply(patch: MarkPatch | ((pen: Pen) => MarkPatch)) {
    const items = selected();
    if (items.length === 0) return;
    ctx.scene.update(applyPatch(items, typeof patch === "function" ? patch(items[0].pen) : patch));
    ctx.paper.invalidate();
  }

  /** Arrange helpers hand back the marks they moved; put them in the scene. */
  function arranged(items: Item[]) {
    if (items.length > 0) ctx.scene.update(items);
    ctx.paper.invalidate();
    render();
  }

  function render() {
    const items = selected();
    if (items.length === 0) {
      host.replaceChildren();
      stale = false;
      return;
    }
    if (editing()) {
      stale = true;
      return;
    }
    stale = false;
    host.replaceChildren(
      headerSection(items, apply),
      strokeSection(items, apply),
      fillSection(items, apply),
      effectsSection(items, apply),
      arrangeSection(items, ctx, apply, arranged),
    );
  }

  // Leaving a field is the moment to catch up. The timeout lets focus land
  // first, so tabbing from one field to the next does not yank the panel apart.
  host.addEventListener("focusout", () => {
    if (!stale) return;
    setTimeout(() => {
      if (stale && !editing()) render();
    }, 0);
  });

  render();
  return { refresh: render };
}

type Apply = (patch: MarkPatch | ((pen: Pen) => MarkPatch)) => void;

function headerSection(items: Item[], apply: Apply): HTMLElement {
  const first = items[0];
  const sec = section("selection");
  const count = el("span", "insp-count");
  count.textContent = `${items.length} mark${items.length === 1 ? "" : "s"} selected`;
  sec.append(count);
  // A label names one mark; naming several at once would make them all the same.
  if (items.length === 1) {
    sec.append(row("label", textInput(first.label, "unnamed", (value) => apply({ label: value }))));
  }
  sec.append(row("group", textInput(first.group ?? "", "none", (value) => apply({ group: value }))));
  return sec;
}

function strokeSection(items: Item[], apply: Apply): HTMLElement {
  const pen = items[0].pen;
  const sec = section("stroke");
  sec.append(
    row("color", ...inkSwatches(pen.color, (color) => apply({ pen: { color } }))),
    row("width", slider(1, 64, 0.5, pen.width, (v) => v.toFixed(v < 10 ? 1 : 0), (width) => apply({ pen: { width } }))),
    row("opacity", slider(0.05, 1, 0.05, pen.opacity, (v) => `${Math.round(v * 100)}%`, (opacity) => apply({ pen: { opacity } }))),
    row("pen", picker(PEN_KINDS.map((k) => [k, k] as [string, string]), pen.kind, (kind) => apply({ pen: { kind: kind as PenKind } }))),
    row(
      "texture",
      picker([["none", "none"], ...TEXTURES.map((t) => [t, t] as [string, string])], pen.texture ?? "none", (value) =>
        apply({ pen: { texture: value === "none" ? undefined : (value as Texture) } }),
      ),
    ),
    row(
      "line",
      toggle("dashed", !!pen.dash, (on) => apply({ pen: { dash: on || undefined } })),
      toggle("tapered", !!pen.taper, (on) => apply({ pen: { taper: on || undefined } })),
    ),
  );
  return sec;
}

function fillSection(items: Item[], apply: Apply): HTMLElement {
  const pen = items[0].pen;
  const sec = section("fill");
  const swatches = inkSwatches(pen.fillColor, (fillColor) => apply({ pen: { fillColor } }));
  swatches.push(toggle("none", !pen.fillColor, () => apply({ pen: { fillColor: undefined } })));
  sec.append(
    row("color", ...swatches),
    row(
      "pattern",
      picker([["none", "none"], ...FILLS.map((f) => [f, f] as [string, string])], pen.fill ?? "none", (value) =>
        apply({ pen: { fill: value === "none" ? undefined : (value as Fill) } }),
      ),
    ),
  );
  // The hatch angle only means something once there are hatch lines to turn.
  if (pen.fill === "hatch" || pen.fill === "crosshatch") {
    sec.append(row("angle", slider(0, 180, 5, pen.hatchAngle ?? 45, (v) => `${Math.round(v)}°`, (hatchAngle) => apply({ pen: { hatchAngle } }))));
  }
  return sec;
}

function effectsSection(items: Item[], apply: Apply): HTMLElement {
  const pen = items[0].pen;
  const sec = section("effects");
  const shadow = pen.shadow;
  sec.append(
    row("shadow", toggle(shadow ? "on" : "off", !!shadow, (on) => apply({ pen: { shadow: on ? { ...DEFAULT_SHADOW } : undefined } }))),
  );
  if (shadow) {
    const edit = (patch: Partial<typeof shadow>) =>
      apply((live) => ({ pen: { shadow: { ...(live.shadow ?? DEFAULT_SHADOW), ...patch } } }));
    sec.append(
      row("shift x", slider(-40, 40, 1, shadow.dx, (v) => `${Math.round(v)}`, (dx) => edit({ dx }))),
      row("shift y", slider(-40, 40, 1, shadow.dy, (v) => `${Math.round(v)}`, (dy) => edit({ dy }))),
      row("soften", slider(0, 60, 1, shadow.blur, (v) => `${Math.round(v)}`, (blur) => edit({ blur }))),
      row("tint", colorInput(shadow.color, (color) => edit({ color }))),
    );
  }
  const glow = pen.glow;
  sec.append(row("glow", toggle(glow ? "on" : "off", !!glow, (on) => apply({ pen: { glow: on ? { ...DEFAULT_GLOW } : undefined } }))));
  if (glow) {
    const edit = (patch: Partial<typeof glow>) =>
      apply((live) => ({ pen: { glow: { ...(live.glow ?? DEFAULT_GLOW), ...patch } } }));
    sec.append(
      row("spread", slider(0, 60, 1, glow.blur, (v) => `${Math.round(v)}`, (blur) => edit({ blur }))),
      row("tint", colorInput(glow.color, (color) => edit({ color }))),
    );
  }
  // Zero is off, so the key comes back out of the pen rather than sitting at 0.
  sec.append(row("blur", slider(0, 20, 0.5, pen.blur ?? 0, (v) => v.toFixed(1), (blur) => apply({ pen: { blur: blur > 0 ? blur : undefined } }))));
  return sec;
}

function arrangeSection(items: Item[], ctx: InspectorContext, apply: Apply, arranged: (moved: Item[]) => void): HTMLElement {
  const sec = section("arrange");
  const ids = () => items.map((i) => i.id);
  const alignRow = (how: Align[]) =>
    iconRow(how.map((h) => [h, ARRANGE_ICONS[h], () => arranged(align(ctx.scene, ids(), h))] as [string, string, () => void]));
  sec.append(
    row("align", alignRow(["left", "center", "right"])),
    row("", alignRow(["top", "middle", "bottom"])),
    row(
      "space",
      iconRow((["horizontal", "vertical"] as Axis[]).map((axis) => [axis, ARRANGE_ICONS[axis], () => arranged(distribute(ctx.scene, ids(), axis))] as [string, string, () => void])),
    ),
    row(
      "order",
      pill("front", () => {
        ctx.scene.reorder(ids(), "front");
        ctx.paper.invalidate();
      }),
      pill("back", () => {
        ctx.scene.reorder(ids(), "back");
        ctx.paper.invalidate();
      }),
      // The eye matches the layers list, where hiding a mark is the same gesture.
      iconRow([[items[0].hidden ? "show" : "hide", items[0].hidden ? EYE_OFF : EYE, () => apply({ hidden: !items[0].hidden })]]),
    ),
  );
  return sec;
}

// --- small builders, in the app's existing tray vocabulary ---

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function section(title: string): HTMLElement {
  const sec = el("section", "insp-sec");
  const heading = el("h4", "insp-title");
  heading.textContent = title;
  sec.append(heading);
  return sec;
}

function row(label: string, ...controls: Node[]): HTMLElement {
  const r = el("div", "insp-row");
  const name = el("span", "insp-label");
  name.textContent = label;
  const holder = el("div", "insp-ctl");
  holder.append(...controls);
  r.append(name, holder);
  return r;
}

/** The named inks plus a custom color well, matching the tray's color picker. */
function inkSwatches(current: string | undefined, pick: (color: string) => void): HTMLElement[] {
  const named = INKS.map(([name, color]) => {
    const b = el("button", `swatch${current === color ? " active" : ""}`);
    b.type = "button";
    b.title = name;
    b.setAttribute("aria-label", name);
    b.style.setProperty("--swatch", color === "auto" ? "var(--ink)" : color);
    b.addEventListener("click", () => pick(color));
    return b;
  });
  const isNamed = INKS.some(([, color]) => color === current);
  const custom = el("label", `swatch custom${current && !isNamed ? " active" : ""}`);
  custom.title = "custom color";
  custom.style.setProperty("--swatch", current && !isNamed ? current : "transparent");
  const input = el("input");
  input.type = "color";
  input.value = hex(current) ?? "#dc716b";
  input.setAttribute("aria-label", "custom color");
  input.addEventListener("input", () => pick(input.value));
  custom.append(input);
  return [...named, custom];
}

function colorInput(value: string, pick: (color: string) => void): HTMLInputElement {
  const input = el("input", "insp-color");
  input.type = "color";
  input.value = hex(value) ?? "#000000";
  input.addEventListener("input", () => pick(input.value));
  return input;
}

/** `#rrggbb` if the color is already one, since that is all a color well accepts. */
function hex(color: string | undefined): string | undefined {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

function textInput(value: string, placeholder: string, commit: (value: string) => void): HTMLInputElement {
  const input = el("input", "insp-text");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("input", () => commit(input.value));
  return input;
}

function picker(options: [string, string][], value: string, pick: (value: string) => void): HTMLSelectElement {
  const sel = el("select", "insp-select");
  for (const [option, text] of options) {
    const node = el("option");
    node.value = option;
    node.textContent = text;
    node.selected = option === value;
    sel.append(node);
  }
  sel.value = value;
  sel.addEventListener("change", () => pick(sel.value));
  return sel;
}

function slider(
  min: number,
  max: number,
  step: number,
  value: number,
  format: (value: number) => string,
  commit: (value: number) => void,
): HTMLElement {
  const wrap = el("div", "insp-slider");
  const input = el("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const readout = el("span", "insp-num");
  readout.textContent = format(value);
  // The readout follows the thumb locally: the panel does not re-render while a
  // control has focus, so it has to keep itself honest.
  input.addEventListener("input", () => {
    const next = Number(input.value);
    readout.textContent = format(next);
    commit(next);
  });
  wrap.append(input, readout);
  return wrap;
}

/** A pill that performs an action rather than holding a state. */
function pill(text: string, press: () => void): HTMLButtonElement {
  const b = el("button", "insp-toggle");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", press);
  return b;
}

function toggle(text: string, on: boolean, flip: (next: boolean) => void): HTMLButtonElement {
  const b = el("button", `insp-toggle${on ? " on" : ""}`);
  b.type = "button";
  b.textContent = text;
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", () => flip(!on));
  return b;
}

function iconRow(buttons: [string, string, () => void][]): HTMLElement {
  const wrap = el("div", "insp-icons");
  for (const [name, svg, press] of buttons) {
    const b = el("button", "tool");
    b.type = "button";
    b.title = name;
    b.setAttribute("aria-label", name);
    b.innerHTML = svg;
    b.addEventListener("click", press);
    wrap.append(b);
  }
  return wrap;
}
