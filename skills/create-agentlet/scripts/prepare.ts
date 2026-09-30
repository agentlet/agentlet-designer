#!/usr/bin/env node
// Scaffolds a new agentlet with agentlet-core's own generator (minimal
// template), turns its module into TypeScript, and makes it injectable into
// any origin, fast.
//
// Usage: node prepare.ts <kebab-name> [--port 8080] [--full-build]
//
// What it does, and why:
// 1. Runs `plop agentlet --minimal` from the agentlet-core checkout, so the
//    project layout always matches the framework's current scaffold.
// 2. Rewrites the registry URL in src/index.js and the module URL in
//    dist/agentlets-registry.js to absolute http://localhost:<port>/ URLs.
//    Both are relative in the scaffold and get resolved against the host
//    page, which breaks injection into any page other than the dev server.
// 3. Replaces src/module.js with a typed src/module.ts starter and a
//    tsconfig.json that loads agentlet-core's own declarations. webpack now
//    only builds the core bundle; the module is compiled by sync.ts
//    (type check, then esbuild), which the project's `npm run build` reuses.
// 4. Reuses a cached core-bundle.js (and PDF.js worker) instead of running
//    webpack: core-bundle.js only depends on the agentlet-core version and
//    the registry URL, so it is identical for every agentlet on the same
//    port. The first run builds the cache (about one minute).
//
// Pass --full-build to also run `npm install && npm run build` in the new
// project, so it builds on its own without this repository.
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
const name = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--port');
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8080;
const fullBuild = argv.includes('--full-build');
const base = `http://localhost:${port}`;

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('Usage: prepare.ts <kebab-name> [--port 8080] [--full-build]');
  process.exit(2);
}
if (!fs.existsSync(path.join(coreDir, 'plopfile.js'))) {
  console.error(`agentlet-core not found at ${coreDir}. Set AGENTLET_CORE_DIR.`);
  process.exit(2);
}

