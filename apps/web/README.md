# @salt/web

The interaction plane (design §6): an Astro site (SSG + islands) — the front-end
prototype, fully navigable on **demo data**.

## Design system

- **Type:** Fraunces (editorial serif display) · Hanken Grotesk (UI) · JetBrains
  Mono (tabular numbers/prices), all self-hosted via @fontsource (no CDN).
- **Palette:** warm cream paper · ink · pine-teal (trust) · saffron (aushadhi) ·
  leaf (savings) · clay (overcharge) · gold (the legal maximum). Light + dark,
  system-aware with a manual toggle. Tokens in `src/styles/tokens.css`.
- **Motion:** scroll-reveal (staggered), count-up numbers, condensing header,
  Astro View Transitions between pages, tactile custom buttons — all respecting
  `prefers-reduced-motion`. `src/lib/motion.ts`, `src/styles/buttons.css`.

## Pages / functionality (all working on demo data)

- `/` home · `/search` results (live autocomplete in the header)
- `/medicine/[slug]` — the price ladder workhorse: live quantity, pincode → nearby
  kendras, and overcharge check
- `/molecule/[slug]` · `/formulation/[slug]` — formulation ladders
- `/check-price` — standalone overcharge checker + NPPA complaint route
- `/scan` — mock two-stage OCR flow with per-line confirmation → basket
- `/basket` — multi-line totals & savings · `/compare` — two-product comparison
- `/kendra` — pincode → nearest Jan Aushadhi outlets
- `/methodology` · `/sources` — the trust surfaces

## Demo data — important

Everything is powered by `src/lib/mock.ts`, clearly labelled **demo data** (a
persistent banner marks every page). Prices/brands are illustrative for previewing
the interface — the ranking, ceiling and overcharge **maths are real** (see
`src/lib/ladder.ts`, which mirrors `@salt/pricing`). In production this layer is
replaced by the `/v1` API over real ingested data. No demo data touches the
ingestion/canonical path.

## Run

```bash
pnpm --filter @salt/web dev       # dev server
pnpm --filter @salt/web build     # static build (64 pages)
pnpm --filter @salt/web preview   # preview the build
```
