export type Theme = "charcoal" | "paper";

// One palette feeds both the DOM and the canvas. Paper is warm stone and white;
// charcoal is a neutral dark with no color cast. Agent violet is shared.
export const THEMES = {
  paper: {
    desk: "#ecebe6", paper: "#fbfaf8", ink: "#1b1a17", muted: "#6a675f",
    tray: "#ffffff", line: "#dedbd3", grid: "#e8e6df", agent: "#5b5bd6",
  },
  charcoal: {
    desk: "#141414", paper: "#1c1c1c", ink: "#f2efe9", muted: "#8f8c85",
    tray: "#212121", line: "#2f2f2f", grid: "#262626", agent: "#8b8cf0",
  },
} as const;

export function inkColor(color: string, theme: Theme): string {
  return color === "auto" ? THEMES[theme].ink : color;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "charcoal" ? "dark" : "light";
  for (const [name, value] of Object.entries(THEMES[theme])) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
}
