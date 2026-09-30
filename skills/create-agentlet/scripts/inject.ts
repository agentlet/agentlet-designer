#!/usr/bin/env node
// Opens a target page, injects a built agentlet exactly like its bookmarklet
// does (a <script> tag pointing at core-bundle.js), waits for the expected
// module to become active, optionally runs a verification scenario, and
// prints a JSON report on stdout.
//
// Usage:
//   node inject.ts --url <page> --module <module-name>
//                  [--base http://localhost:8080] [--scenario verify.mts]
//                  [--screenshot out.png] [--headed] [--keep] [--timeout 20000]
//
// A scenario file default-exports a `Scenario` (see types.ts):
// `async (page, report, helpers) => {}`. Throwing from it marks the run as
// failed. `report.ok` is true only when the module is active, the panel
// visible, there are no console errors, page errors or failed requests, and,
// when a scenario is given, it recorded at least one check and all passed.

import { chromium, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { InjectReport, Scenario, ScenarioHelpers } from './types.ts';

interface Args {
  url?: string;
  module?: string;
  base: string;
  scenario?: string;
  screenshot?: string;
  headed: boolean;
  keep: boolean;
  timeout: number;
}

function parseArgs(argv: string[]): Args {
  const raw: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'headed' || key === 'keep') raw[key] = true;
    else raw[key] = argv[++i];
  }
  const str = (k: string): string | undefined => {
    const v = raw[k];
    return typeof v === 'string' ? v : undefined;
  };
  return {
    url: str('url'),
    module: str('module'),
    base: str('base') ?? 'http://localhost:8080',
    scenario: str('scenario'),
    screenshot: str('screenshot'),
    headed: raw.headed === true,
    keep: raw.keep === true,
    timeout: Number(str('timeout') ?? 20000),
  };
}

// Minimal shape of the SheetJS global that agentlet-core exposes.
interface SheetJS {
  read(data: string, opts: { type: 'base64' }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, opts: { header: 1 }): unknown[][] };
}

function makeHelpers(page: Page, report: InjectReport): ScenarioHelpers {
  return {
    check(name, ok, detail) {
      report.checks.push({ name, ok: !!ok, detail });
    },
    async waitForBubble(type = 'success', text, timeout = 10000) {
      const bubble = page.locator(`.agentlet-bubble-${type}`, text ? { hasText: text } : {}).last();
      await bubble.waitFor({ state: 'visible', timeout });
      // Drop the close button glyph and the leading type icon.
      return (await bubble.innerText())
        .replace(/\s+/g, ' ')
        .replace(/^[×✕\s]+/, '')
        .replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '')
        .trim();
    },
    async readXlsx(download) {
      const file = await download.path();
      const base64 = (await fs.readFile(file)).toString('base64');
      return page.evaluate((b64) => {
        const XLSX = (window as unknown as { XLSX: SheetJS }).XLSX;
        const wb = XLSX.read(b64, { type: 'base64' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      }, base64);
    },
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.module) {
  console.error('Usage: inject.ts --url <page> --module <module-name> [options]');
  process.exit(2);
}
const moduleName = args.module;

const report: InjectReport = {
  url: args.url,
  module: moduleName,
  injected: false,
  activeModule: null,
  panelVisible: false,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  ok: false,
};

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
    moduleName,
    { timeout: args.timeout },
  );
  report.activeModule = moduleName;
  report.panelVisible = await page.locator('#agentlet-container').isVisible();

  if (args.scenario) {
    const scenarioUrl = pathToFileURL(path.resolve(args.scenario)).href;
    const { default: scenario } = (await import(scenarioUrl)) as { default: Scenario };
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
  report.error = error instanceof Error ? error.message : String(error);
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
