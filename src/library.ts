// Saved sheets live in this browser. Enough for a person to keep their work
// between sessions and come back to it from the DESK menu.

import type { Item, PaperKind, Timeline } from "./scene.ts";

export interface SavedSheet {
  id: string;
  name: string;
  savedAt: number;
  paper: PaperKind;
  timeline: Timeline;
  items: Item[];
  /** Small PNG data URL for the library card. */
  thumb: string;
}

const KEY = "desk-library";

export function listSheets(): SavedSheet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedSheet[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

export function saveSheet(sheet: Omit<SavedSheet, "id" | "savedAt"> & { id?: string }): SavedSheet | null {
  const list = listSheets().filter((s) => s.id !== sheet.id);
  const saved: SavedSheet = { ...sheet, id: sheet.id ?? `s${Date.now().toString(36)}`, savedAt: Date.now() };
  list.unshift(saved);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
    return saved;
  } catch {
    return null;
  }
}

export function deleteSheet(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(listSheets().filter((s) => s.id !== id)));
  } catch {
    /* nothing to do */
  }
}

/** A short thumbnail from a rendered sheet canvas. */
export function thumbnail(source: HTMLCanvasElement, width = 240): string {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((width * source.height) / source.width);
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}
