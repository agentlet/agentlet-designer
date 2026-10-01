import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSbom, extractNpxPackages, parseSpec, purl } from '../scripts/mcp-sbom.mjs';

const script = new URL('../scripts/mcp-sbom.mjs', import.meta.url).pathname;
const server = (args, command = 'npx') => ({ mcpServers: { s: { command, args } } });

test('parseSpec handles plain and scoped names', () => {
  assert.deepEqual(parseSpec('left-pad@1.3.0'), { name: 'left-pad', version: '1.3.0' });
  assert.deepEqual(parseSpec('@playwright/mcp@0.0.76'), { name: '@playwright/mcp', version: '0.0.76' });
  assert.deepEqual(parseSpec('@playwright/mcp'), { name: '@playwright/mcp', version: '' });
  assert.deepEqual(parseSpec('left-pad'), { name: 'left-pad', version: '' });
});

test('extracts the pinned package, skipping npx flags', () => {
  const pkgs = extractNpxPackages(server(['-y', '@playwright/mcp@0.0.76', '--headless']));
  assert.deepEqual(pkgs, [{ server: 's', name: '@playwright/mcp', version: '0.0.76' }]);
});

test('supports --package and ignores non-npx servers', () => {
  const config = {
    mcpServers: {
      a: { command: 'npx', args: ['--package=foo@1.0.0', 'foo-cli'] },
      b: { command: 'node', args: ['server.js'] },
      c: { url: 'https://example.com/mcp' },
    },
  };
  assert.deepEqual(extractNpxPackages(config), [{ server: 'a', name: 'foo', version: '1.0.0' }]);
});

test('rejects unpinned packages', () => {
  for (const spec of ['@playwright/mcp', '@playwright/mcp@latest', 'foo@^1.2.3', 'foo@1.2']) {
    assert.throws(() => extractNpxPackages(server([spec])), /exact version/, spec);
  }
});

test('rejects an npx server with no package', () => {
  assert.throws(() => extractNpxPackages(server(['-y'])), /no package/);
});

test('tolerates a config without servers', () => {
  assert.deepEqual(extractNpxPackages({}), []);
});

test('builds a CycloneDX 1.5 document with encoded purls, deduplicated', () => {
  assert.equal(purl('@playwright/mcp', '0.0.76'), 'pkg:npm/%40playwright/mcp@0.0.76');
  const sbom = buildSbom([
    { name: '@playwright/mcp', version: '0.0.76' },
    { name: '@playwright/mcp', version: '0.0.76' },
  ]);
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.specVersion, '1.5');
  assert.equal(sbom.components.length, 1);
  assert.equal(sbom.components[0].purl, 'pkg:npm/%40playwright/mcp@0.0.76');
});

test('CLI writes the SBOM and fails on an unpinned package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-sbom-'));
  const mcp = join(dir, 'mcp.json');
  const out = join(dir, 'nested', 'sbom.json');
  writeFileSync(mcp, JSON.stringify(server(['@playwright/mcp@0.0.76'])));
  execFileSync(process.execPath, [script, '--mcp', mcp, '--out', out]);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).components[0].name, '@playwright/mcp');

  writeFileSync(mcp, JSON.stringify(server(['@playwright/mcp@latest'])));
  const result = spawnSync(process.execPath, [script, '--mcp', mcp, '--out', out], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exact version/);
});
