import { defineConfig } from 'astro/config';

// Interaction plane (§6.1): Astro SSG + islands, zero JS by default.
export default defineConfig({
  site: 'https://salt.health',
  devToolbar: { enabled: false },
});
