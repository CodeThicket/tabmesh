/**
 * Tiny HTTP fixture used by the SW handoff e2e test. Records every POST
 * body and exposes them at GET /__received. Designed to run alongside the
 * Playwright harness on its own port.
 *
 * Usage: node e2e/fixtures/delivery-server.mjs [port]
 */

import http from 'node:http';

const PORT = Number(process.argv[2]) || 8096;

/** @type {Array<unknown>} */
const received = [];

const server = http.createServer((req, res) => {
  // Permit any origin so the SW running under localhost:5173 can POST here.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/__received') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(received));
    return;
  }
  if (req.method === 'GET' && req.url === '/__reset') {
    received.length = 0;
    res.end('ok');
    return;
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        received.push(JSON.parse(body));
      } catch {
        received.push({ raw: body });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[delivery-server] Listening on http://localhost:${PORT}`);
});
