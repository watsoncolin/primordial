import { defineConfig } from 'vite'

// GitHub Pages serves the game from /primordial/; local dev and other hosts use the root.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
})
