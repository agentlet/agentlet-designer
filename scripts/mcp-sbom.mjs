#!/usr/bin/env node
// Writes a CycloneDX 1.5 SBOM of the npm packages that the MCP servers in
// .mcp.json run through npx. Those packages are outside package-lock.json,
// so the dependency scan reads this file as an extra blocking SBOM.
// Zero dependencies, Node >= 20.
//
//   node scripts/mcp-sbom.mjs [--mcp <file>] [--out <path>]
//
// Defaults: --mcp .mcp.json, --out reports/security/sbom-mcp.cdx.json.
// Exits with 1 when an npx package is not pinned to an exact version.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Split an npm package spec into name and version ('' when there is none). */
export function parseSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec, version: '' };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/**
 * Collect every package run by an `npx` MCP server, as { server, name, version }.
 * Throws when a package is not pinned to an exact version.
 * Servers that do not run through npx are ignored.
 */
export function extractNpxPackages(config) {
  const servers = config && typeof config === 'object' ? config.mcpServers ?? {} : {};
  const found = [];
  for (const [server, def] of Object.entries(servers)) {
    const command = String(def?.command ?? '').split(/[\\/]/).pop();
    if (command !== 'npx' && command !== 'npx.cmd') continue;
    const args = Array.isArray(def.args) ? def.args.map(String) : [];
    const specs = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') break;
      if (arg === '-p' || arg === '--package') {
        if (args[i + 1] !== undefined) specs.push(args[++i]);
      } else if (arg.startsWith('--package=')) {
        specs.push(arg.slice('--package='.length));
      } else if (!arg.startsWith('-')) {
        // The first positional argument is the package when no --package is given.
        if (specs.length === 0) specs.push(arg);
        break;
      }
    }
    if (specs.length === 0) {
      throw new Error(`MCP server "${server}": no package found in the npx arguments`);
    }
    for (const spec of specs) {
      const { name, version } = parseSpec(spec);
      if (!name || !EXACT_VERSION.test(version)) {
        throw new Error(
          `MCP server "${server}": "${spec}" is not pinned to an exact version (use name@1.2.3)`,
        );
      }
      found.push({ server, name, version });
    }
  }
  return found;
}

/** Package URL for an npm package; the scope separator is percent-encoded. */
export function purl(name, version) {
  return `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
}

/** Build a CycloneDX 1.5 document from the packages (deduplicated by purl). */
export function buildSbom(packages) {
  const byPurl = new Map();
  for (const { name, version } of packages) byPurl.set(purl(name, version), { name, version });
  const components = [...byPurl.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, { name, version }]) => ({
      type: 'library',
      'bom-ref': p,
      name,
      version,
      purl: p,
    }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: { type: 'application', name: 'agentlet-designer-mcp-servers' },
    },
    components,
  };
}

function main(argv) {
  const opts = { mcp: '.mcp.json', out: 'reports/security/sbom-mcp.cdx.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mcp') opts.mcp = argv[++i];
    else if (argv[i] === '--out') opts.out = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  const config = JSON.parse(readFileSync(opts.mcp, 'utf8'));
  const packages = extractNpxPackages(config);
  mkdirSync(dirname(resolve(opts.out)), { recursive: true });
  writeFileSync(opts.out, `${JSON.stringify(buildSbom(packages), null, 2)}\n`);
  console.log(`Wrote ${opts.out} (${packages.length} npx package${packages.length === 1 ? '' : 's'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`mcp-sbom: ${error.message}`);
    process.exit(1);
  }
}
