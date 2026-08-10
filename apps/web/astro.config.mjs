import { defineConfig } from 'astro/config';

// Interaction plane (§6.1): Astro SSG + islands, zero JS by default.
//
// Base path is env-gated so the same source deploys to two targets unchanged:
//   • Cloudflare Pages (production) and local dev  → served at the domain root,
//     PAGES_BASE unset, base is undefined, `withBase()` is a no-op.
//   • GitHub Pages (temporary live preview)        → served under /namak/, the
//     Pages workflow sets PAGES_BASE=/namak and site to the github.io origin.
// To revert to Cloudflare-only, just stop setting PAGES_BASE (or delete the
// GitHub Pages workflow) — nothing else changes.
const PAGES_BASE = process.env.PAGES_BASE; // e.g. "/namak" on GitHub Pages
const SITE = process.env.PAGES_SITE || 'https://salt.health';

export default defineConfig({
  site: SITE,
  ...(PAGES_BASE ? { base: PAGES_BASE } : {}),
  devToolbar: { enabled: false },
});
