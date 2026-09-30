---
name: create-agentlet
description: Build a working agentlet (agentlet-core bookmarklet module) for a live web page, end to end. Observes the page in a real browser, scaffolds with agentlet-core's generator, writes the module, injects it into the page, verifies it with Playwright, and hands back a bookmarklet. Use when the user asks to create, generate, or design an agentlet for a URL or web app, or says things like "make an agentlet that exports this table" or "build a bookmarklet that fills this form".
---

# Create an agentlet

Follow `shared/recipe.md` (the what and why). This file is the how, with
the tools in this repository. Paths below are relative to the repository
root. Read `shared/api-cheatsheet.md` before writing module code.

Ask for the target URL and the goal if the user did not give them. If the
goal is vague, run step 1 first, then propose up to three concrete goals.

Keep the user informed with one short line per step. This skill is often
run live in front of an audience.

Run every command from the repository root. Scripts print their JSON
result on stdout and progress on stderr.

## 0. Preconditions

- Node.js 22.18 or later (runs the `.ts` scripts directly), and
  `node_modules/` exists in this repo, else run `npm install`.
- The target page is reachable: `curl -sI <url>`. For the bundled demo
  apps, serve them if needed (background):
  `python3 -m http.server 8000 --directory ../agentlet-demo-apps`
- Port 8080 is free (`lsof -iTCP:8080 -sTCP:LISTEN` prints nothing and
  exits 1, which is the good case), or
  pick another port and pass `--port` / `--base` consistently to every
  script below.

## 1. Observe

```bash
node skills/create-agentlet/scripts/observe.ts --url <url> --screenshot workspace/<name>-before.png
```

Single-page apps often hide the goal's table or form behind a tab or a
"New" button: fields show `visible: false` and the reveal button may be
missing from `buttons`. Repeat with `--click "<selector>"` (repeatable, in
order), usually a nav tab first, then the "New" or "Add" button. `--click`
takes any Playwright selector, including `button:has-text("Add Customer")`.
In the tables summary, `stacked` lists columns whose cells hold several
text blocks (a name and a job title, for example), and `sampleRow` shows
the first row as read with " / " between blocks. Prefer
selectors based on ids, names or visible text over `nth-of-type` chains
when you write the module. Look at the screenshot. If a Playwright MCP browser is
available, you may also open the page there so the audience can watch, but
base selectors on `observe.ts` output, which lists unique selectors.

Write the observation note from the recipe (3 to 8 lines) in the chat.

## 2. Design

State the design in the chat before coding: name (kebab case), pattern,
buttons and what each does, which core APIs it uses, and how each will be
verified. Keep it to one goal.

## 3. Scaffold

```bash
node skills/create-agentlet/scripts/prepare.ts <name>
```

Prints JSON with `moduleFile`, `moduleGlobal`, `serve`, `sync` and
`bookmarklet`. The first run on a machine builds a cache (about one
minute); later runs take about a second. Then start the server in the
background with the printed `serve` command and keep it running.

## 4. Implement

Rewrite `moduleFile` (`src/module.ts`) completely; the scaffold content is
a starter that shows the expected shape. Rules, all mandatory:

- TypeScript script: no `import` or `export` (use
  `import('agentlet-core').SomeType` for types), only `window.agentlet`.
- Keep the `interface Window { <global>: typeof <ClassName> }` block and the
  last line `window.<global> = <ClassName>;`: the registry looks up that global.
- `name` is exactly `<name>`; `patterns` targets the page URL.
- Events bound in `mount()` after `await super.mount(container, context)`.
- Styles via `this.injectStyles(css)` in `mount()`, guarded by
  `if (!this.styleElement)`. Never rely on `getStyles()`.
- Host page via `document`, with typed queries
  (`document.querySelector<HTMLFormElement>(...)`); panel via `container` or
  `window.agentlet.ui.query`.
- Every action: finds its targets, fails with `MessageBubble.error(...)` when
  missing, reports success with `MessageBubble.success(...)`.
