import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from '../../server/node_modules/ws/wrapper.mjs';
import { start, clientIp } from '../../server/index.js';
import { testBank, good } from './helpers.mjs';

let srv;
beforeAll(async () => { srv = await start({ port: 0, bank: testBank() }); });
afterAll(async () => { await srv.close(); });

const url = (p = '/ws') => `ws://127.0.0.1:${srv.port}${p}`;

function open(headers = {}, path = '/ws') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(path), { headers });
    ws.inbox = [];
    ws.waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      ws.inbox.push(m);
      ws.waiters = ws.waiters.filter((w) => !w(m));
    });
    ws.json = (o) => ws.send(JSON.stringify(o));
    ws.next = (pred) => new Promise((res, rej) => {
      const hit = ws.inbox.find(pred);
      if (hit) return res(hit);
      const to = setTimeout(() => rej(new Error('timeout ' + JSON.stringify(ws.inbox.slice(-3)))), 3000);
      ws.waiters.push((m) => { if (pred(m)) { clearTimeout(to); res(m); return true; } return false; });
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const closed = (ws) => new Promise((r) => (ws.readyState === WebSocket.CLOSED ? r({ code: ws.closeCode }) : ws.once('close', (code) => r({ code }))));
const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

describe('serveur http + ws', () => {
  it('GET /healthz -> 200, autre chemin -> 404', async () => {
    expect(await get('/healthz')).toBe(200);
    expect(await get('/')).toBe(404);
  });

  it('seul /ws accepte les WebSocket', async () => {
    await expect(open({}, '/autre')).rejects.toThrow();
  });

  it('clientIp : dernière entrée de X-Forwarded-For, sinon l\'adresse du socket', () => {
    const req = (xff, ra) => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: ra } });
    expect(clientIp(req('6.6.6.6, 1.2.3.4', '127.0.0.1'))).toBe('1.2.3.4');
    expect(clientIp(req('1.2.3.4', '127.0.0.1'))).toBe('1.2.3.4');
    expect(clientIp(req('', '127.0.0.1'))).toBe('127.0.0.1');
    expect(clientIp(req(undefined, '::1'))).toBe('::1');
  });

  it('message > 2 Ko : la connexion est fermée (1009)', async () => {
    const ws = await open({ 'x-forwarded-for': '10.1.0.1' });
    const c = closed(ws);
    ws.send(JSON.stringify({ t: 'create', name: 'x'.repeat(3000) }));
    expect((await c).code).toBe(1009);
  });

  it('trame binaire : erreur bad', async () => {
    const ws = await open({ 'x-forwarded-for': '10.1.0.2' });
    ws.send(Buffer.from([1, 2, 3]));
    expect((await ws.next((m) => m.t === 'error')).code).toBe('bad');
    ws.close();
  });

  it('11e connexion de la même IP (X-Forwarded-For) refusée', async () => {
    const socks = [];
    for (let k = 0; k < 10; k++) socks.push(await open({ 'x-forwarded-for': '1.1.1.1, 10.1.0.3' }));
    const ws = await open({ 'x-forwarded-for': '1.1.1.1, 10.1.0.3' });
    expect((await ws.next((m) => m.t === 'error')).code).toBe('rate');
    expect((await closed(ws)).code).toBe(1013);
    const other = await open({ 'x-forwarded-for': '10.1.0.4' });
    other.json({ t: 'ping' });
    await other.next((m) => m.t === 'pong');
    for (const s of [...socks, other]) s.close();
  });

  it('partie complète avec de vrais sockets : create, join, settings, start, answer, reveal', async () => {
    const a = await open({ 'x-forwarded-for': '10.2.0.1' });
    const b = await open({ 'x-forwarded-for': '10.2.0.2' });
    a.json({ t: 'create', name: 'Alice', avatar: 'a3' });
    const { code } = await a.next((m) => m.t === 'joined');
    b.json({ t: 'join', code: code.toLowerCase(), name: 'Bob', avatar: 'a4' });
    await b.next((m) => m.t === 'joined');
    await a.next((m) => m.t === 'room' && m.players.length === 2);
    a.json({ t: 'settings', settings: { themes: ['sci'], levels: ['facile'], n: 5, time: 10 } });
    await b.next((m) => m.t === 'room' && m.settings.n === 5);
    b.json({ t: 'start' });
    expect((await b.next((m) => m.t === 'error')).code).toBe('host_only');
    a.json({ t: 'start' });
    const q = await b.next((m) => m.t === 'room' && m.phase === 'question');
    expect(q.qi).toBe(0);
    expect(q.q.answers).toHaveLength(4);
    expect(JSON.stringify(q)).not.toMatch(/correct/);
    const g = good(q);
    a.json({ t: 'answer', qi: 0, i: g });
    b.json({ t: 'answer', qi: 0, i: (g + 1) % 4 });
    const rv = await a.next((m) => m.t === 'room' && m.phase === 'reveal');
    expect(rv.reveal.correct).toBe(g);
    expect(rv.players.find((p) => p.name === 'Alice').score).toBeGreaterThanOrEqual(100);
    expect(rv.players.find((p) => p.name === 'Bob').score).toBe(0);
    // reprise de Bob après coupure
    const { pid, token } = b.inbox.find((m) => m.t === 'joined');
    b.terminate();
    await a.next((m) => m.t === 'room' && m.players[1]?.connected === false);
    const b2 = await open({ 'x-forwarded-for': '10.2.0.2' });
    b2.json({ t: 'resume', code, pid, token });
    const r2 = await b2.next((m) => m.t === 'room');
    expect(r2.you).toBe(pid);
    expect(r2.phase).toBe('reveal');
    a.close();
    b2.close();
  });
});

describe('processus index.js', () => {
  it('démarre avec une banque absente (empty) et s\'arrête proprement sur SIGTERM', async () => {
    const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../server/index.js', import.meta.url))], {
      env: { ...process.env, PORT: String(port), BANK_DIR: '/nonexistent/bank' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const exit = new Promise((r) => child.on('exit', (code, sig) => r({ code, sig })));
    try {
      let ok = false;
      for (let k = 0; k < 50 && !ok; k++) {
        await new Promise((r) => setTimeout(r, 100));
        ok = await new Promise((r) => http.get({ host: '127.0.0.1', port, path: '/healthz' }, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)));
      }
      expect(ok).toBe(true);
      expect(out).toContain('empty');
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise((r) => ws.once('open', r));
      const got = new Promise((r) => ws.on('message', (d) => r(JSON.parse(d.toString()))));
      ws.send(JSON.stringify({ t: 'create', name: 'A' }));
      await got;
      child.kill('SIGTERM');
      expect(await exit).toEqual({ code: 0, sig: null });
    } finally {
      child.kill('SIGKILL');
    }
  });
});
