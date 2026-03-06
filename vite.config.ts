import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages project pages are served at /<repo-name>/
  // Set base to match so asset paths resolve correctly after deploy.
  // For local dev this is overridden by the --base flag not being set,
  // so localhost:5173 continues to work as-is.
  base: "/Whiteboard-AI/",
});
