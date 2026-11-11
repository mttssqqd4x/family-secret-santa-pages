import { defineConfig } from 'vite';
export default defineConfig({
  // GitHub Pages project sites live under /REPOSITORY-NAME/.
  base: process.env.GITHUB_PAGES_BASE || '/',
});
