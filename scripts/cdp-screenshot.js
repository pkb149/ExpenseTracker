#!/usr/bin/env node
// Connect to Chrome launched with --remote-debugging-port=9222 and take a screenshot.
// Usage: node scripts/cdp-screenshot.js [url] [output.png]
//
// Launch Chrome first (separate terminal):
//   TMPDIR=/tmp/chrome-cdp && rm -rf $TMPDIR && mkdir -p $TMPDIR/Default
//   cp ~/Library/Application\ Support/Google/Chrome/Default/Cookies $TMPDIR/Default/
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --user-data-dir=$TMPDIR \
//     https://expense-tracker-4er.pages.dev &
//   sleep 4

const { chromium } = require('/Users/prashantbharadwaj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const url = process.argv[2] || 'https://expense-tracker-4er.pages.dev';
const out = process.argv[3] || '/tmp/cdp-screenshot.png';

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();

  if (page.url() !== url) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  }
  await page.waitForTimeout(1500);

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: out, fullPage: true });
  console.log('URL:', page.url());
  console.log('Screenshot:', out);
  if (errors.length) {
    console.error('Console errors:', errors);
    process.exit(1);
  } else {
    console.log('No console errors.');
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
