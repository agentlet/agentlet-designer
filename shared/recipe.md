# Recipe: build an agentlet for a page

This recipe is tool-agnostic. The Claude Code skill
(`skills/create-agentlet/`) follows it today; the in-page designer agentlet
(`agentlet/`, later) will follow the same steps and success criteria.

## Inputs

- A target URL (the page the agentlet will enhance).
- A goal in one sentence, from the user ("export the customer table",
  "prefill the new lead form from a pasted email"). If none is given, propose
  up to three goals based on what the page offers and let the user pick one.

## Step 1: observe

Look at the live page, not at its source code.

- What the page is for (title, headings, main navigation).
- Forms: their container selector, each field's selector, type, label,
  required flag, and for selects the option values.
- Tables: selector, headers, row count, pagination controls.
- Anything that changes the DOM (tabs, modals, "new" buttons that reveal a
  form). Note the click needed to reach the goal's elements.

Prefer stable selectors: `#id`, then `[name=...]`, then a short class chain.
Never rely on text positions or `nth-child` unless nothing else exists.

Write down a short observation note: page purpose, the elements relevant to
the goal with their selectors, and how to reach them.

## Step 2: design (one screen, one job)

- One agentlet, one goal. Two or three buttons at most in the panel.
- Each button maps to one host-page action built on agentlet-core
  primitives (`forms.*`, `tables.*`, `ai.*`, `utils.*`).
- Every action gives feedback: `MessageBubble.success/error`, or a Dialog.
- Every action is safe to run twice and fails with a clear message when its
  target element is missing (the user may be on another tab of the app).
- No hardcoded secrets. AI features check `ai.isAvailable()` first.

## Step 3: scaffold

Use agentlet-core's own generator (minimal template), made injectable into
any origin. The skill wraps this in `scripts/prepare.ts`.

## Step 4: implement

Edit only the module file, a TypeScript script typed against
agentlet-core's declarations, with no `import` or `export`, that only uses
`window.agentlet`. Follow `api-cheatsheet.md`:

- `name` equals the kebab name used at scaffold time.
- `patterns` targets the page (substring of its URL), not `'*'`.
- Bind events in `mount()`, inject styles there once.
- Query the host page with `document`, the panel with `container` or
  `window.agentlet.ui.query`.
- Keep `window.<camelName>AgentletModule = <Class>;` at the end.

Type-check before every injection. A type error is almost always a wrong
API call, and it is far cheaper to catch than a failed browser run.

## Step 5: inject and verify

Load the agentlet into the real page the way its bookmarklet would, then
check, in this order:

1. The module is the active module and the panel is visible.
2. No console errors or failed requests caused by the agentlet.
3. Each button does what the goal says, checked on the host page itself
   (form values actually set, file actually downloaded, message shown).

Write the checks as a small scenario so they can be re-run. When a check
fails, read the error, fix the module, re-sync, re-run. Stop after five
failed iterations and report what blocks.

## Step 6: deliver

- A screenshot of the page with the panel open after the main action.
- The bookmarklet link to drag into the bookmarks bar, and the command that
  serves the agentlet.
- A three-line summary: what it does, on which URL, what was verified.
