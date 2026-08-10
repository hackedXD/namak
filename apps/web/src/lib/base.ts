// Base-path helper for internal links.
//
// Why this exists: on Cloudflare Pages (the production target) and in local dev
// the site is served from the domain root, so `import.meta.env.BASE_URL` is "/"
// and `withBase` is a pure no-op. On GitHub Pages the project site lives under a
// sub-path ("https://<user>.github.io/namak/"), so Astro is built with
// `base: "/namak"` and BASE_URL becomes "/namak/". Astro rewrites bundled asset
// URLs (CSS/JS/fonts/imported images) to include the base automatically, but it
// does NOT touch hand-written links like `href="/scan"` — those we prefix here.
//
// Keep the logical, root-relative path everywhere in the code ("/scan",
// "/medicine/dolo-650") and wrap it with `withBase(...)` at the point where it
// becomes a real href or a navigation. That keeps the whole thing reversible:
// drop the base from astro.config and every `withBase` collapses back to identity.

const BASE_URL: string = import.meta.env.BASE_URL; // "/" or "/namak/"

/** Prefix a root-relative app path with the configured base. External URLs,
 *  bare anchors ("#x") and already-based paths are returned unchanged. */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path; // "#main", "https://…", "mailto:…"
  const base = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL; // "" or "/namak"
  if (!base) return path; // root deploy: identity
  if (path === '/') return base + '/';
  return base + path; // "/namak" + "/scan"
}
