# agentlet-core API cheatsheet

Condensed from `agentlet-core/src/types/public-api.d.ts` (the source of
truth, read it when in doubt). Everything below is reached through the
global `window.agentlet` once the core bundle has initialised. A generated
module must not `import` anything: it is a plain IIFE served as-is.

## Module skeleton

```js
(function () {
  'use strict';

  const STYLES = `.crm-helper button { padding: 8px 12px; margin: 4px 0; cursor: pointer; }`;

  class CrmHelperAgentlet extends window.agentlet.Module {
    constructor() {
      super({
        name: 'crm-helper',                 // must equal the kebab name given to prepare.mjs
        patterns: ['localhost:8000/crm/'],  // see "Patterns" below
        description: 'Export customers and prefill new leads',
        version: '1.0.0',
      });
    }

    async initModule() {}                   // once, when the module is first loaded
    async activateModule(context = {}) {}   // each time the URL matches (context.trigger)
    async cleanupModule() {}                // when leaving

    // Default mount() writes getContent() into the panel. Override it to
    // bind events without leaking globals.
    async mount(container, context) {
      await super.mount(container, context);
      if (!this.styleElement) this.injectStyles(STYLES); // once, into the panel's shadow root
      container.querySelector('[data-action="export"]')
        ?.addEventListener('click', () => this.exportCustomers());
    }

    getContent() {
      return `
        <div class="crm-helper">
          <p>Short explanation of what this agentlet does.</p>
          <button data-action="export">Export customers to Excel</button>
        </div>`;
    }
  }

  // Required: the registry looks up this exact global (camelCase name + "AgentletModule").
  window.crmHelperAgentletModule = CrmHelperAgentlet;
})();
```

Styles: call `this.injectStyles(css)` from `mount()`, guarded as above.
The scaffold's `getStyles()` method is never read by agentlet-core 2.1, so
CSS placed there is silently ignored.

## Patterns

`patterns` decides on which URLs the module activates.

- A string without `*` matches by substring: `'localhost:8000/crm/'`.
- `'*'` matches any URL. A string with `*` elsewhere is an unanchored glob.
- Objects: `{ type: 'includes' | 'exact' | 'regex', value }`.

## The panel lives in a shadow root

The agentlet panel is rendered inside a shadow root. From the module:

- Inside `mount()`, use the `container` argument (`container.querySelector`).
- Elsewhere, use `window.agentlet.ui.query(selector)` and `ui.queryAll(...)`.
- `document.querySelector` does not see the panel. It does see the host page,
  which is what you want for reading and filling the application.

## Host page: forms

```js
const form = document.querySelector('#customer-form');

// Structure, for code or for an AI prompt
const quick = window.agentlet.forms.quickExport(form);
// [{ selector, type, name, label, value, required }, ...]
const forAI = window.agentlet.forms.exportForAI(form);

// Fill: selector -> value (triggers input/change events by default)
const result = window.agentlet.forms.fill(form, {
  '#company-name': 'Acme Corp',
  '#industry': 'technology',   // <select>: option value
  '#is-active': true,          // checkbox
});
// result: { total, successful, failed, skipped, details, errors }

// Fill from values keyed by field name or id (as listed in exportForAI)
window.agentlet.forms.fillFromAI(form, forAI, { companyName: 'Acme Corp' });
```

## Host page: tables

```js
const table = document.querySelector('#customers-table');
const data = window.agentlet.tables.extract(table);
// { headers: string[], rows: string[][], metadata }

await window.agentlet.tables.download(data, { filename: 'customers.xlsx', sheetName: 'Customers' });
// or in one go, with optional pagination:
await window.agentlet.tables.extractAndDownload(table, {
  filename: 'customers.xlsx',
  includePagination: true,
  nextButtonSelector: '.pagination .next',
  maxPages: 10,
});
```

Known limits of the table helpers (agentlet-core 2.1), check the output:

- Cells are read with `textContent`, so stacked content glues together
  ("John Davis" + "CTO" becomes "John DavisCTO").
- `extractAll` starts from the page currently shown, not page 1.
- Every column is exported, including UI columns such as "Actions".
- The default pagination `delay` is 1000 ms per page.

When a table has any of these, extract the rows yourself (walk `tbody tr`,
join each cell's text nodes with " / ", skip UI columns, click back to
page 1 first and wait for the page to change after each "next"), then pass
`{ headers, rows }` to `tables.download`.

## Feedback to the user

```js
const { MessageBubble, Dialog } = window.agentlet.utils;

MessageBubble.success('12 customers exported');   // renders .agentlet-bubble.agentlet-bubble-success
MessageBubble.error('No table found on this page');

Dialog.showInfo({ title: 'Done', message: 'Form filled.' });
Dialog.showInput(
  { title: 'Paste an email', inputType: 'textarea', rows: 8 },
  (text) => { if (text) this.handle(text); },
);
```

## AI (optional, needs OPENAI_API_KEY in the agentlet env vars)

```js
if (!window.agentlet.ai.isAvailable()) {
  window.agentlet.utils.MessageBubble.warning('Set OPENAI_API_KEY in the agentlet settings first');
  return;
}
const answer = await window.agentlet.ai.sendPrompt(
  'Return JSON only: {"companyName": string, "email": string} from this text:\n' + text,
);
```

Also available: `ai.sendPromptWithPDF(prompt, pdfData)`,
`utils.ScreenCapture` (html2canvas), `utils.PageHighlighter`,
`utils.ElementSelector`, `env`, `storage`, `cookies`.

Never hardcode an API key in a module. The key is entered by the user in
the panel's env vars dialog and read by the core.
