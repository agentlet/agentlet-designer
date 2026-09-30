# agentlet-designer

Tooling that generates agentlets (modules for the agentlet-core framework)
from a live web page.

- Phase 1 (now): the Claude Code skill `create-agentlet`
  (`skills/create-agentlet/`, also exposed through `.claude/skills/`).
- Phase 2 (later): an in-page designer agentlet in `agentlet/`.
- `shared/` holds what both phases use: `recipe.md` (steps and success
  criteria) and `api-cheatsheet.md` (the agentlet-core API a module uses).

When asked to create, generate or design an agentlet, use the
`create-agentlet` skill.

## Layout

- `skills/create-agentlet/SKILL.md`: the procedure.
- `skills/create-agentlet/scripts/`: `observe.mjs` (page summary),
  `prepare.mjs` (scaffold via agentlet-core's plop generator, made
  injectable), `serve.mjs` (static server with CORS), `inject.mjs`
  (inject into a page, verify with a scenario, JSON report).
- `workspace/`: generated agentlets, git-ignored.
- `.cache/`: prebuilt core bundle per agentlet-core version, git-ignored.

## Relations

- `../agentlet-core` is the framework and its scaffold generator. Read it
  (especially `src/types/public-api.d.ts`) but never edit it from here.
  Override its location with `AGENTLET_CORE_DIR`.
- `../agentlet-demo-apps` holds neutral mock business apps used as targets
  for demos and tests. Serve them with
  `python3 -m http.server 8000 --directory ../agentlet-demo-apps`.

## Conventions

- Scripts are dependency-light Node ESM, only `playwright` is installed.
- Keep the scaffold workarounds in `prepare.mjs` documented with the reason;
  remove each one when agentlet-core fixes the underlying issue.
- English everywhere, sentence case, no em dashes, en dashes or middle dots.
- Conventional Commits, lowercase subject, no trailing period.
