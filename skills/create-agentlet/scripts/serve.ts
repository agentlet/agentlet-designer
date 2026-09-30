#!/usr/bin/env node
// Serves a built agentlet's dist/ folder with the CORS headers agentlet-core
// needs: it loads the registry and module bundles as cross-origin scripts,
// so a plain static server makes injection into another origin fail.
//
// Usage: node serve.ts <dist-dir> [port=8080]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 8080);

const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    const headers: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    };
    if (!fs.existsSync(file)) {
      res.writeHead(404, headers).end('Not found');
      return;
    }
    headers['Content-Type'] = types[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
