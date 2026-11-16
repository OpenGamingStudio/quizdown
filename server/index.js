// Serveur HTTP + WebSocket QuizDown : 127.0.0.1:${PORT||8080}, /ws et /healthz uniquement.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { Manager } from './rooms.js';
import { loadBank } from './bank.js';

/** IP cliente : dernière entrée de X-Forwarded-For (posée par Traefik), sinon l'adresse du socket. */
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const last = xff.split(',').pop().trim();
    if (last && last.length <= 64) return last;
  }
  return req.socket.remoteAddress || 'unknown';
}

export function start({ port = Number(process.env.PORT) || 8080, host = '127.0.0.1', bank = loadBank(), manager } = {}) {
  const mgr = manager || new Manager({ bank });
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('ok');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

  wss.on('connection', (ws, req) => {
    const send = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
    const sess = mgr.connect(clientIp(req), send);
    if (!sess) {
      send({ t: 'error', code: 'rate', msg: 'rate' });
      ws.close(1013);
      return;
    }
    sess.kick = () => ws.close(4000);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      ws.isAlive = true;
      if (isBinary) return send({ t: 'error', code: 'bad', msg: 'bad' });
      mgr.message(sess, data.toString());
    });
    ws.on('close', () => mgr.disconnect(sess));
    ws.on('error', () => ws.terminate());
  });

  const sweepTimer = setInterval(() => mgr.sweep(), 30000);
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  sweepTimer.unref();
  beat.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server, wss, manager: mgr, port: server.address().port,
        close() {
          clearInterval(sweepTimer);
          clearInterval(beat);
          mgr.shutdown();
          for (const ws of wss.clients) ws.close(1001);
          return new Promise((r) => {
            const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); server.closeAllConnections?.(); }, 2000);
            wss.close(() => server.close(() => { clearTimeout(force); r(); }));
          });
        },
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bank = loadBank();
  start({ bank }).then((s) => {
    console.log(`quizdown server listening on 127.0.0.1:${s.port} (bank: ${bank.empty ? 'empty' : bank.size + ' questions'})`);
    const stop = () => s.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }).catch((e) => { console.error('start failed:', e.code || e.message); process.exit(1); });
}
