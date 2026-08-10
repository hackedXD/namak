#!/usr/bin/env python3
"""THROWAWAY SPIKE — probe the PMBJP kendra directory API (source S2).

Run this FROM AN INDIAN IP (the API on janaushadhi.gov.in:8443 resets/blocks
datacenter & foreign egress — same class as the U1 finding). Zero dependencies
(stdlib only). It probes the kendra endpoints found in the site's JS bundle and
reports, for each: HTTP status, whether the body is JSON / an encrypted blob /
HTML, size, and a short sample.

What we need to learn (write answers into FINDINGS.md):
  1. Does getAllKendra / countKendra return the full ~16k kendra list, or is it
     paginated / capped? Are there stable cursors?
  2. Is the response plain JSON, or AES-encrypted? (the bundle carries
     REACT_APP_AES_SECRET_KEY / _IV — the app may decrypt responses client-side.)
  3. Is there a Cloudflare Turnstile / captcha gate? (bundle has
     REACT_APP_TURNSTILE_SITE_KEY.) At what request rate does throttling start?
  4. What fields come back per kendra (code, name, address, pincode, lat/lng,
     status)? lat/lng presence decides whether we still need geocoding via S10.

Usage:
    python3 probe.py                 # probes with GET and POST
    python3 probe.py --dump out.json # also save the largest JSON body seen
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.request
import urllib.error

BASE = "https://janaushadhi.gov.in:8443"
# Endpoints seen in /static/js/main.*.js (the React bundle).
ENDPOINTS = [
    "/api/v1/admin/addKendra/countKendra",
    "/api/v1/admin/addKendra/getAllKendra",
    "/api/v1/admin/addKendra/getNearByKendra",
    "/api/kendra/getAllStateOfIndia",
    "/api/kendra/getAllWarehouse",
]


def classify(body: bytes, ctype: str) -> str:
    head = body[:200].lstrip()
    if head[:1] in (b"{", b"["):
        return "json"
    if head[:9].lower() == b"<!doctype" or head[:5].lower() == b"<html":
        return "html (SPA shell?)"
    # base64-ish blob with no JSON/HTML markers → likely AES-encrypted payload
    sample = head.decode("latin-1", "replace")
    if sample and all(c.isalnum() or c in "+/=\r\n" for c in sample):
        return "opaque blob (encrypted? base64?)"
    return f"other ({ctype})"


def probe(url: str, method: str) -> dict:
    ctx = ssl.create_default_context()
    data = b"{}" if method == "POST" else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,*/*",
            "Content-Type": "application/json",
            "Origin": "https://janaushadhi.gov.in",
            "Referer": "https://janaushadhi.gov.in/",
        },
    )
    rec: dict = {"url": url, "method": method}
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            body = resp.read()
            rec.update(status=resp.status, bytes=len(body),
                       ctype=resp.headers.get("content-type", ""),
                       kind=classify(body, resp.headers.get("content-type", "")))
            rec["sample"] = body[:220].decode("latin-1", "replace").replace("\n", " ")
            rec["_body"] = body
    except urllib.error.HTTPError as e:
        body = e.read()
        rec.update(status=e.code, bytes=len(body), error="HTTPError",
                   kind=classify(body, e.headers.get("content-type", "")),
                   sample=body[:220].decode("latin-1", "replace").replace("\n", " "))
    except Exception as e:  # noqa: BLE001
        rec.update(status=None, error=f"{type(e).__name__}: {e}")
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump")
    args = ap.parse_args()

    biggest = None
    print(f"Probing {BASE} (run this from an Indian IP)\n" + "=" * 60)
    for path in ENDPOINTS:
        for method in ("GET", "POST"):
            r = probe(BASE + path, method)
            body = r.pop("_body", None)
            print(f"\n{method:4} {path}")
            print(f"  status={r.get('status')} kind={r.get('kind')} "
                  f"bytes={r.get('bytes')} {r.get('error','')}")
            if r.get("sample"):
                print(f"  sample: {r['sample'][:180]}")
            if body and r.get("kind") == "json" and (biggest is None or len(body) > len(biggest)):
                biggest = body

    if args.dump and biggest:
        with open(args.dump, "wb") as f:
            f.write(biggest)
        print(f"\nSaved largest JSON body ({len(biggest)} bytes) → {args.dump}")
        try:
            d = json.loads(biggest)
            n = len(d) if isinstance(d, list) else len(d.get("data", d.get("records", [])) or [])
            print(f"  parsed JSON; top-level record count ≈ {n}")
        except Exception:
            print("  (could not parse as JSON — may be encrypted)")
    print("\nDone. Record answers to the 4 questions in FINDINGS.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