const run = (cmd: string, cwd: string): void => {
  execSync(cmd, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
};
const log = (msg: string): void => console.error(`[prepare] ${msg}`);
const camelCase = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascalCase = (s: string): string => camelCase(s).replace(/^./, (c) => c.toUpperCase());

function replaceOnce(file: string, from: string, to: string): void {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(from, to);
  if (out === src) throw new Error(`"${from}" not found in ${file}, did the agentlet-core scaffold change?`);
  fs.writeFileSync(file, out);
}

function ensureCoreDeps(): void {
  if (!fs.existsSync(path.join(coreDir, 'node_modules', '.bin', 'plop'))) {
    log('Installing agentlet-core dependencies (once)');
    run('npm install --no-audit --no-fund', coreDir);
  }
}

function scaffold(projectName: string): string {
  const dir = path.join(workspace, projectName);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  fs.mkdirSync(workspace, { recursive: true });
  run(`npx plop agentlet --minimal --name=${projectName} --folder=${path.relative(coreDir, workspace)}`, coreDir);
  return dir;
}

// Steps 2 and 3 of the header comment.
function adaptScaffold(dir: string, projectName: string): void {
  const indexJs = path.join(dir, 'src', 'index.js');
  replaceOnce(
    indexJs,
    "agentletConfig.registryUrl = './agentlets-registry.js';",
    `agentletConfig.registryUrl = '${base}/agentlets-registry.js';`,
  );
  // Let the registry register the module itself. The scaffold skips that and
  // registers window.<camelName>AgentletModule from src/index.js instead,
  // which would tie the cached core-bundle.js to one agentlet name.
  replaceOnce(
    indexJs,
    'agentletConfig.skipRegistryModuleRegistration = true;',
    'agentletConfig.skipRegistryModuleRegistration = false;',
  );
  replaceOnce(
    path.join(dir, 'dist', 'agentlets-registry.js'),
    '"url": "./module-bundle.js"',
    `"url": "${base}/module-bundle.js"`,
  );

  // TypeScript module: webpack keeps building the core bundle only.
  replaceOnce(path.join(dir, 'webpack.config.js'), "    module: './src/module.js',\n", '');
  fs.rmSync(path.join(dir, 'src', 'module.js'));
  fs.writeFileSync(path.join(dir, 'src', 'module.ts'), moduleStarter(projectName));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), `${JSON.stringify(moduleTsconfig(), null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'tsconfig.verify.json'), `${JSON.stringify(verifyTsconfig(dir), null, 2)}\n`);

  // The scaffold's Playwright specs target its own demo page and the
  // module.js it no longer has; verify.mts replaces them.
  fs.rmSync(path.join(dir, 'tests'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'playwright.config.js'), { force: true });

  const pkgFile = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  for (const key of Object.keys(pkg.scripts ?? {})) if (key.startsWith('test')) delete pkg.scripts[key];
  delete pkg.devDependencies?.['@playwright/test'];
  pkg.scripts = {
    ...pkg.scripts,
    typecheck: 'tsc -p tsconfig.json',
    'build:module':
      'esbuild src/module.ts --bundle --format=iife --target=es2020 --minify --outfile=dist/module-bundle.js',
    build: 'npm run typecheck && webpack --mode production && npm run build:module',
  };
  pkg.devDependencies = { ...pkg.devDependencies, esbuild: '^0.28.2', typescript: '^7.0.2' };
  fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
}

function moduleTsconfig() {
  return {
    compilerOptions: {
      target: 'es2020',
      lib: ['es2022', 'dom', 'dom.iterable'],
      module: 'preserve',
      moduleDetection: 'legacy',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      // Loads agentlet-core's declarations, which type window.agentlet.
      types: ['agentlet-core'],
    },
    include: ['src/module.ts'],
  };
}

function verifyTsconfig(dir: string) {
  return {
    extends: path.relative(dir, path.join(repoRoot, 'tsconfig.json')),
    include: ['verify.mts'],
  };
}

function moduleStarter(projectName: string): string {
  const cls = `${pascalCase(projectName)}Agentlet`;
  const global = `${camelCase(projectName)}AgentletModule`;
  return `// ${projectName} agentlet module.
//
// A plain script typed against agentlet-core's declarations: no import or
// export. sync.ts type-checks it, then compiles it with esbuild into an
// IIFE, dist/module-bundle.js, which the core loads from the registry.

// The registry looks up this exact global.
interface Window {
  ${global}: typeof ${cls};
}

const STYLES = \`
  .${projectName} button { padding: 8px 12px; margin: 4px 0; cursor: pointer; }
\`;

class ${cls} extends window.agentlet.Module {
  constructor() {
    super({
      name: '${projectName}',
      patterns: ['localhost'],
      description: 'Describe what this agentlet does',
      version: '1.0.0',
    });
  }

  async mount(container: HTMLElement, context: import('agentlet-core').ModuleMountContext): Promise<void> {
    await super.mount(container, context);
    if (!this.styleElement) this.injectStyles(STYLES);
    container.querySelector('[data-action="hello"]')?.addEventListener('click', () => this.hello());
  }

  getContent(): string {
    return \`
      <div class="${projectName}">
        <p>Replace this placeholder.</p>
        <button data-action="hello">Say hello</button>
      </div>\`;
  }

  private hello(): void {
    window.agentlet.utils.MessageBubble.success('Hello from ${projectName}');
  }
}

window.${global} = ${cls};
`;
}

function coreVersion(): string {
  return JSON.parse(fs.readFileSync(path.join(coreDir, 'package.json'), 'utf8')).version;
}

function ensureCoreCache(): string {
  const cacheDir = path.join(repoRoot, '.cache', `core-${coreVersion()}-port-${port}`);
  if (fs.existsSync(path.join(cacheDir, 'core-bundle.js'))) return cacheDir;

  log(`Building the core bundle cache in ${path.relative(repoRoot, cacheDir)} (once, about one minute)`);
  const tmpName = `zz-cache-${Date.now()}`;
  const tmpDir = scaffold(tmpName);
  try {
    adaptScaffold(tmpDir, tmpName);
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
adaptScaffold(dir, name);
for (const f of fs.readdirSync(cacheDir)) fs.copyFileSync(path.join(cacheDir, f), path.join(dir, 'dist', f));

const rel = (p: string): string => path.relative(repoRoot, p);
const sync = `node ${rel(path.join(here, 'sync.ts'))} ${name}`;
run(sync, repoRoot);

if (fullBuild) {
  log('Running npm install and npm run build');
  run('npm install --no-audit --no-fund', dir);
  run('npm run build', dir);
}

console.log(
  JSON.stringify(
    {
      dir,
      moduleFile: path.join(dir, 'src', 'module.ts'),
      moduleName: name,
      moduleGlobal: `window.${camelCase(name)}AgentletModule`,
      serve: `node ${rel(path.join(here, 'serve.ts'))} ${rel(path.join(dir, 'dist'))} ${port}`,
      sync,
      bookmarklet: `javascript:(function(){var s=document.createElement('script');s.src='${base}/core-bundle.js';document.body.appendChild(s);})();`,
    },
    null,
    2,
  ),
);
