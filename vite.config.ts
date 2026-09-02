import { defineConfig } from "vite";

// Relative base so the build works at a domain root (Vercel) or under a path (GitHub Pages).
export default defineConfig({ base: "./" });
