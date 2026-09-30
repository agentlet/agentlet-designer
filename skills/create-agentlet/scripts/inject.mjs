#!/usr/bin/env node
// Opens a target page, injects a built agentlet exactly like its bookmarklet
// does (a <script> tag pointing at core-bundle.js), waits for the expected
// module to become active, optionally runs a verification scenario, and
// prints a JSON report on stdout.
//
// Usage:
//   node inject.mjs --url <page> --module <module-name>
//                   [--base http://localhost:8080] [--scenario verify.mjs]
//                   [--screenshot out.png] [--headed] [--keep] [--timeout 20000]
//
// A scenario file default-exports `async (page, report, helpers) => {}`.
// Throwing from it marks the run as failed; `report.checks.push({ name, ok,
// detail })` records individual results. `helpers` provides:
//   check(name, ok, detail)          shorthand for report.checks.push
//   waitForBubble(type, text?)       waits for a MessageBubble ('success',
//                                    'error', 'info', 'warning') and returns
//                                    its text; use it instead of reading the
//                                    page right after a click
//   readXlsx(download)               rows (array of arrays, first sheet) of a
//                                    Playwright download, parsed with the
//                                    SheetJS copy agentlet-core loads
//
// `report.ok` is true only when the module is active, the panel visible,
// there are no console errors, page errors or failed requests, and, when a
// scenario is given, it recorded at least one check and all checks passed.

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = { base: 'http://localhost:8080', timeout: 20000 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (['headed', 'keep'].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[++i];
    }
  }
  args.timeout = Number(args.timeout);
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.module) {
  console.error('Usage: inject.mjs --url <page> --module <module-name> [options]');
  process.exit(2);
}

const report = {
  url: args.url,
  module: args.module,
  injected: false,
  activeModule: null,
  panelVisible: false,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  ok: false,
};

function makeHelpers(page, report) {
  return {
    check(name, ok, detail) {
      report.checks.push({ name, ok: !!ok, detail });
    },
    async waitForBubble(type = 'success', text, timeout = 10000) {
      const bubble = page.locator(`.agentlet-bubble-${type}`, text ? { hasText: text } : {}).last();
      await bubble.waitFor({ state: 'visible', timeout });
      return (await bubble.innerText()).replace(/\s+/g, ' ').trim();
    },
    async readXlsx(download) {
      const file = await download.path();
      const base64 = (await fs.readFile(file)).toString('base64');
      return page.evaluate((b64) => {
        const wb = window.XLSX.read(b64, { type: 'base64' });
        return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      }, base64);
    },
  };
}

const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') report.consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => report.pageErrors.push(String(err)));
page.on('requestfailed', (req) => report.failedRequests.push(`${req.url()} ${req.failure()?.errorText}`));
page.on('response', (res) => {
  if (res.status() >= 400) report.failedRequests.push(`${res.url()} HTTP ${res.status()}`);
});

try {
  await page.goto(args.url, { waitUntil: 'load' });

  await page.addScriptTag({ url: `${args.base}/core-bundle.js` });
  report.injected = true;

  await page.waitForFunction(
    (name) => window.agentlet?.moduleRegistry?.activeModule?.name === name,
    args.module,
    { timeout: args.timeout },
  );
  report.activeModule = args.module;
  report.panelVisible = await page.locator('#agentlet-container').isVisible();

  if (args.scenario) {
    const scenarioUrl = pathToFileURL(path.resolve(args.scenario)).href;
    const { default: scenario } = await import(scenarioUrl);
    await scenario(page, report, makeHelpers(page, report));
  }

  report.ok =
    report.panelVisible &&
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.failedRequests.length === 0 &&
    (!args.scenario || report.checks.length > 0) &&
    report.checks.every((c) => c.ok);
} catch (error) {
  report.error = String(error?.message || error);
  report.registeredModules = await page
    .evaluate(() => window.agentlet?.moduleRegistry?.getAll?.() ?? null)
    .catch(() => null);
} finally {
  if (args.screenshot) {
    await page.screenshot({ path: args.screenshot, fullPage: false }).catch(() => {});
    report.screenshot = path.resolve(args.screenshot);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!args.keep) await browser.close();
}

if (!args.keep) process.exit(report.ok ? 0 : 1);
