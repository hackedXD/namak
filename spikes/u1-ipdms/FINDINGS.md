# U1 Spike — Is Pharma Sahi Daam (NPPA IPDMS 2.0) enumerable?

**Design refs:** Part 15 U1 (critical path), §3.2, §5.4
**Date run:** 2026-08-10
**Vantage point:** Claude Code cloud environment (datacenter egress IP, non-India), through the session's egress proxy.
**Status:** ⚠️ **Blocked — could not reach the portal from this environment. The four sub-questions remain unanswered and need a probe from an Indian IP.**

---

## Headline

I could **not** answer the enumerability questions, because **the Pharma Sahi Daam
portal `nppaipdms.gov.in` refuses connections from this environment entirely.**
The connection is reset *during the TLS handshake*, consistently, from both a
plain TLS client (curl/OpenSSL) and a real headless Chromium with a browser TLS
fingerprint and a browser User-Agent.

This is **not** our egress policy blocking it: the proxy's `CONNECT` tunnel to
`nppaipdms.gov.in:443` succeeds (`200 Connection Established`), and the reset
comes from the origin side after our Client Hello. Over plain HTTP (port 80) the
host answers with `503` after a long delay — so the host is *up* and serving
something (a WAF/load-balancer), it is specifically refusing our IP.

This is the exact failure mode the design already anticipated in **§5.4**:
> "the ingestion pipeline runs from GitHub's datacenter IP ranges, which some
> government portals block. If that occurs, move fetching to a free-tier VM
> (Oracle Cloud Always Free ARM)…"

The important nuance: **this block appears specific to `nppaipdms.gov.in` (S5), not to government sources in general.** See the reachability matrix below — the sources the MVP actually depends on first (S1, S3, S10) are all reachable from here.

---

## Evidence

### 1. `nppaipdms.gov.in` is reset at the TLS layer (consistent)

`curl` verbose (abridged):
```
> CONNECT nppaipdms.gov.in:443 HTTP/1.1
< HTTP/1.1 200 Connection Established          # proxy reached the origin
* TLSv1.3 (OUT), TLS handshake, Client hello (1):
* Recv failure: Connection reset by peer        # origin reset us mid-handshake
curl: (35) Recv failure: Connection reset by peer
```
- 3/3 retries → `HTTP 000`, reset each time (~12s to reset).
- `www.nppaipdms.gov.in`, `/ConsumerPortal/`, `index.aspx`, explicit `:443` → all reset identically.
- HTTP port 80 → `503` after ~16s (host is up, refusing at the app/WAF layer).

### 2. A real browser is reset too → IP block, not fingerprint block

Headless Chromium (real Chrome TLS fingerprint, Windows UA) through the same proxy:
```
net::ERR_CONNECTION_RESET   at https://nppaipdms.gov.in/
net::ERR_CONNECTION_RESET   at https://nppaipdms.gov.in/ConsumerPortal/
net::ERR_CONNECTION_RESET   at https://nppaipdms.gov.in/index.aspx
```
If this were a JA3/TLS-fingerprint filter (bot protection), the real browser
would have gotten through. It did not. That points at an **IP-range / geo block**.

### 3. Reachability matrix — most other gov sources DO work from here

| Source | Host | From this datacenter IP |
|---|---|---|
| **S5 Pharma Sahi Daam / IPDMS** | `nppaipdms.gov.in` | **RESET (blocked)** |
| S3 NPPA main | `nppa.gov.in` | OK (200; incomplete cert chain, fixable) |
| S1/S2 Jan Aushadhi | `janaushadhi.gov.in` | OK (200) |
| S1/S2 PMBI | `pmbi.in` | OK (200; incomplete chain) |
| S3/S4 eGazette | `egazette.gov.in` | OK (200; incomplete chain) |
| S3/S4 eGazette (nic mirror) | `egazette.nic.in` | RESET / no DNS |
| S8 CDSCO | `cdsco.gov.in` | OK (200) |
| S10 PIN centroids | `data.gov.in` | OK (200) |
| MoHFW | `mohfw.gov.in` | OK (200) |

`nppaipdms.gov.in` resolves to `220.156.188.33` (a Tata Comms range), hosted
separately from the NIC-hosted `164.100.x` government sites that are reachable.
So the block is host-specific, not a blanket India-geofence on our IP.

### 4. No alternate host for the price search

- `pharmasahidaam.nppa.gov.in` → does not resolve.
- `nppa.gov.in/pharma-sahi-daam/` and `/en/…` → `404`.

Pharma Sahi Daam price data appears to live **only** on the blocked `nppaipdms.gov.in`.

---

## What this means for the plan

1. **The four U1 questions (JSON endpoint? wildcard vs exact-name? captcha / rate
   limit? stable pagination cursors?) are still open.** They can only be answered
   from a vantage point the portal accepts — almost certainly an **Indian IP**.

2. **It does not block Milestones 1–3.** The design's build order (Part 12.2)
   starts ingestion with **S1 (PMBJP catalogue)** and **S3 (NPPA ceilings)** — both
   reachable from here — and geo with **S2/S10**. S5 is not on the Milestone 1–2
   critical path; it feeds brand-level pricing later. We can build the ingestion
   core end-to-end on S1/S3 while U1 is resolved out of band.

3. **When S5 does come in, its *fetcher* will need an India-resident egress**
   (Oracle Cloud Always Free has a Hyderabad/Mumbai region; a small always-on box;
   or the founder's own machine). This is already a supported shape in the design:
   the fetcher writes raw bytes to R2 and "nothing downstream cares where it ran"
   (§5.4). Parsing/validation/promotion still run in CI over R2.

---

## Recommended next step to actually close U1

Run the same probe **from an Indian residential/ISP connection** (the founder is
in India). Two ways, either works:

- **Fastest:** `bash reachability.sh` first (confirms the host even talks to an
  Indian IP), then `node probe.mjs` to capture the network tab — it dumps every
  request the page makes, which is exactly how we spot an undocumented JSON/`.aspx`
  endpoint behind the form (design §3.2 item 4).
- If the browser probe shows the portal loads, iterate the script to (a) submit
  the search form for a common molecule e.g. "paracetamol", (b) watch for an XHR
  returning JSON, (c) try an alphabetical/wildcard query, (d) note any captcha.

See `README.md` in this folder for exact run instructions. **This is throwaway
diagnostic code — it is not part of the product build.**
