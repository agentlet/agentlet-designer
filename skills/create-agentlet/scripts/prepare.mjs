#!/usr/bin/env node
// Scaffolds a new agentlet with agentlet-core's own generator (minimal
// template) and makes it injectable into any origin, fast.
//
// Usage: node prepare.mjs <kebab-name> [--port 8080] [--full-build]
//
// What it does, and why:
// 1. Runs `plop agentlet --minimal` from the agentlet-core checkout, so the
//    project layout always matches the framework's current scaffold.
// 2. Rewrites the registry URL in src/index.js and the module URL in
//    dist/agentlets-registry.js to absolute http://localhost:<port>/ URLs.
//    Both are relative in the scaffold and get resolved against the host
//    page, which breaks injection into any page other than the dev server.
// 3. Reuses a cached core-bundle.js (and PDF.js worker) instead of running
//    webpack: core-bundle.js only depends on the agentlet-core version and
//    the registry URL, so it is identical for every agentlet on the same
//    port. The first run builds the cache (about two minutes).
// 4. Copies src/module.js to dist/module-bundle.js. The module is a plain
//    IIFE that only uses window.agentlet, so no bundling is needed while
//    iterating. Pass --full-build to also run `npm install && npm run build`.
//
// Environment: AGENTLET_CORE_DIR (default: ../agentlet-core next to this repo).

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const workspace = path.join(repoRoot, 'workspace');
const coreDir = path.resolve(process.env.AGENTLET_CORE_DIR || path.join(repoRoot, '..', 'agentlet-core'));

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('--'));
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8080;
const fullBuild = argv.includes('--full-build');
const base = `http://localhost:${port}`;

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: prepare.mjs <kebab-name> [--port 8080] [--full-build]');
  process.exit(2);
}
if (!fs.existsSync(path.join(coreDir, 'plopfile.js'))) {
  console.error(`agentlet-core not found at ${coreDir}. Set AGENTLET_CORE_DIR.`);
  process.exit(2);
}

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
const log = (msg) => console.error(`[prepare] ${msg}`);

function ensureCoreDeps() {
  if (!fs.existsSync(path.join(coreDir, 'node_modules', '.bin', 'plop'))) {
    log('Installing agentlet-core dependencies (once)');
    run('npm install --no-audit --no-fund', coreDir);
  }
}

function scaffold(projectName) {
  const dir = path.join(workspace, projectName);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  fs.mkdirSync(workspace, { recursive: true });
  run(`npx plop agentlet --minimal --name=${projectName} --folder=${path.relative(coreDir, workspace)}`, coreDir);
  return dir;
}

function makeInjectable(dir) {
  const indexJs = path.join(dir, 'src', 'index.js');
  const src = fs.readFileSync(indexJs, 'utf8');
  const patched = src.replace(
    "agentletConfig.registryUrl = './agentlets-registry.js';",
    `agentletConfig.registryUrl = '${base}/agentlets-registry.js';`,
  );
  if (patched === src) throw new Error('registryUrl line not found in src/index.js, scaffold changed?');
  // Let the registry register the module itself. The scaffold skips that and
  // registers window.<camelName>AgentletModule from src/index.js instead,
  // which would tie the cached core-bundle.js to one agentlet name.
  const generic = patched.replace(
    'agentletConfig.skipRegistryModuleRegistration = true;',
    'agentletConfig.skipRegistryModuleRegistration = false;',
  );
  if (generic === patched) throw new Error('skipRegistryModuleRegistration line not found in src/index.js');
  fs.writeFileSync(indexJs, generic);

  const registry = path.join(dir, 'dist', 'agentlets-registry.js');
  const reg = fs.readFileSync(registry, 'utf8');
  const regPatched = reg.replace('"url": "./module-bundle.js"', `"url": "${base}/module-bundle.js"`);
  if (regPatched === reg) throw new Error('module url not found in dist/agentlets-registry.js, scaffold changed?');
  fs.writeFileSync(registry, regPatched);
}

function coreVersion() {
  return JSON.parse(fs.readFileSync(path.join(coreDir, 'package.json'), 'utf8')).version;
}

function ensureCoreCache() {
  const cacheDir = path.join(repoRoot, '.cache', `core-${coreVersion()}-port-${port}`);
  if (fs.existsSync(path.join(cacheDir, 'core-bundle.js'))) return cacheDir;

  log(`Building the core bundle cache in ${path.relative(repoRoot, cacheDir)} (once, about two minutes)`);
  const tmpName = `zz-cache-${Date.now()}`;
  const tmpDir = scaffold(tmpName);
  try {
    makeInjectable(tmpDir);
    run('npm install --no-audit --no-fund', tmpDir);
    run('npx webpack --mode production', tmpDir);
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const f of ['core-bundle.js', 'pdf.worker.min.mjs']) {
      const from = path.join(tmpDir, 'dist', f);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(cacheDir, f));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return cacheDir;
}

ensureCoreDeps();
const cacheDir = ensureCoreCache();

log(`Scaffolding ${name}`);
const dir = scaffold(name);
makeInjectable(dir);

for (const f of fs.readdirSync(cacheDir)) fs.copyFileSync(path.join(cacheDir, f), path.join(dir, 'dist', f));
fs.copyFileSync(path.join(dir, 'src', 'module.js'), path.join(dir, 'dist', 'module-bundle.js'));

if (fullBuild) {
  log('Running npm install and npm run build');
  run('npm install --no-audit --no-fund', dir);
  run('npm run build', dir);
}

const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
console.log(
  JSON.stringify(
    {
      dir,
      moduleFile: path.join(dir, 'src', 'module.js'),
      moduleName: name,
      moduleGlobal: `window.${camel}AgentletModule`,
      serve: `node ${path.relative(repoRoot, path.join(here, 'serve.mjs'))} ${path.relative(repoRoot, path.join(dir, 'dist'))} ${port}`,
      sync: `cp ${path.relative(repoRoot, path.join(dir, 'src', 'module.js'))} ${path.relative(repoRoot, path.join(dir, 'dist', 'module-bundle.js'))}`,
      bookmarklet: `javascript:(function(){var s=document.createElement('script');s.src='${base}/core-bundle.js';document.body.appendChild(s);})();`,
    },
    null,
    2,
  ),
);
