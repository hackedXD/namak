// THROWAWAY SPIKE — design Part 15 U1 / §3.2
// Drives a real Chromium (real TLS fingerprint) through the egress proxy at the
// Pharma Sahi Daam / IPDMS 2.0 portal and records the "network tab": every
// request, its type, status, and whether any response is JSON (an undocumented
// API behind the HTML form). Purpose is diagnosis only — nothing here ships.

import { chromium } from 'playwright-core';

// CHROME: override with CHROME_PATH env if running locally. Falls back to the
// pre-installed Chromium in this CI image.
const CHROME =
  process.env.CHROME_PATH ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// PROXY: only used when HTTPS_PROXY is set (CI). Locally (e.g. the founder's
// machine in India) leave it unset to connect directly.
const PROXY = process.env.HTTPS_PROXY || null;
const TARGETS = [
  'https://nppaipdms.gov.in/',
  'https://nppaipdms.gov.in/ConsumerPortal/',
  'https://nppaipdms.gov.in/index.aspx',
];

const results = [];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ...(PROXY ? { proxy: { server: PROXY } } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const context = await browser.newContext({
  ignoreHTTPSErrors: true, // proxy re-terminates TLS; this is a reachability probe
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});

for (const url of TARGETS) {
  const page = await context.newPage();
  const net = [];
  page.on('requestfinished', async (req) => {
    try {
      const resp = await req.response();
      const ct = resp ? (resp.headers()['content-type'] || '') : '';
      net.push({
        url: req.url(),
        method: req.method(),
        type: req.resourceType(),
        status: resp ? resp.status() : null,
        contentType: ct,
        isJson: /json/i.test(ct),
      });
    } catch {}
  });
  page.on('requestfailed', (req) =>
    net.push({
      url: req.url(),
      method: req.method(),
      type: req.resourceType(),
      failure: req.failure()?.errorText,
    }),
  );

  const rec = { target: url };
  try {
    const resp = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    rec.finalUrl = page.url();
    rec.status = resp ? resp.status() : null;
    rec.title = await page.title().catch(() => null);
    const bodyText = await page.evaluate(() =>
      document.body ? document.body.innerText.slice(0, 400) : '',
    ).catch(() => '');
    rec.bodySnippet = bodyText.replace(/\s+/g, ' ').trim();
    // signs of captcha / WAF
    rec.mentionsCaptcha = /captcha|recaptcha|hcaptcha/i.test(
      await page.content().catch(() => ''),
    );
  } catch (e) {
    rec.error = String(e).split('\n')[0];
  }
  rec.network = net;
  rec.jsonEndpoints = net.filter((n) => n.isJson).map((n) => n.url);
  results.push(rec);
  await page.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
