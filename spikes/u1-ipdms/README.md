# U1 spike — throwaway diagnostics (NOT part of the product)

Purpose: answer design **Part 15 U1 / §3.2** — is NPPA's Pharma Sahi Daam
(`nppaipdms.gov.in`) programmatically enumerable? See `FINDINGS.md` for what the
run from the cloud environment showed (short version: the portal refuses that
IP; needs a run from an Indian IP to answer the real questions).

This whole folder is disposable. Nothing here ships. Delete it once U1 is closed.

## Run it from an Indian IP (the run that matters)

You need Node 18+ and Chromium. On your own machine:

```bash
cd spikes/u1-ipdms

# 1. Quick reachability — does the host even answer an Indian IP?
bash reachability.sh

# 2. Network-tab capture — reveals any JSON/.aspx endpoint behind the form.
npm install                      # installs playwright-core
npx playwright install chromium  # one-time; downloads a Chromium
CHROME_PATH="$(node -e "console.log(require('playwright-core').chromium.executablePath())")" \
  node probe.mjs
```

`probe.mjs` loads the portal and prints, as JSON, every network request the page
made (method, type, status, content-type, and whether the response was JSON).
An undocumented API shows up here as a `.json`/`.aspx` XHR the HTML form fires.

## The four questions to close U1

1. Is there a JSON endpoint behind the HTML search form? (look in `network[]`)
2. Wildcard/alphabetical enumeration, or exact-name only? (try a partial query)
3. Captcha? Rate limiting, and at what request rate?
4. Paginated with stable cursors?

Once answered, record the verdict in `FINDINGS.md` and the decision in the repo
root `CLAUDE.md` (U1 row), then delete this folder.

## Notes

- `probe.mjs` uses `HTTPS_PROXY` only if it is set (CI). Run locally with it unset.
- `ignoreHTTPSErrors` is on because this is a reachability probe, not production.
