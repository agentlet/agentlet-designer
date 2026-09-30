#!/usr/bin/env node
// Type-checks an agentlet's src/module.ts against agentlet-core's
// declarations (and its verify.mts scenario, when present), then compiles
// the module with esbuild into dist/module-bundle.js, the IIFE the core
// loads from the registry. Prints a JSON result on stdout and exits 1 on
// type errors, without touching dist/.
//
// Usage: node sync.ts <kebab-name> [--no-check]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const tsc = path.join(repoRoot, 'node_modules', '.bin', 'tsc');

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('--'));
const skipCheck = argv.includes('--no-check');
if (!name) {
  console.error('Usage: sync.ts <kebab-name> [--no-check]');
  process.exit(2);
}
const dir = path.join(repoRoot, 'workspace', name);
if (!fs.existsSync(path.join(dir, 'src', 'module.ts'))) {
  console.error(`No src/module.ts in ${dir}. Run prepare.ts first.`);
  process.exit(2);
}

// Returns tsc diagnostics as lines, empty when the project type-checks.
function typecheck(project: string): string[] {
  try {
    execFileSync(tsc, ['-p', project, '--pretty', 'false'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    return [];
  } catch (error) {
    const out = (error as { stdout?: string }).stdout ?? String(error);
    return out.split('\n').filter((l) => l.trim());
  }
}

const result: { ok: boolean; typeErrors: string[]; bundle?: string; bytes?: number } = { ok: false, typeErrors: [] };

if (!skipCheck) {
  result.typeErrors.push(...typecheck('tsconfig.json'));
  if (fs.existsSync(path.join(dir, 'verify.mts'))) result.typeErrors.push(...typecheck('tsconfig.verify.json'));
}

if (result.typeErrors.length === 0) {
  const outfile = path.join(dir, 'dist', 'module-bundle.js');
  await build({
    entryPoints: [path.join(dir, 'src', 'module.ts')],
    outfile,
    bundle: true,
    format: 'iife',
    target: 'es2020',
    logLevel: 'silent',
  });
  result.ok = true;
  result.bundle = outfile;
  result.bytes = fs.statSync(outfile).size;
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
