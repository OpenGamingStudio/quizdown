// Logique pure du multijoueur QuizDown (voir docs/MULTIJOUEUR.md).
// Aucune E/S : horloge, hasard et timers sont injectables ; l'envoi passe par session.send(obj).
import crypto from 'node:crypto';

export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LIMITS = {
  maxPlayers: 8,
  maxRooms: 200,
  msgPerSec: 20,
  connsPerIp: 10,
  createsPerMin: 5,
  joinFailsPerMin: 15,
  emptyMs: 5 * 60 * 1000,
  idleMs: 45 * 60 * 1000,
  revealMs: 4000,
};
const TIMES = [10, 15, 20, 30];
const MINUTE = 60 * 1000;

export function cleanName(s) {
  if (typeof s !== 'string') return '';
  s = s
    .replace(/[\p{C}]/gu, '')
    .replace(/[\s\p{Z}]+/gu, ' ')
    .replace(/\p{M}{3,}/gu, (m) => m.slice(0, 2))
    .trim();
  return Array.from(s).slice(0, 12).join('').trim();
}

const cleanAvatar = (a) => (typeof a === 'string' && /^a(?:\d|1[01])$/.test(a) ? a : 'a0');
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sameToken = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class Room {
  constructor(mgr, code) {
    this.mgr = mgr;
    this.code = code;
    this.players = []; // ordre d'arrivée
    this.host = null;
    this.phase = 'lobby';
    this.settings = {
      themes: mgr.bank.themes.slice(),
      levels: mgr.bank.levels.slice(),
      n: 10,
      time: 20,
    };
    this.questions = [];
    this.qi = -1;
    this.cur = null; // question en cours { text, answers, theme, level, correct, correctText, T, endAt }
    this.reveal = null;
    this.timer = null;
    this.lastActivity = mgr.now();
    this.emptySince = null;
  }

  connected() { return this.players.filter((p) => p.sess); }
  byId(id) { return this.players.find((p) => p.id === id); }

  uniqueName(name, except) {
    const taken = new Set(this.players.filter((p) => p !== except).map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let k = 2; ; k++) {
      const suf = String(k);
      const cand = Array.from(name).slice(0, 12 - suf.length).join('') + suf;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
  }

  view(p) {
    const m = this.mgr;
    const o = {
      t: 'room',
      phase: this.phase,
      code: this.code,
      host: this.host,
      you: p.id,
      settings: { themes: this.settings.themes.slice(), levels: this.settings.levels.slice(), n: this.settings.n, time: this.settings.time },
      players: this.players.map((x) => ({
        id: x.id, name: x.name, avatar: x.avatar, score: x.score, good: x.good,
        connected: !!x.sess, answered: x.answer !== null,
      })),
      qi: this.qi,
      total: this.questions.length,
    };
    if ((this.phase === 'question' || this.phase === 'reveal') && this.cur) {
      const c = this.cur;
      o.q = { text: c.text, answers: c.answers.slice(), theme: c.theme, level: c.level };
      o.T = c.T;
      o.ms = this.phase === 'question' ? Math.max(0, c.endAt - m.now()) : 0;
      if (this.phase === 'reveal') o.reveal = { correct: this.reveal.correct, results: this.reveal.results.map((r) => ({ ...r })) };
    }
    if (this.phase === 'final') o.missed = p.missed.map((x) => ({ ...x }));
    return o;
  }

  broadcast() {
    for (const p of this.players) if (p.sess) p.sess.send(this.view(p));
  }

  touch() { this.lastActivity = this.mgr.now(); }

  clearTimer() {
    if (this.timer !== null) { this.mgr.clearTimer(this.timer); this.timer = null; }
  }

  start() {
    const s = this.settings;
    const pool = this.mgr.bank.pool(s.themes, s.levels);
    if (!pool.length) return false;
    const m = this.mgr;
    // tirage sans doublon : Fisher-Yates partiel
    for (let i = 0; i < Math.min(s.n, pool.length); i++) {
      const j = i + m.randInt(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.questions = pool.slice(0, Math.min(s.n, pool.length));
    for (const p of this.players) { p.score = 0; p.good = 0; p.missed = []; p.answer = null; }
    this.qi = -1;
    this.nextQuestion();
    return true;
  }

  nextQuestion() {
    this.clearTimer();
    this.qi += 1;
    if (this.qi >= this.questions.length) return this.finish();
    const m = this.mgr;
    const x = this.questions[this.qi];
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = m.randInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const T = this.settings.time * 1000;
    this.cur = {
      text: x.q, theme: x.theme, level: x.level,
      answers: order.map((k) => x.a[k]),
      correct: order.indexOf(x.c),
      correctText: x.a[x.c],
      T, endAt: m.now() + T,
    };
    this.reveal = null;
    for (const p of this.players) p.answer = null;
    this.phase = 'question';
    const qi = this.qi;
    this.timer = m.setTimer(() => { this.timer = null; if (this.phase === 'question' && this.qi === qi) this.endQuestion(); }, T);
    this.broadcast();
  }

  allAnswered() {
    const c = this.connected();
    return c.length > 0 && c.every((p) => p.answer !== null);
  }

  endQuestion() {
    this.clearTimer();
    const c = this.cur;
    const results = [];
    for (const p of this.players) {
      const a = p.answer;
      const i = a ? a.i : -1;
      const gain = a && a.i === c.correct ? a.gain : 0;
      p.score += gain;
      if (gain > 0) p.good += 1;
      else p.missed.push({ q: c.text, a: c.correctText, mine: a ? c.answers[a.i] : null });
      results.push({ id: p.id, i, gain });
    }
    this.reveal = { correct: c.correct, results };
    this.phase = 'reveal';
    const qi = this.qi;
    this.timer = this.mgr.setTimer(() => { this.timer = null; if (this.phase === 'reveal' && this.qi === qi) this.nextQuestion(); }, this.mgr.limits.revealMs);
    this.broadcast();
  }

  finish() {
    this.clearTimer();
    this.phase = 'final';
    this.cur = null;
    this.reveal = null;
    this.broadcast();
  }

  backToLobby() {
    this.clearTimer();
    this.phase = 'lobby';
    this.questions = [];
    this.qi = -1;
    this.cur = null;
    this.reveal = null;
    for (const p of this.players) { p.score = 0; p.good = 0; p.missed = []; p.answer = null; }
    this.broadcast();
  }

  /** Après une déconnexion / un départ. */
  afterLeave(wasHost) {
    if (wasHost || !this.byId(this.host)?.sess) {
      const next = this.connected()[0];
      if (next) this.host = next.id;
    }
    const alive = this.players.length > 0;
    if (!alive) return this.mgr.dropRoom(this, false);
    if (this.connected().length === 0) { if (this.emptySince === null) this.emptySince = this.mgr.now(); }
    if (this.phase === 'question' && this.allAnswered()) return this.endQuestion();
    this.broadcast();
  }

  destroy(notify) {
    this.clearTimer();
    for (const p of this.players) {
      if (p.sess) {
        if (notify) p.sess.send({ t: 'closed' });
        p.sess.room = null;
        p.sess.pid = null;
        p.sess = null;
      }
    }
  }
}

export class Manager {
  /**
   * opts: { bank, now, randInt(n), randomBytes(n)->Buffer, setTimer, clearTimer, limits }
   * bank: { themes, levels, pool(themes, levels) } (voir bank.js)
   */
  constructor(opts = {}) {
    this.bank = opts.bank || { themes: [], levels: [], pool: () => [] };
    this.now = opts.now || Date.now;
    this.randInt = opts.randInt || ((n) => crypto.randomInt(n));
    this.randomBytes = opts.randomBytes || ((n) => crypto.randomBytes(n));
    this.setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer || ((h) => clearTimeout(h));
    this.limits = { ...LIMITS, ...(opts.limits || {}) };
    this.rooms = new Map();
    this.ipConns = new Map();
    this.ipCreates = new Map();
    this.ipJoinFails = new Map();
  }

  // ---- limites ----
  recent(map, ip, windowMs) {
    const t = this.now();
    const arr = (map.get(ip) || []).filter((x) => t - x < windowMs);
    if (arr.length) map.set(ip, arr); else map.delete(ip);
    return arr;
  }
  push(map, ip) {
    const arr = this.recent(map, ip, MINUTE);
    arr.push(this.now());
    map.set(ip, arr);
  }

  /** Nouvelle connexion ; null si l'IP a déjà trop de connexions. */
  connect(ip, send) {
    const n = this.ipConns.get(ip) || 0;
    if (n >= this.limits.connsPerIp) return null;
    this.ipConns.set(ip, n + 1);
    return { ip, send, room: null, pid: null, winStart: this.now(), winCount: 0, closed: false };
  }

  disconnect(sess) {
    if (sess.closed) return;
    sess.closed = true;
    const n = (this.ipConns.get(sess.ip) || 1) - 1;
    if (n <= 0) this.ipConns.delete(sess.ip); else this.ipConns.set(sess.ip, n);
    this.detach(sess, false);
  }

  /** Détache la session de son joueur (déconnexion ou départ). */
  detach(sess, leaving) {
    const room = sess.room;
    if (!room) return;
    const p = room.byId(sess.pid);
    sess.room = null;
    sess.pid = null;
    if (!p || p.sess !== sess) return;
    p.sess = null;
    const wasHost = room.host === p.id;
    if (leaving) {
      p.token = null; // plus de reprise possible
      if (room.phase === 'lobby') room.players.splice(room.players.indexOf(p), 1);
    }
    room.touch();
    room.afterLeave(wasHost);
  }

  err(sess, code, msg) { sess.send({ t: 'error', code, msg: msg || code }); }

  rateOk(sess) {
    const t = this.now();
    if (t - sess.winStart >= 1000) { sess.winStart = t; sess.winCount = 0; }
    sess.winCount += 1;
    return sess.winCount <= this.limits.msgPerSec;
  }

  /** Point d'entrée d'un message texte brut. */
  message(sess, raw) {
    if (sess.closed) return;
    if (!this.rateOk(sess)) return this.err(sess, 'rate');
    if (typeof raw !== 'string' || raw.length > 2048) return this.err(sess, 'bad');
    let msg;
    try { msg = JSON.parse(raw); } catch { return this.err(sess, 'bad'); }
    if (!isObj(msg) || typeof msg.t !== 'string') return this.err(sess, 'bad');
    switch (msg.t) {
      case 'ping': return sess.send({ t: 'pong' });
      case 'create': return this.create(sess, msg);
      case 'join': return this.join(sess, msg);
      case 'resume': return this.resume(sess, msg);
      case 'leave': return this.detach(sess, true);
    }
    const room = sess.room;
    const p = room && room.byId(sess.pid);
    if (!room || !p) return this.err(sess, 'bad');
    room.touch();
    switch (msg.t) {
      case 'profile': return this.profile(room, p, msg);
      case 'settings': return this.settings(room, p, msg);
      case 'start': return this.startGame(room, p);
      case 'answer': return this.answer(room, p, msg);
      case 'again':
        if (room.host !== p.id) return this.err(sess, 'host_only');
        if (room.phase !== 'final') return this.err(sess, 'bad');
        return room.backToLobby();
      default: return this.err(sess, 'bad');
    }
  }

  newId(len) {
    return this.randomBytes(len).toString('hex');
  }

  newCode() {
    for (let k = 0; k < 100; k++) {
      let c = '';
      for (let i = 0; i < 5; i++) c += ALPHABET[this.randInt(ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }

  addPlayer(room, sess, msg) {
    const base = cleanName(msg.name);
    if (!base) return null;
    const p = {
      id: this.newId(4), token: this.newId(16),
      name: room.uniqueName(base), avatar: cleanAvatar(msg.avatar),
      score: 0, good: 0, missed: [], answer: null, sess,
    };
    room.players.push(p);
    sess.room = room;
    sess.pid = p.id;
    room.emptySince = null;
    return p;
  }

  create(sess, msg) {
    if (sess.room) return this.err(sess, 'bad');
    if (this.recent(this.ipCreates, sess.ip, MINUTE).length >= this.limits.createsPerMin) return this.err(sess, 'rate');
    if (!cleanName(msg.name)) return this.err(sess, 'bad', 'name');
    if (this.rooms.size >= this.limits.maxRooms) return this.err(sess, 'limit');
    const code = this.newCode();
    if (!code) return this.err(sess, 'limit');
    this.push(this.ipCreates, sess.ip);
    const room = new Room(this, code);
    this.rooms.set(code, room);
    const p = this.addPlayer(room, sess, msg);
    room.host = p.id;
    sess.send({ t: 'joined', code, pid: p.id, token: p.token });
    room.broadcast();
  }

  failJoin(sess, code, msg) {
    this.push(this.ipJoinFails, sess.ip);
    this.err(sess, code, msg);
  }

  findRoom(code) {
    if (typeof code !== 'string') return null;
    const c = code.trim().toUpperCase();
    return /^[A-Z2-9]{5}$/.test(c) ? this.rooms.get(c) || null : null;
  }

  join(sess, msg) {
    if (sess.room) return this.err(sess, 'bad');
    if (this.recent(this.ipJoinFails, sess.ip, MINUTE).length >= this.limits.joinFailsPerMin) return this.err(sess, 'rate');
    const room = this.findRoom(msg.code);
    if (!room) return this.failJoin(sess, 'not_found');
    if (!cleanName(msg.name)) return this.err(sess, 'bad', 'name');
    if (room.phase !== 'lobby') return this.err(sess, 'started');
    if (room.players.length >= this.limits.maxPlayers) return this.err(sess, 'full');
    const p = this.addPlayer(room, sess, msg);
    room.touch();
    sess.send({ t: 'joined', code: room.code, pid: p.id, token: p.token });
    room.broadcast();
  }

  resume(sess, msg) {
    if (sess.room) return this.err(sess, 'bad');
    if (this.recent(this.ipJoinFails, sess.ip, MINUTE).length >= this.limits.joinFailsPerMin) return this.err(sess, 'rate');
    const room = this.findRoom(msg.code);
    const p = room && typeof msg.pid === 'string' ? room.byId(msg.pid) : null;
    if (!p || !sameToken(p.token, msg.token)) return this.failJoin(sess, 'not_found');
    const old = p.sess;
    if (old) { old.room = null; old.pid = null; if (old.kick) old.kick(); }
    p.sess = sess;
    sess.room = room;
    sess.pid = p.id;
    room.emptySince = null;
    room.touch();
    sess.send({ t: 'joined', code: room.code, pid: p.id, token: p.token });
    room.broadcast();
  }

  profile(room, p, msg) {
    if (room.phase !== 'lobby') return this.err(p.sess, 'bad');
    const base = cleanName(msg.name);
    if (!base) return this.err(p.sess, 'bad', 'name');
    p.name = room.uniqueName(base, p);
    p.avatar = cleanAvatar(msg.avatar);
    room.broadcast();
  }

  settings(room, p, msg) {
    if (room.host !== p.id) return this.err(p.sess, 'host_only');
    if (room.phase !== 'lobby') return this.err(p.sess, 'bad');
    const s = msg.settings;
    if (!isObj(s)) return this.err(p.sess, 'bad');
    const next = { ...room.settings };
    const idList = (x) => Array.isArray(x) && x.length <= 50 && x.every((v) => typeof v === 'string' && v.length <= 40);
    if (s.themes !== undefined) { if (!idList(s.themes)) return this.err(p.sess, 'bad'); next.themes = [...new Set(s.themes)]; }
    if (s.levels !== undefined) { if (!idList(s.levels)) return this.err(p.sess, 'bad'); next.levels = [...new Set(s.levels)]; }
    if (s.n !== undefined) { if (!Number.isInteger(s.n) || s.n < 5 || s.n > 30) return this.err(p.sess, 'bad'); next.n = s.n; }
    if (s.time !== undefined) { if (!TIMES.includes(s.time)) return this.err(p.sess, 'bad'); next.time = s.time; }
    room.settings = next;
    room.broadcast();
  }

  startGame(room, p) {
    if (room.host !== p.id) return this.err(p.sess, 'host_only');
    if (room.phase !== 'lobby') return this.err(p.sess, 'bad');
    if (room.connected().length < 2) return this.err(p.sess, 'few');
    if (!room.start()) return this.err(p.sess, 'empty');
  }

  answer(room, p, msg) {
    if (room.phase !== 'question' || !room.cur) return; // trop tard : ignoré
    if (msg.qi !== room.qi || !Number.isInteger(msg.i) || msg.i < 0 || msg.i > 3) return this.err(p.sess, 'bad');
    if (p.answer !== null) return; // la première compte
    const c = room.cur;
    const remaining = Math.max(0, c.endAt - this.now());
    p.answer = { i: msg.i, gain: msg.i === c.correct ? 100 + Math.round((50 * remaining) / c.T) : 0 };
    if (room.allAnswered()) room.endQuestion();
    else room.broadcast();
  }

  dropRoom(room, notify) {
    room.destroy(notify);
    this.rooms.delete(room.code);
  }

  /** Expire les rooms (à appeler périodiquement) et nettoie les compteurs d'IP. */
  sweep() {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      const noOne = room.connected().length === 0;
      if ((noOne && room.emptySince !== null && t - room.emptySince >= this.limits.emptyMs) ||
          t - room.lastActivity >= this.limits.idleMs) {
        this.dropRoom(room, true);
      }
    }
    for (const map of [this.ipCreates, this.ipJoinFails]) for (const ip of [...map.keys()]) this.recent(map, ip, MINUTE);
  }

  /** Arrêt : prévient tous les joueurs et libère les timers. */
  shutdown() {
    for (const room of [...this.rooms.values()]) this.dropRoom(room, true);
  }
}