- No `any`, no `@ts-ignore`: a type error is usually a wrong API call.
- No secrets. AI actions check `window.agentlet.ai.isAvailable()` first.

Then run the printed `sync` command. It type-checks the module against
agentlet-core's declarations (and `verify.mts` when present), then compiles
it into `dist/module-bundle.js` with esbuild. It prints `typeErrors` and
leaves `dist/` untouched when there are any: fix them before injecting.
A sync is instant, run it after every edit.

## 5. Verify

Write `workspace/<name>/verify.mts` (`.mts`: the generated project is
CommonJS, the scenario must be an ES module), a typed scenario that drives
the real page and checks the effect on the host page:

```ts
import type { Scenario } from '../../skills/create-agentlet/scripts/types.ts';

const scenario: Scenario = async (page, _report, { check, waitForBubble, readXlsx }) => {
  // The panel lives in a shadow root; Playwright locators pierce it.

  // Register the download listener before the click.
  const downloading = page.waitForEvent('download', { timeout: 10000 });
  await page.getByRole('button', { name: 'Export customers to Excel' }).click();
  const rows = await readXlsx(await downloading);
  check('excel has a header and data rows', rows.length > 1, `${rows.length} rows`);
  // A column known to hold stacked text (seen as `stacked` in observe.ts)
  // must come out joined, not glued. Do not scan every cell for a
  // lowercase-uppercase pair: names like "TechStart" are legitimate.
  const contact = rows[0].indexOf('Contact Person');
  check('stacked cells joined', rows.slice(1).every((r) => String(r[contact]).includes(' / ')), rows[1]);

  // Never read the page right after a click: actions are async (modals,
  // pagination). Wait for the module's own success message first.
  await page.getByRole('button', { name: 'Prefill a new customer' }).click();
  check('prefill reported', !!(await waitForBubble('success')));
  check('company filled', (await page.inputValue('input[name="company"]')).length > 0);
};

export default scenario;
```

Run `sync` again after writing it, so the scenario is type-checked too.

Check content, not just events: open the downloaded file with
`readXlsx`, compare counts with what the page shows ("Showing 1-10 of 30"),
look for glued text and for UI columns such as "Actions".

Run it:

```bash
node skills/create-agentlet/scripts/inject.ts --url <url> --module <name> \
  --scenario workspace/<name>/verify.mts --screenshot workspace/<name>/after.png
```

`"ok": true` means: module active, panel visible, no console errors, page
errors or failed requests, at least one check, all checks passing. Look at
`after.png` too. If anything fails, fix the module, `sync`, re-run. Stop
after five failed runs caused by the module (fixes to the scenario itself
do not count) and report the blocker.

To show the result live, re-run with `--headed --keep` (the browser stays
open; stop it afterwards). Stop the agentlet server with
`pkill -f "serve.ts workspace/<name>/dist"` when you are done, unless the
user wants to keep using the bookmarklet.

## 6. Deliver

Reply with:

- What the agentlet does, on which URL, and what was verified (the checks).
- The `after.png` screenshot path.
- How to use it: keep the `serve` command running (a server started in the
  background by this session stops when the session ends; say so), drag the `bookmarklet`
  link from `workspace/<name>/dist/index.html` (or the printed
  `bookmarklet` string) to the bookmarks bar, open the page, click it.
- Optional standalone build (type check, webpack for the core, esbuild for
  the module): `cd workspace/<name> && npm install && npm run build`.

## Known pitfalls (already handled, do not undo)

- The scaffold's relative registry and module URLs break injection into
  another origin. `prepare.ts` makes them absolute.
- agentlet-core loads scripts cross-origin, so the server must send CORS
  headers. Use `serve.ts`, not `python -m http.server`, for `dist/`.
- `prepare.ts` lets the registry register the module
  (`skipRegistryModuleRegistration = false`), so the cached core bundle
  works for every agentlet name.
- The scaffold's `src/module.js` is replaced by `src/module.ts`, and the
  project's webpack config only builds the core bundle. Do not add the
  module back as a webpack entry.
