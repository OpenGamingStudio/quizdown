import { Manager } from '../../server/rooms.js';
import { makeBank } from '../../server/bank.js';

export function makeQuestions(prefix, n) {
  return Array.from({ length: n }, (_, k) => ({
    q: `${prefix} question ${k}`,
    a: [`${prefix}${k} A`, `${prefix}${k} B`, `${prefix}${k} C`, `${prefix}${k} D`],
    c: k % 4,
  }));
}

export const testBank = () =>
  makeBank({
    geo: { facile: makeQuestions('geo-f', 12), difficile: makeQuestions('geo-d', 8) },
    sci: { facile: makeQuestions('sci-f', 12) },
  });

/** Horloge + timers manuels, RNG déterministe (LCG). */
export function makeEnv(extra = {}) {
  let t = 1_000_000;
  let id = 0;
  const timers = new Map();
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  const env = {
    get t() { return t; },
    timers,
    advance(ms) {
      const target = t + ms;
      for (;;) {
        let next = null;
        for (const [h, x] of timers) if (x.at <= target && (!next || x.at < next[1].at)) next = [h, x];
        if (!next) break;
        timers.delete(next[0]);
        t = Math.max(t, next[1].at);
        next[1].fn();
      }
      t = target;
    },
  };
  env.mgr = new Manager({
    bank: extra.bank || testBank(),
    now: () => t,
    randInt: (n) => (rnd() >>> 12) % n,
    randomBytes: (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (rnd() >>> 10) & 255; return b; },
    setTimer: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; },
    clearTimer: (h) => { timers.delete(h); },
    limits: extra.limits,
  });
  return env;
}

/** Faux client : une session + sa boîte de réception. */
export function client(env, ip = '1.1.1.1') {
  const inbox = [];
  const sess = env.mgr.connect(ip, (o) => inbox.push(JSON.parse(JSON.stringify(o))));
  const c = {
    sess, inbox, pid: null, token: null, code: null,
    send(o) { env.mgr.message(sess, typeof o === 'string' ? o : JSON.stringify(o)); return c; },
    last(t) { for (let i = inbox.length - 1; i >= 0; i--) if (!t || inbox[i].t === t) return inbox[i]; return null; },
    room() { return c.last('room'); },
    err() { return c.last('error'); },
    clear() { inbox.length = 0; },
    drop() { env.mgr.disconnect(sess); },
  };
  return c;
}

export function create(env, name = 'Host', ip) {
  const c = client(env, ip);
  c.send({ t: 'create', name, avatar: 'a1' });
  const j = c.last('joined');
  Object.assign(c, { pid: j.pid, token: j.token, code: j.code });
  return c;
}

export function join(env, code, name, ip) {
  const c = client(env, ip);
  c.send({ t: 'join', code, name, avatar: 'a2' });
  const j = c.last('joined');
  if (j) Object.assign(c, { pid: j.pid, token: j.token, code: j.code });
  return c;
}

/** Room avec n joueurs, partie lancée. */
export function started(env, n = 2, settings = { themes: ['geo'], levels: ['facile'], n: 5, time: 10 }) {
  const host = create(env, 'P0', '10.0.0.0');
  const others = [];
  for (let k = 1; k < n; k++) others.push(join(env, host.code, `P${k}`, `10.0.0.${k}`));
  host.send({ t: 'settings', settings });
  host.send({ t: 'start' });
  return { host, others, all: [host, ...others] };
}

/** Index (dans les réponses envoyées) de la bonne réponse : la question k a pour bonne lettre ABCD[k % 4]. */
export const good = (r) =>
  r.q.answers.findIndex((a) => {
    const m = /(\d+) ([A-D])$/.exec(a);
    return 'ABCD'[Number(m[1]) % 4] === m[2];
  });
