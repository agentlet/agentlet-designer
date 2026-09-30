#!/usr/bin/env node
// Summarises what a page offers to an agentlet: headings, forms with their
// fields, tables with pagination hints, and buttons that reveal more UI.
// Prints JSON on stdout and optionally saves a screenshot.
//
// Usage: node observe.ts --url <page> [--click "<selector>"]... [--screenshot out.png]
//
// --click can be repeated to reach UI behind tabs or "New" buttons before
// the snapshot is taken.

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const clicks = argv.flatMap((a, i) => (a === '--click' ? [argv[i + 1]] : []));
const url = opt('url');
if (!url) {
  console.error('Usage: observe.ts --url <page> [--click selector]... [--screenshot out.png]');
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
for (const sel of clicks) {
  await page.click(sel);
  await page.waitForTimeout(300);
}

// Runs in the page. Everything it needs must be defined inside it.
const summary = await page.evaluate(() => {
  type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  const text = (el: Element | null | undefined): string =>
    (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const visible = (el: Element): boolean => {
    const h = el as HTMLElement;
    return !!(h.offsetWidth || h.offsetHeight || el.getClientRects().length);
  };

  // Shortest selector that is unique in the document: #id, then
  // tag[name], then tag.classes, then a path climbing to the closest
  // ancestor with an id, using :nth-of-type where siblings collide.
  const unique = (sel: string): boolean => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const step = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute('name');
    if (name) return `${tag}[name="${name}"]`;
    const cls = [...el.classList]
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join('');
    const same = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
    return same.length > 1 ? `${tag}${cls}:nth-of-type(${same.indexOf(el) + 1})` : `${tag}${cls}`;
  };
  const selectorFor = (el: Element): string => {
    const first = step(el);
    if (unique(first)) return first;
    const parts = [first];
    for (let cur = el.parentElement; cur && cur !== document.documentElement; cur = cur.parentElement) {
      parts.unshift(step(cur));
      const sel = parts.join(' > ');
      if (unique(sel)) return sel;
      if (cur.id) break;
    }
    return parts.join(' > ');
  };
  const labelFor = (el: Element): string | null => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return text(l);
    }
    const group = el.closest('.form-group, .field, .form-field, .form-row');
    const sibling = group?.querySelector('label');
    return (
      text(el.closest('label')) || text(sibling) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || null
    );
  };
  const field = (el: FieldElement) => ({
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    type: el.type || null,
    label: labelFor(el),
    required: el.required || false,
    visible: visible(el),
    optionValues: el instanceof HTMLSelectElement ? [...el.options].slice(0, 15).map((o) => o.value) : undefined,
  });
  const fieldsIn = (root: ParentNode): FieldElement[] =>
    [...root.querySelectorAll<FieldElement>('input, select, textarea')].filter((el) => el.type !== 'hidden');

  const forms = [...document.querySelectorAll('form')].map((f) => ({
    selector: selectorFor(f),
    visible: visible(f),
    container: selectorFor(f.closest('[id]') ?? f),
    fields: fieldsIn(f).map(field),
  }));
  const looseFields = fieldsIn(document)
    .filter((el) => !el.closest('form'))
    .map(field);

  const tables = [...document.querySelectorAll('table')].map((t) => ({
    selector: selectorFor(t),
    visible: visible(t),
    headers: [...t.querySelectorAll('thead th, tr:first-child th')].map(text),
    rows: t.querySelectorAll('tbody tr').length,
    // First row, with " / " between the text blocks of a cell, and the
    // headers of columns whose cells stack several blocks (textContent
    // would glue them: "John Davis" + "CTO" gives "John DavisCTO").
    ...(() => {
      const headers = [...t.querySelectorAll('thead th, tr:first-child th')].map(text);
      const cells = [...(t.querySelector('tbody tr')?.children ?? [])];
      // Non-empty text nodes, so bare text next to an element counts too.
      const blocks = (cell: Element): string[] => {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (t) parts.push(t.slice(0, 60));
        }
        return parts.length ? parts : [''];
      };
      return {
        sampleRow: cells.map((c) => blocks(c).join(' / ')),
        stacked: cells.flatMap((c, i) => (blocks(c).length > 1 ? [headers[i] ?? `column ${i + 1}`] : [])),
      };
    })(),
    // Pagination hints near the table: "Showing 1-10 of 30", page buttons.
    pagination: (() => {
      const scope = t.closest('section, .tab-content, [id]')?.parentElement ?? document.body;
      const info = [...scope.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && /\b(of|sur)\s+\d+/i.test(el.textContent ?? ''))
        .map((el) => ({ selector: selectorFor(el), text: text(el) }))
        .slice(0, 3);
      const controls = [...scope.querySelectorAll('button, a')]
        .filter((b) => /next|prev|suivant|précédent|›|»|‹|«/i.test(`${b.id} ${b.className} ${b.textContent}`))
        .map((b) => ({ selector: selectorFor(b), text: text(b) }))
        .slice(0, 6);
      return info.length || controls.length ? { info, controls } : null;
    })(),
  }));

  const buttons = [...document.querySelectorAll<HTMLElement>('button, [role="tab"], a.btn, .tab-btn, .nav-tab')]
    .filter(visible)
    .slice(0, 40)
    .map((b) => ({ selector: selectorFor(b), text: text(b), dataset: { ...b.dataset } }));

  return {
    title: document.title,
    url: location.href,
    headings: [...document.querySelectorAll('h1, h2, h3')].filter(visible).map(text).slice(0, 20),
    forms,
    looseFields,
    tables,
    buttons,
  };
});

const shot = opt('screenshot');
if (shot) await page.screenshot({ path: shot });
console.log(JSON.stringify(summary, null, 2));
await browser.close();
