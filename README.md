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

- Node.js 20 or later, Python 3 (to serve the demo apps).
- [Claude Code](https://claude.com/claude-code).
- A checkout of [agentlet-core](https://github.com/agentlet/agentlet-core)
  next to this repository (or `AGENTLET_CORE_DIR` pointing at one).
- For the demo: [agentlet-demo-apps](https://github.com/agentlet/agentlet-demo-apps)
  next to this repository.

```bash
npm install
npx playwright install chromium
```

## Run the demo

```bash
python3 -m http.server 8000 --directory ../agentlet-demo-apps
```

Then, in another terminal, from this folder:

```bash
claude "Create an agentlet for http://localhost:8000/crm/index.html that exports the customer table to Excel and prefills the new customer form"
```

The first run builds a cache of the core bundle (about one minute). Later
agentlets scaffold in about a second.

## Use the scripts directly

```bash
node skills/create-agentlet/scripts/observe.mjs --url http://localhost:8000/crm/index.html
node skills/create-agentlet/scripts/prepare.mjs crm-helper
node skills/create-agentlet/scripts/serve.mjs workspace/crm-helper/dist 8080
node skills/create-agentlet/scripts/inject.mjs --url http://localhost:8000/crm/index.html --module crm-helper --headed --keep
```

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
