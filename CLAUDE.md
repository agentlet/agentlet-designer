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
- `skills/create-agentlet/scripts/`: `observe.ts` (page summary),
  `prepare.ts` (scaffold via agentlet-core's plop generator, made
  injectable, module turned into `src/module.ts`), `sync.ts` (type-check,
  then esbuild into `dist/module-bundle.js`), `serve.ts` (static server
  with CORS), `inject.ts` (inject into a page, verify with a scenario,
  JSON report), `types.ts` (report and scenario types).
- `workspace/`: generated agentlets, git-ignored.
- `.cache/`: prebuilt core bundle per agentlet-core version, git-ignored.

## Relations

- `../agentlet-core` is the framework and its scaffold generator. Read it
  (its declarations are also installed as the `agentlet-core` dev dependency) but never edit it from here.
  Override its location with `AGENTLET_CORE_DIR`.
- `../agentlet-demo-apps` holds neutral mock business apps used as targets
  for demos and tests. Serve them with
  `python3 -m http.server 8000 --directory ../agentlet-demo-apps`.

## Conventions

- TypeScript everywhere. Scripts run directly with Node's type stripping
  (Node 22.18 or later, no build step), so use erasable syntax only: no
  `enum`, no `namespace`, no constructor parameter properties
  (`erasableSyntaxOnly` enforces it). Import local files with their `.ts`
  extension.
- `npm run typecheck` must pass before committing.
- Generated modules are TypeScript scripts typed by agentlet-core's own
  declarations (the `agentlet-core` dev dependency); verification scenarios
  are `verify.mts` files typed by `scripts/types.ts`.
- Keep the scaffold workarounds in `prepare.ts` documented with the reason;
  remove each one when agentlet-core fixes the underlying issue.
- English everywhere, sentence case, no em dashes, en dashes or middle dots.
- Conventional Commits, lowercase subject, no trailing period.
