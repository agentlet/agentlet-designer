# agentlet-designer

Generate an [agentlet](https://agentlet.io) for a web page, from the page
itself.

Point Claude Code at a URL and a goal ("export the customer table to
Excel", "prefill the new lead form"). The `create-agentlet` skill observes
the live page in a browser, scaffolds a project with agentlet-core's own
generator, writes the module, injects it into the page, checks the result
with Playwright, and hands back a bookmarklet.

An in-page designer agentlet, which does the same from inside the target
application, is planned in `agentlet/`. Both follow the same recipe in
`shared/`.

## Requirements

- Node.js 22.18 or later (the scripts are TypeScript, run directly by
  Node), and Python 3 to serve the demo apps.
- [Claude Code](https://claude.com/claude-code).
- A checkout of [agentlet-core](https://github.com/agentlet/agentlet-core)
  next to this repository (or `AGENTLET_CORE_DIR` pointing at one).
- For the demo: [agentlet-demo-apps](https://github.com/agentlet/agentlet-demo-apps)
  next to this repository.

## Install

Clone the three repositories side by side, then install this one. The
scripts look for `../agentlet-core`, and the demo command below serves
`../agentlet-demo-apps`.

```bash
mkdir agentlet && cd agentlet
git clone https://github.com/agentlet/agentlet-designer.git
git clone https://github.com/agentlet/agentlet-core.git
git clone https://github.com/agentlet/agentlet-demo-apps.git
cd agentlet-designer
npm install
npx playwright install chromium
```

You do not need to install anything inside `agentlet-core`: the first run
of `prepare.ts` runs `npm install` there once.

## Run the demo

In a first terminal, from the `agentlet-designer` folder, serve the demo
apps:

```bash
python3 -m http.server 8000 --directory ../agentlet-demo-apps
```

In a second terminal, from the same folder, start Claude Code with a
request:

```bash
claude "Create an agentlet for http://localhost:8000/crm/index.html that exports the customer table to Excel and prefills the new customer form"
```

Claude Code asks you to approve the commands and the Playwright MCP server
declared in `.mcp.json`. The first run installs agentlet-core's
dependencies and builds a cache of the core bundle, which took about three
minutes when this was last checked. Later agentlets scaffold in a few
seconds.

Generated modules are written in TypeScript and type-checked against
agentlet-core's own declarations before each injection, so a wrong API
call is caught in half a second instead of a failed browser run.

## Use the scripts directly

```bash
node skills/create-agentlet/scripts/observe.ts --url http://localhost:8000/crm/index.html
node skills/create-agentlet/scripts/prepare.ts crm-helper
# edit workspace/crm-helper/src/module.ts, then type-check and compile it:
node skills/create-agentlet/scripts/sync.ts crm-helper
node skills/create-agentlet/scripts/serve.ts workspace/crm-helper/dist 8080
node skills/create-agentlet/scripts/inject.ts --url http://localhost:8000/crm/index.html --module crm-helper --headed --keep
```

## Development

```bash
npm run typecheck
node --test
```

### Dependency pins

- `playwright` is pinned to exactly `1.61.1`. Versions below 1.55.1 have
  GHSA-7mvr-c777-76hp (browser downloads without TLS certificate
  verification). The upper bound is 1.61.x: Playwright 1.62 and later ship
  no chromium build for macOS 13 (checked with
  `npx playwright@<version> install --dry-run chromium`), while 1.61.x
  installs and launches there. Do not go above 1.61.x while macOS 13
  machines run the scripts.
- `.mcp.json` runs `@playwright/mcp` at an exact version (`0.0.76`, which
  depends on Playwright 1.61.0-alpha) instead of `@latest`, so the code
  executed on a developer machine only changes through a commit. Keep it
  coupled to the `playwright` pin: bump both together, and choose an MCP
  version whose `playwright` dependency stays within 1.55.1 to 1.61.x. List
  candidates with `npm view @playwright/mcp@<version> dependencies`,
  edit the version in `.mcp.json`, restart Claude Code and check that the
  `playwright` MCP server starts.
- `agentlet-core` follows its latest minor (`^2.2.0`); `npm audit` should
  report no vulnerabilities after any bump.

## Dependency scan

The `Security` workflow scans dependencies for known vulnerabilities on
every pull request, on pushes to main and nightly, using the shared
[dependency-scan action](https://github.com/agentlet/.github/tree/main/actions/dependency-scan).
Everything here runs on a developer machine, so the whole
`package-lock.json` is a blocking scope. The MCP server in `.mcp.json` runs
through npx and is outside the lockfile: `scripts/mcp-sbom.mjs` writes a
CycloneDX SBOM of it (`reports/security/sbom-mcp.cdx.json`, git-ignored)
and fails when an npx package is not pinned to an exact version.

A finding blocks when it is critical or high with a known fix, or when it
is in the CISA Known Exploited Vulnerabilities catalog. A failing nightly
run opens or updates one issue labelled `security`.

Exceptions live in `security/vulnerability-exceptions.json` (empty by
default). An exception is a deliberate, time-boxed decision to accept a
known risk, for example when no fix exists and the affected code cannot be
reached. Each entry needs an `id` (GHSA or CVE), a `reason`, an `owner` and
an `expires` date (`YYYY-MM-DD`), and an expired entry fails the gate until
it is renewed or removed. Exception changes are reviewed in a pull request
like code.

To run the scan locally, see the action's README.

## Layout

```
shared/                   recipe and API cheatsheet, used by both phases
skills/create-agentlet/   Claude Code skill and its scripts
.claude/skills/           exposes the skill to Claude Code in this folder
agentlet/                 in-page designer agentlet (phase 2)
workspace/                generated agentlets (git-ignored)
```

## License

MIT
