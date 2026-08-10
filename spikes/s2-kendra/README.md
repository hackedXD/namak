# S2 spike — PMBJP kendra directory (throwaway, NOT product code)

Goal: get the full ~16k Jan Aushadhi kendra list (code, name, address, pincode,
and lat/lng if present) into a real, reachable, checked-in form so we can build
the S2 ingestion source. The live API is on `janaushadhi.gov.in:8443`, which
**blocks datacenter/CI egress** (same class as U1) — so this must run from an
**Indian IP** (your machine, or an India VPN/host).

## Run it (from an Indian IP)

```bash
python3 probe.py                    # probes the kendra endpoints (GET + POST)
python3 probe.py --dump kendra.json # also saves the largest JSON body seen
```

Zero dependencies — stdlib only.

## What to find out (write answers in FINDINGS.md)

1. **Enumerable?** Does `getAllKendra` / `countKendra` return the whole list, or
   is it paginated / capped? Stable cursors?
2. **Encrypted?** Plain JSON, or an AES blob? The site bundle carries
   `REACT_APP_AES_SECRET_KEY` + `_IV`, so responses may be encrypted and decoded
   in the browser. If encrypted, note it — we'll decide whether to replicate the
   decrypt in the fetcher or find another channel.
3. **Captcha / rate limit?** The bundle has a Cloudflare Turnstile site key.
   Does the endpoint demand a token? At what request rate does it throttle?
4. **Fields per kendra?** Especially whether **lat/lng** are present (if yes, we
   may not need S10 geocoding for kendras at all).

## If the API is blocked/encrypted/captcha'd

Fallbacks, in order of preference:
- The **Google-Drive folder** the app references
  (`drive.google.com/drive/folders/1r4mtC_iLbtQD858sj_LwSMEDeb_Z32bN`) — check if
  it holds a kendra list (it may be product PDFs only).
- A published **kendra list PDF/XLSX** from janaushadhi.gov.in or a PIB release.
- Last resort: an **India-resident fetcher** box (design §5.4), which we agreed
  to consider only after the free channels are exhausted.

Whatever real data you retrieve, hand it back and I'll wire the S2 ingestion
source (fetch → R2 → parse → geohash7 → validate → promote → proximity query)
the same way S3/S10 were built. Delete this folder once S2 is sourced.
