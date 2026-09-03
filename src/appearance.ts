export type Theme = "charcoal" | "paper";

// One palette feeds both the DOM and the canvas. Neither dark surface is black.
export const THEMES = {
  charcoal: {
    desk: "#1e201e", paper: "#292c29", ink: "#ebe8dc", muted: "#acafa5",
    tray: "#252825", line: "#454942", grid: "#363b35", agent: "#b3b9ee",
  },
  paper: {
    desk: "#e8e3d9", paper: "#fcfbf7", ink: "#252820", muted: "#606356",
    tray: "#f5f2eb", line: "#d4d1c7", grid: "#e9e8df", agent: "#5759ac",
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
