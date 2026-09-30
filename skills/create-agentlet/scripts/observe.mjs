#!/usr/bin/env node
// Summarises what a page offers to an agentlet: headings, forms with their
// fields, tables, and buttons that reveal more UI. Prints JSON on stdout and
// optionally saves a screenshot.
//
// Usage: node observe.mjs --url <page> [--click "<selector>"]... [--screenshot out.png]
//
// --click can be repeated to reach UI behind tabs or "New" buttons before
// the snapshot is taken.

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const clicks = argv.flatMap((a, i) => (a === '--click' ? [argv[i + 1]] : []));
const url = opt('url');
if (!url) {
  console.error('Usage: observe.mjs --url <page> [--click selector]... [--screenshot out.png]');
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'load' });
for (const sel of clicks) {
  await page.click(sel);
  await page.waitForTimeout(300);
}

const summary = await page.evaluate(() => {
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  // Shortest selector that is unique in the document: #id, then
  // tag[name], then tag.classes, then a path climbing to the closest
  // ancestor with an id, using :nth-of-type where siblings collide.
  const unique = (sel) => {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  const step = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const tag = el.tagName.toLowerCase();
    if (el.getAttribute('name')) return `${tag}[name="${el.getAttribute('name')}"]`;
    const cls = [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
    const same = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
    return same.length > 1 ? `${tag}${cls}:nth-of-type(${same.indexOf(el) + 1})` : `${tag}${cls}`;
  };
  const selectorFor = (el) => {
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
  const labelFor = (el) => {
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
  const field = (el) => ({
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    type: el.type || null,
    label: labelFor(el),
    required: el.required || false,
    visible: visible(el),
    optionValues: el.tagName === 'SELECT' ? [...el.options].slice(0, 15).map((o) => o.value) : undefined,
  });

  const forms = [...document.querySelectorAll('form')].map((f) => ({
    selector: selectorFor(f),
    visible: visible(f),
    container: selectorFor(f.closest('[id]') || f),
    fields: [...f.querySelectorAll('input, select, textarea')]
      .filter((el) => el.type !== 'hidden')
      .map(field),
  }));
  const looseFields = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => !el.closest('form') && el.type !== 'hidden')
    .map(field);

  const tables = [...document.querySelectorAll('table')].map((t) => ({
    selector: selectorFor(t),
    visible: visible(t),
    headers: [...t.querySelectorAll('thead th, tr:first-child th')].map(text),
    rows: t.querySelectorAll('tbody tr').length,
    // Pagination hints near the table: "Showing 1-10 of 30", page buttons.
    pagination: (() => {
      const scope = t.closest('section, .tab-content, [id]')?.parentElement || document.body;
      const info = [...scope.querySelectorAll('*')]
        .filter((el) => el.children.length === 0 && /\b(of|sur)\s+\d+/i.test(el.textContent || ''))
        .map(text)
        .slice(0, 3);
      const controls = [...scope.querySelectorAll('button, a')]
        .filter((b) => /next|prev|suivant|précédent|›|»|‹|«/i.test(`${b.id} ${b.className} ${b.textContent}`))
        .map((b) => ({ selector: selectorFor(b), text: text(b) }))
        .slice(0, 6);
      return info.length || controls.length ? { info, controls } : null;
    })(),
  }));

  const buttons = [...document.querySelectorAll('button, [role="tab"], a.btn, .tab-btn, .nav-tab')]
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
