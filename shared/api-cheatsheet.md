# agentlet-core API cheatsheet

Condensed from agentlet-core's declarations, `agentlet-core.d.ts` (in
`node_modules/agentlet-core/dist/`, the source of truth, read it when in
doubt). Everything below is reached through the global `window.agentlet`
once the core bundle has initialised.

A generated module is a TypeScript script, `src/module.ts`: no `import` or
`export`. `sync.ts` type-checks it against those declarations, then compiles
it into an IIFE with esbuild. For a type, write
`import('agentlet-core').TypeName` inline.

## Module skeleton

```ts
// The registry looks up this exact global (camelCase name + "AgentletModule").
interface Window {
  crmHelperAgentletModule: typeof CrmHelperAgentlet;
}

type MountContext = import('agentlet-core').ModuleMountContext;

const STYLES = `.crm-helper button { padding: 8px 12px; margin: 4px 0; cursor: pointer; }`;

class CrmHelperAgentlet extends window.agentlet.Module {
  constructor() {
    super({
      name: 'crm-helper', // must equal the kebab name given to prepare.ts
      patterns: ['localhost:8000/crm/'], // see "Patterns" below
      description: 'Export customers and prefill new leads',
      version: '1.0.0',
    });
  }

  // Optional lifecycle hooks: initModule() once, activateModule(context)
  // each time the URL matches, cleanupModule() when leaving.

  // Default mount() writes getContent() into the panel. Override it to
  // bind events without leaking globals.
  async mount(container: HTMLElement, context: MountContext): Promise<void> {
    await super.mount(container, context);
    if (!this.styleElement) this.injectStyles(STYLES); // once, into the panel's shadow root
    container.querySelector('[data-action="export"]')?.addEventListener('click', () => this.exportCustomers());
  }

  getContent(): string {
    return `
      <div class="crm-helper">
        <p>Short explanation of what this agentlet does.</p>
        <button data-action="export">Export customers to Excel</button>
      </div>`;
  }

  private async exportCustomers(): Promise<void> {
    // see "Host page: tables"
  }
}

window.crmHelperAgentletModule = CrmHelperAgentlet;
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

```ts
const form = document.querySelector<HTMLFormElement>('form.customer-form');
if (!form) {
  window.agentlet.utils.MessageBubble.error('Open the "Add customer" form first');
  return;
}

// Structure, for code or for an AI prompt
const quick = window.agentlet.forms.quickExport(form);
// [{ selector, type, name, label, value, required }, ...]
const forAI = window.agentlet.forms.exportForAI(form);

// Fill: selector -> value (triggers input/change events by default)
const result = window.agentlet.forms.fill(form, {
  'input[name="company"]': 'Acme Corp',
  'select[name="industry"]': 'Technology', // <select>: option value
  '#is-active': true, // checkbox
});
// result: { total, successful, failed, skipped, details, errors }

// Fill from values keyed by field name or id (as listed in exportForAI)
window.agentlet.forms.fillFromAI(form, forAI, { company: 'Acme Corp' });
```

## Host page: tables

```ts
const table = document.querySelector<HTMLTableElement>('table.customers-table');
if (!table) return;
const data = window.agentlet.tables.extract(table);
// { headers: string[], rows: string[][], metadata }

await window.agentlet.tables.download(data, { filename: 'customers.xlsx', sheetName: 'Customers' });
// or in one go, with optional pagination:
await window.agentlet.tables.extractAndDownload(table, {
  filename: 'customers.xlsx',
  includePagination: true,
  nextButtonSelector: '#next-page',
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
a full `TableData` to `tables.download`. `metadata` is required:

```ts
const rows: string[][] = []; // filled by your own extraction
await window.agentlet.tables.download(
  {
    headers: ['Company', 'Contact'],
    rows,
    metadata: {
      totalRows: rows.length,
      totalColumns: 2,
      extractedAt: new Date().toISOString(),
      tableId: null,
    },
  },
  { filename: 'customers.xlsx' },
);
```

## Feedback to the user

```ts
const { MessageBubble, Dialog } = window.agentlet.utils;

MessageBubble.success('12 customers exported'); // renders .agentlet-bubble.agentlet-bubble-success
MessageBubble.error('No table found on this page');

Dialog.showInfo({ title: 'Done', message: 'Form filled.' });
Dialog.showInput({ title: 'Paste an email', inputType: 'textarea', rows: 8 }, (text) => {
  if (text) this.handle(text);
});
```

## AI (optional, needs OPENAI_API_KEY in the agentlet env vars)

```ts
if (!window.agentlet.ai.isAvailable()) {
  window.agentlet.utils.MessageBubble.warning('Set OPENAI_API_KEY in the agentlet settings first');
  return;
}
const answer = await window.agentlet.ai.sendPrompt(
  'Return JSON only: {"company": string, "email": string} from this text:\n' + text,
);
const parsed = JSON.parse(answer) as { company?: string; email?: string };
```

Also available: `ai.sendPromptWithPDF(prompt, pdfData)`,
`utils.ScreenCapture` (html2canvas), `utils.PageHighlighter`,
`utils.ElementSelector`, `env`, `storage`, `cookies`.

Environment variables: read them with `window.agentlet.env?.get('KEY')`.
`env` is typed as nullable, and property access such as `env.OPENAI_API_KEY`
works at runtime (a Proxy) but is not in the declarations, so it fails
type-checking.

Never hardcode an API key in a module. The key is entered by the user in
the panel's env vars dialog and read by the core.
