/**
 * Optional WebSocket echo server for testing TabMesh transport.
 *
 * Usage: node scripts/echo-server.mjs [port]
 * Default port: 8080
 *
 * This server echoes every message back to all connected clients,
 * simulating a backend that relays events between tabs.
 */

import { WebSocketServer } from 'ws';

const PORT = Number(process.argv[2]) || 8080;
const wss = new WebSocketServer({ port: PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[echo-server] Client connected (${clients.size} total)`);

  ws.on('message', (data) => {
    const msg = data.toString();
    console.log(`[echo-server] Received: ${msg.slice(0, 100)}`);

    // Echo to all connected clients
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(msg);
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[echo-server] Client disconnected (${clients.size} total)`);
  });
});

console.log(`[echo-server] Listening on ws://localhost:${PORT}`);
