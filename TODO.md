# Salt — founder / manual TODO list

Things only you can do, or that need a decision, an account, or a run from an
Indian IP. I'll keep building everything that *isn't* blocked on these. Each item
says what's blocked and what I'll do once it's unblocked.

Last updated: 2026-08-10.

---

## A. Probes to run from an Indian IP (the live gov portals block CI/datacenter egress)

- [ ] **S2 — Jan Aushadhi kendra directory.** Run `spikes/s2-kendra/probe.py`
      (stdlib only) from your machine in India. It hits the `janaushadhi:8443`
      kendra endpoints and reports: full list vs paginated, plain JSON vs
      AES-encrypted, Turnstile/captcha, and whether lat/lng are included.
      → Hand back `kendra.json` (or point me at the Google-Drive folder) and I'll
      wire the S2 ingestion source (→ geohash7 → proximity query), finishing
      Milestone 3.
- [ ] **U1 — Pharma Sahi Daam enumerability.** Run `spikes/u1-ipdms/` (probe.mjs
      + reachability.sh) from an Indian IP to answer: JSON endpoint? wildcard vs
      exact-name? captcha/rate-limit? stable pagination cursors?
      → Decides how/whether we ingest brand-level prices (S5). Not on the critical
      path until after the engines.
- [ ] **S1 — PMBJP product catalogue** (when we get to it). Its live API is on the
      same blocked `janaushadhi:8443` (`getAllProductForWeb`). Before any India
      egress box, we probe free channels: the Google-Drive folder the app
      references, and `data.gov.in`. I'll prep an S1 probe like the S2 one when S1
      comes up.

## B. Decisions / sign-offs only you own

- [ ] **NTI list clinical sign-off** (design Part 15 **U6**). The narrow-therapeutic-
      index blocklist (warfarin, levothyroxine, phenytoin, …) needs a **named
      pharmacist** to review, date, and cite it before the equivalence engine can
      ship (Milestone 7). I'll draft the list from the design + literature; it is
      not usable until a real clinician signs off. Decide: contract pharmacist vs
      advisory board.
- [ ] **NPPA ceiling currency.** The ingested Compendium is **2022** (latest
      CI-reachable consolidated list). Before launch we must ingest newer WPI /
      ceiling notifications so users see *current* legal maxima. Help needed:
      confirm the authoritative latest source (egazette / NPPA notifications).
- [ ] **License register review.** S10 uses **GeoNames (CC-BY 4.0)** — a tier-2
      community source, attribution required. Confirm you're OK surfacing it as
      tier-2 on `/sources` (I've tagged it as such).
- [ ] **India-egress box** (only if free channels fail for S1/S2/S5). We agreed to
      exhaust free channels first. If needed later: Oracle Cloud Always Free
      (Hyderabad/Mumbai) — an always-on box to set up. Flagged because it's the
      first thing that could carry cost/ops.
- [ ] **LLM adjudicator (resolver Tier 3).** The resolver has an injected LLM port
      but no adapter/API key wired (zero cost so far). When product→formulation
      coverage needs the last 5–10%, decide a vision/LLM provider + key (~₹0.05/row,
      §4.2). Until then the resolver routes those to human review — safe, just lower
      recall.
- [ ] Future Part-15 calls (not yet due): **U2** e-pharmacy channel, **U3** SaMD
      legal opinion (counsel, before OCR), **U4** consumer accounts, **U7** kendra
      stock partnership, **U8** OCR handwriting corpus.

## C. Accounts / infra for later milestones (Milestone 8+)

- [ ] **Cloudflare account** — Pages, Workers, D1, KV, R2 (all free tier). Needed
      to deploy the API + site and to move the raw store from local disk to R2.
- [ ] **GitHub Actions secrets** — for the ingestion cron (02:00 IST) and Cloudflare
      deploy. No secrets needed yet (everything runs locally so far).
- [ ] **Domain** (~₹1,000/yr) — the only committed cost in v0 (Part 13.1).
- [ ] **data.gov.in API key** (free) — only if we later want official data.gov.in
      datasets (we used GeoNames for S10, so not needed right now).

---

## What's already done (for context)

- U1 spike run from CI (portal blocks our IP; needs the India-IP run above).
- Milestone 1–2: ingestion core + **S3 (NPPA ceilings)** end to end.
- Milestone 3: **`@salt/geo`** (geohash + haversine) + **S10 (pincode centroids)**
  live; **S2** pending your probe (item A).
- Milestone 4–5: normalisation engine — in progress (pure TS, unblocked).
