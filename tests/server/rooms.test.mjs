import { describe, it, expect } from 'vitest';
import { ALPHABET, cleanName } from '../../server/rooms.js';
import { makeBank, loadBank } from '../../server/bank.js';
import { makeEnv, client, create, join, started, makeQuestions, good } from './helpers.mjs';

describe('création / join / code', () => {
  it('crée une room : code de 5 caractères sans O0I1, hôte, état lobby', () => {
    const env = makeEnv();
    for (let k = 0; k < 50; k++) {
      const c = create(env, 'Alice', `9.9.${k}.1`);
      expect(c.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
      expect(c.code).not.toMatch(/[O0I1]/);
    }
    expect(ALPHABET).toHaveLength(32);
    const h = create(env, 'Alice', '2.2.2.2');
    const r = h.room();
    expect(r.phase).toBe('lobby');
    expect(r.host).toBe(h.pid);
    expect(r.you).toBe(h.pid);
    expect(r.players).toEqual([{ id: h.pid, name: 'Alice', avatar: 'a1', score: 0, good: 0, connected: true, answered: false }]);
    expect(h.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('join insensible à la casse, tous les joueurs reçoivent la room', () => {
    const env = makeEnv();
    const h = create(env);
    const j = join(env, h.code.toLowerCase(), 'Bob');
    expect(j.last('joined').code).toBe(h.code);
    expect(h.room().players.map((p) => p.name)).toEqual(['Host', 'Bob']);
    expect(j.room().you).toBe(j.pid);
    expect(j.room().host).toBe(h.pid);
  });

  it('code inconnu / mal formé : not_found ; avatar invalide : a0', () => {
    const env = makeEnv();
    const c = client(env);
    c.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
    expect(c.err().code).toBe('not_found');
    c.send({ t: 'join', code: 42, name: 'x' });
    expect(c.err().code).toBe('not_found');
    const h = create(env);
    const j = client(env, '5.5.5.5');
    j.send({ t: 'join', code: h.code, name: 'Zed', avatar: 'a99' });
    expect(h.room().players[1].avatar).toBe('a0');
  });

  it('messages invalides : bad', () => {
    const env = makeEnv();
    const c = client(env);
    for (const m of ['pas du json', '[]', '"x"', '{}', '{"t":5}', '{"t":"nope"}', '{"t":"start"}']) {
      c.send(m);
      expect(c.err().code).toBe('bad');
    }
    c.send({ t: 'create', name: '   ' });
    expect(c.err().code).toBe('bad');
    c.send({ t: 'ping' });
    expect(c.last().t).toBe('pong');
  });
});

describe('limites', () => {
  it('8 joueurs max puis full', () => {
    const env = makeEnv();
    const h = create(env);
    for (let k = 1; k < 8; k++) expect(join(env, h.code, `J${k}`, `3.3.3.${k}`).last('joined')).toBeTruthy();
    const x = join(env, h.code, 'Neuf', '3.3.3.9');
    expect(x.err().code).toBe('full');
    expect(h.room().players).toHaveLength(8);
  });

  it('200 rooms max puis limit', () => {
    const env = makeEnv({ limits: { createsPerMin: 1e9, connsPerIp: 1e9 } });
    for (let k = 0; k < 200; k++) create(env, 'H', `ip${k}`);
    const c = client(env);
    c.send({ t: 'create', name: 'H' });
    expect(c.err().code).toBe('limit');
    expect(env.mgr.rooms.size).toBe(200);
  });

  it('5 créations / min / IP puis rate, la fenêtre se libère', () => {
    const env = makeEnv();
    for (let k = 0; k < 5; k++) create(env, 'H', '7.7.7.7');
    const c = client(env, '7.7.7.7');
    c.send({ t: 'create', name: 'H' });
    expect(c.err().code).toBe('rate');
    env.advance(61_000);
    c.send({ t: 'create', name: 'H' });
    expect(c.last('joined')).toBeTruthy();
  });

  it('15 join ratés / min / IP puis rate, même avec un bon code', () => {
    const env = makeEnv();
    const h = create(env);
    const c = client(env, '8.8.8.8');
    for (let k = 0; k < 15; k++) {
      c.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
      expect(c.err().code).toBe('not_found');
    }
    c.send({ t: 'join', code: h.code, name: 'x' });
    expect(c.err().code).toBe('rate');
    const d = client(env, '8.8.4.4');
    d.send({ t: 'join', code: h.code, name: 'ok' });
    expect(d.last('joined')).toBeTruthy();
    env.advance(61_000);
    c.send({ t: 'join', code: h.code, name: 'x' });
    expect(c.last('joined')).toBeTruthy();
  });

  it('les joins réussis ne comptent pas dans le rate limit', () => {
    const env = makeEnv({ limits: { maxPlayers: 100, connsPerIp: 100 } });
    const h = create(env);
    for (let k = 0; k < 20; k++) expect(join(env, h.code, `J${k}`, '4.4.4.4').last('joined')).toBeTruthy();
  });

  it('10 connexions / IP', () => {
    const env = makeEnv();
    const cs = [];
    for (let k = 0; k < 10; k++) cs.push(client(env, '6.6.6.6'));
    expect(env.mgr.connect('6.6.6.6', () => {})).toBeNull();
    cs[0].drop();
    expect(env.mgr.connect('6.6.6.6', () => {})).not.toBeNull();
    expect(env.mgr.connect('6.6.6.7', () => {})).not.toBeNull();
  });

  it('20 messages / s / connexion puis rate', () => {
    const env = makeEnv();
    const c = client(env);
    for (let k = 0; k < 20; k++) c.send({ t: 'ping' });
    expect(c.inbox.filter((m) => m.t === 'pong')).toHaveLength(20);
    c.send({ t: 'ping' });
    expect(c.err().code).toBe('rate');
    env.advance(1000);
    c.send({ t: 'ping' });
    expect(c.last().t).toBe('pong');
  });

  it('message trop gros refusé par le gestionnaire (2 Ko)', () => {
    const env = makeEnv();
    const c = client(env);
    c.send(JSON.stringify({ t: 'create', name: 'x'.repeat(3000) }));
    expect(c.err().code).toBe('bad');
    expect(env.mgr.rooms.size).toBe(0);
  });
});

describe('pseudos', () => {
  it('nettoyage : contrôles, espaces, longueur 12', () => {
    expect(cleanName('  a\u0000b‮c \n d  ')).toBe('abc d');
    expect(cleanName('x'.repeat(40))).toBe('x'.repeat(12));
    expect(cleanName('​\u0007  ')).toBe('');
    expect(cleanName(null)).toBe('');
    expect(cleanName({ a: 1 })).toBe('');
    expect(Array.from(cleanName('😀'.repeat(20)))).toHaveLength(12);
    expect(cleanName('a' + '́'.repeat(10))).toBe('á́');
  });

  it('doublons : suffixe, longueur max respectée, insensible à la casse', () => {
    const env = makeEnv();
    const h = create(env, 'Alice');
    join(env, h.code, 'alice', '1.0.0.1');
    join(env, h.code, 'ALICE', '1.0.0.2');
    join(env, h.code, 'x'.repeat(12), '1.0.0.3');
    join(env, h.code, 'x'.repeat(12), '1.0.0.4');
    const names = h.room().players.map((p) => p.name);
    expect(names).toEqual(['Alice', 'alice2', 'ALICE3', 'x'.repeat(12), 'x'.repeat(11) + '2']);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(5);
  });

  it('XSS : le serveur renvoie la chaîne nettoyée telle quelle (échappement côté client)', () => {
    const env = makeEnv();
    const h = create(env, '<img src=x onerror=1>');
    expect(h.room().players[0].name).toBe('<img src=x o');
    const j = join(env, h.code, '<b>&"\'', '1.0.0.9');
    expect(h.room().players[1].name).toBe('<b>&"\'');
    expect(JSON.stringify(h.room())).not.toContain('\u0000');
  });

  it('profile : lobby seulement, unicité conservée', () => {
    const env = makeEnv();
    const h = create(env, 'Alice');
    const b = join(env, h.code, 'Bob');
    b.send({ t: 'profile', name: 'Alice', avatar: 'a5' });
    expect(h.room().players[1]).toMatchObject({ name: 'Alice2', avatar: 'a5' });
    b.send({ t: 'profile', name: 'Alice2', avatar: 'a6' });
    expect(h.room().players[1]).toMatchObject({ name: 'Alice2', avatar: 'a6' });
    b.send({ t: 'profile', name: '', avatar: 'a6' });
    expect(b.err().code).toBe('bad');
    h.send({ t: 'start' });
    b.send({ t: 'profile', name: 'Neo', avatar: 'a1' });
    expect(h.room().players[1].name).toBe('Alice2');
  });
});

describe('hôte : réglages et lancement', () => {
  it('seul l\'hôte règle et lance', () => {
    const env = makeEnv();
    const h = create(env);
    const b = join(env, h.code, 'Bob');
    b.send({ t: 'settings', settings: { n: 7 } });
    expect(b.err().code).toBe('host_only');
    b.send({ t: 'start' });
    expect(b.err().code).toBe('host_only');
    expect(h.room().phase).toBe('lobby');
    h.send({ t: 'settings', settings: { themes: ['geo'], levels: ['facile'], n: 7, time: 15 } });
    expect(b.room().settings).toEqual({ themes: ['geo'], levels: ['facile'], n: 7, time: 15 });
  });

  it('réglages invalides : bad, rien ne change', () => {
    const env = makeEnv();
    const h = create(env);
    const before = JSON.stringify(h.room().settings);
    for (const s of [{ n: 4 }, { n: 31 }, { n: 7.5 }, { n: '8' }, { time: 12 }, { time: '10' }, { themes: 'geo' }, { themes: [1] }, { levels: {} }, null, 'x', []]) {
      h.send({ t: 'settings', settings: s });
      expect(h.err().code).toBe('bad');
    }
    expect(JSON.stringify(h.room().settings)).toBe(before);
    for (const time of [10, 15, 20, 30]) { h.send({ t: 'settings', settings: { time } }); expect(h.room().settings.time).toBe(time); }
  });

  it('start : few avec < 2 connectés, empty si aucune question', () => {
    const env = makeEnv();
    const h = create(env);
    h.send({ t: 'start' });
    expect(h.err().code).toBe('few');
    const b = join(env, h.code, 'Bob');
    b.drop();
    h.send({ t: 'start' });
    expect(h.err().code).toBe('few');
    const c = join(env, h.code, 'Cy', '1.2.3.4');
    h.send({ t: 'settings', settings: { themes: ['inconnu'] } });
    h.send({ t: 'start' });
    expect(h.err().code).toBe('empty');
    expect(h.room().phase).toBe('lobby');
  });

  it('banque vide : start renvoie empty', () => {
    const env = makeEnv({ bank: makeBank({}) });
    const h = create(env);
    join(env, h.code, 'Bob');
    h.send({ t: 'start' });
    expect(h.err().code).toBe('empty');
  });

  it('n tiré sans doublon dans les couples thème x niveau, borné à la taille du pool', () => {
    const env = makeEnv();
    const { host } = started(env, 2, { themes: ['geo', 'sci'], levels: ['facile', 'difficile'], n: 30, time: 10 });
    expect(host.room().total).toBe(30);
    const env2 = makeEnv();
    const g = started(env2, 2, { themes: ['geo'], levels: ['difficile'], n: 30, time: 10 });
    expect(g.host.room().total).toBe(8); // pool de 8 seulement
    const seen = new Set();
    for (let k = 0; k < 8; k++) {
      seen.add(g.host.room().q.text);
      expect(g.host.room().q.level).toBe('difficile');
      expect(g.host.room().q.theme).toBe('geo');
      env2.advance(10_000 + 4000);
    }
    expect(seen.size).toBe(8);
  });

  it('start impossible hors lobby, join refusé pendant la partie (started)', () => {
    const env = makeEnv();
    const g = started(env);
    g.host.send({ t: 'start' });
    expect(g.host.err().code).toBe('bad');
    expect(join(env, g.host.code, 'Late', '5.5.5.5').err().code).toBe('started');
  });
});

describe('partie : scoring serveur', () => {
  it('bonus selon le temps : 100 + round(50 * restant / T)', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    const r = host.room();
    expect(r.phase).toBe('question');
    expect(r.T).toBe(10_000);
    expect(r.ms).toBe(10_000);
    const g = good(r);
    host.send({ t: 'answer', qi: 0, i: g }); // t=0 -> 150
    env.advance(4000);
    others[0].send({ t: 'answer', qi: 0, i: g }); // restant 6000 -> 130
    expect(others[0].room().ms).toBe(6000);
    env.advance(5000);
    others[1].send({ t: 'answer', qi: 0, i: (g + 1) % 4 }); // faux -> 0
    const rv = host.room();
    expect(rv.phase).toBe('reveal');
    const byId = Object.fromEntries(rv.reveal.results.map((x) => [x.id, x]));
    expect(byId[host.pid].gain).toBe(150);
    expect(byId[others[0].pid].gain).toBe(130);
    expect(byId[others[1].pid]).toMatchObject({ gain: 0, i: (g + 1) % 4 });
    expect(rv.reveal.correct).toBe(g);
    const sc = Object.fromEntries(rv.players.map((p) => [p.id, [p.score, p.good]]));
    expect(sc[host.pid]).toEqual([150, 1]);
    expect(sc[others[0].pid]).toEqual([130, 1]);
    expect(sc[others[1].pid]).toEqual([0, 0]);
  });

  it('le client ne fixe pas son score : champs score/gain/c ignorés', () => {
    const env = makeEnv();
    const { host, others } = started(env);
    const g = good(host.room());
    const wrong = (g + 1) % 4;
    host.send({ t: 'answer', qi: 0, i: wrong, score: 9999, gain: 9999, correct: true });
    others[0].send({ t: 'answer', qi: 0, i: wrong });
    const rv = host.room();
    expect(rv.reveal.results.every((x) => x.gain === 0)).toBe(true);
    expect(rv.players.every((p) => p.score === 0)).toBe(true);
  });

  it('une seule réponse par question : la première compte ; qi / i invalides refusés', () => {
    const env = makeEnv();
    const { host, others } = started(env);
    const g = good(host.room());
    host.send({ t: 'answer', qi: 3, i: 0 }); // périmée : ignorée sans erreur
    expect(host.err()).toBeNull();
    host.send({ t: 'answer', qi: 0, i: 4 });
    expect(host.err().code).toBe('bad');
    host.send({ t: 'answer', qi: 0, i: '1' });
    expect(host.err().code).toBe('bad');
    host.send({ t: 'answer', qi: 0, i: (g + 1) % 4 });
    host.send({ t: 'answer', qi: 0, i: g });
    others[0].send({ t: 'answer', qi: 0, i: g });
    const r = host.room().reveal.results.find((x) => x.id === host.pid);
    expect(r).toMatchObject({ i: (g + 1) % 4, gain: 0 });
  });

  it('question terminée quand tous les connectés ont répondu ; sinon à T', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    const g = good(host.room());
    host.send({ t: 'answer', qi: 0, i: g });
    others[0].send({ t: 'answer', qi: 0, i: g });
    expect(host.room().phase).toBe('question');
    expect(host.room().players.map((p) => p.answered)).toEqual([true, true, false]);
    env.advance(9999);
    expect(host.room().phase).toBe('question');
    env.advance(1);
    const rv = host.room();
    expect(rv.phase).toBe('reveal');
    expect(rv.reveal.results.find((x) => x.id === others[1].pid)).toMatchObject({ i: -1, gain: 0 });
  });

  it('un joueur déconnecté ne bloque pas la question ; sa déconnexion peut la terminer', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    const g = good(host.room());
    host.send({ t: 'answer', qi: 0, i: g });
    others[0].send({ t: 'answer', qi: 0, i: g });
    others[1].drop();
    expect(host.room().phase).toBe('reveal');
    expect(host.room().players[2].connected).toBe(false);
  });

  it('reveal 4 s puis question suivante, puis final avec classement et missed', () => {
    const env = makeEnv();
    const { host, others } = started(env, 2, { themes: ['geo'], levels: ['facile'], n: 5, time: 10 });
    for (let k = 0; k < 5; k++) {
      const r = host.room();
      expect(r.phase).toBe('question');
      expect(r.qi).toBe(k);
      expect(r.total).toBe(5);
      const g = good(r);
      host.send({ t: 'answer', qi: k, i: g });
      if (k % 2 === 0) others[0].send({ t: 'answer', qi: k, i: (g + 1) % 4 });
      // k impair : l'autre ne répond pas
      env.advance(k % 2 === 0 ? 0 : 10_000);
      expect(host.room().phase).toBe('reveal');
      env.advance(3999);
      expect(host.room().phase).toBe('reveal');
      env.advance(1);
    }
    const f = host.room();
    expect(f.phase).toBe('final');
    expect(f.q).toBeUndefined();
    expect(f.players.find((p) => p.id === host.pid).good).toBe(5);
    expect(f.missed).toEqual([]);
    const m = others[0].room().missed;
    expect(m).toHaveLength(5);
    expect(m.filter((x) => x.mine === null)).toHaveLength(2);
    for (const x of m) { expect(typeof x.q).toBe('string'); expect(typeof x.a).toBe('string'); }
    expect(m.filter((x) => x.mine !== null).every((x) => x.mine !== x.a)).toBe(true);
    expect(env.timers.size).toBe(0);
  });

  it('again : hôte seulement (revanche), phase final seulement, retour au lobby scores à zéro', () => {
    const env = makeEnv();
    const { host, others } = started(env, 2, { themes: ['geo'], levels: ['facile'], n: 5, time: 10 });
    host.send({ t: 'again' });
    expect(host.err().code).toBe('bad');
    for (let k = 0; k < 5; k++) { host.send({ t: 'answer', qi: k, i: good(host.room()) }); others[0].send({ t: 'answer', qi: k, i: 0 }); env.advance(4000); }
    expect(host.room().phase).toBe('final');
    expect(host.room().players[0].score).toBeGreaterThan(0);
    others[0].send({ t: 'again' });
    expect(others[0].err().code).toBe('host_only');
    expect(host.room().phase).toBe('final');
    host.send({ t: 'again' });
    const r = host.room();
    expect(r.phase).toBe('lobby');
    expect(r.players.every((p) => p.score === 0 && p.good === 0 && !p.answered)).toBe(true);
    expect(r.q).toBeUndefined();
    expect(r.missed).toBeUndefined();
    host.send({ t: 'start' });
    expect(host.room().phase).toBe('question');
    expect(host.room().qi).toBe(0);
  });
});

describe('confidentialité', () => {
  it('jamais la bonne réponse ni le score avant reveal', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    const g = good(host.room());
    host.send({ t: 'answer', qi: 0, i: g });
    others[0].send({ t: 'answer', qi: 0, i: (g + 1) % 4 });
    for (const c of [host, others[0], others[1]]) {
      const r = c.room();
      expect(r.phase).toBe('question');
      expect(r.reveal).toBeUndefined();
      expect(r.missed).toBeUndefined();
      expect(r.players.every((p) => p.score === 0 && p.good === 0)).toBe(true);
      expect(r.q.answers).toHaveLength(4);
      expect(Object.keys(r.q).sort()).toEqual(['answers', 'level', 'text', 'theme']);
    }
    // aucun message de la question ne contient d'index de bonne réponse : pas de champ c / correct
    for (const m of host.inbox.filter((x) => x.t === 'room' && x.phase === 'question')) {
      expect(JSON.stringify(m)).not.toMatch(/"(c|correct|correctText)"/);
    }
  });

  it('les réponses sont mélangées par le serveur (la bonne n\'est pas toujours à l\'index 0)', () => {
    const env = makeEnv();
    const idx = new Set();
    const { host } = started(env, 2, { themes: ['geo', 'sci'], levels: ['facile'], n: 30, time: 10 });
    for (let k = 0; k < 20; k++) {
      idx.add(good(host.room()));
      env.advance(10_000 + 4000);
    }
    expect(idx.size).toBeGreaterThan(1);
  });

  it('missed : uniquement les erreurs du destinataire', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3, { themes: ['geo'], levels: ['facile'], n: 5, time: 10 });
    const texts = [];
    for (let k = 0; k < 5; k++) {
      const g = good(host.room());
      texts.push(host.room().q.text);
      host.send({ t: 'answer', qi: k, i: g }); // l'hôte a tout juste
      others[0].send({ t: 'answer', qi: k, i: (g + 1) % 4 }); // J1 a tout faux
      if (k === 0) others[1].send({ t: 'answer', qi: k, i: (g + 2) % 4 }); // J2 faux une fois, puis rien
      if (host.room().phase === 'question') env.advance(10_000);
      env.advance(4000);
    }
    expect(host.room().missed).toEqual([]);
    expect(others[0].room().missed.map((x) => x.q)).toEqual(texts);
    expect(others[1].room().missed).toHaveLength(5);
    expect(others[1].room().missed[0].mine).not.toBeNull();
    expect(others[1].room().missed[1].mine).toBeNull();
    // le message final de l'hôte ne contient aucune erreur des autres
    const hostFinal = JSON.stringify(host.room());
    expect(hostFinal).not.toContain('"mine"');
  });
});

describe('déconnexion, reprise, transfert d\'hôte', () => {
  it('resume : mêmes pid, scores conservés ; token faux refusé', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    const g = good(host.room());
    others[0].send({ t: 'answer', qi: 0, i: g });
    const b = others[0];
    b.drop();
    expect(host.room().players[1].connected).toBe(false);
    const nb = client(env, '10.0.0.1');
    nb.send({ t: 'resume', code: b.code.toLowerCase(), pid: b.pid, token: 'faux' });
    expect(nb.err().code).toBe('not_found');
    nb.send({ t: 'resume', code: b.code, pid: b.pid, token: b.token.replace(/./, (c) => (c === 'a' ? 'b' : 'a')) });
    expect(nb.err().code).toBe('not_found');
    nb.send({ t: 'resume', code: b.code, pid: 'inconnu', token: b.token });
    expect(nb.err().code).toBe('not_found');
    nb.send({ t: 'resume', code: b.code, pid: b.pid, token: b.token });
    expect(nb.last('joined')).toMatchObject({ code: b.code, pid: b.pid, token: b.token });
    const r = nb.room();
    expect(r.you).toBe(b.pid);
    expect(r.phase).toBe('question');
    expect(r.players[1]).toMatchObject({ connected: true, answered: true });
    expect(host.room().players[1].connected).toBe(true);
    // il peut répondre à la suite normalement
    env.advance(10_000);
    expect(nb.room().phase).toBe('reveal');
  });

  it('resume sur une session déjà connectée : l\'ancienne est évincée', () => {
    const env = makeEnv();
    const h = create(env);
    const b = join(env, h.code, 'Bob');
    let kicked = false;
    b.sess.kick = () => { kicked = true; };
    const nb = client(env, '1.9.9.9');
    nb.send({ t: 'resume', code: h.code, pid: b.pid, token: b.token });
    expect(kicked).toBe(true);
    expect(nb.room().you).toBe(b.pid);
    b.drop(); // la fermeture tardive de l'ancien socket ne déconnecte pas le joueur
    expect(h.room().players[1].connected).toBe(true);
  });

  it('l\'hôte part : l\'hôte passe au suivant connecté, et reste après sa reprise', () => {
    const env = makeEnv();
    const h = create(env);
    const b = join(env, h.code, 'Bob', '1.1.1.2');
    const c = join(env, h.code, 'Cy', '1.1.1.3');
    b.drop();
    expect(c.room().host).toBe(h.pid);
    h.drop();
    expect(c.room().host).toBe(c.pid);
    c.send({ t: 'settings', settings: { n: 6 } });
    expect(c.room().settings.n).toBe(6);
    const nh = client(env, '1.1.1.9');
    nh.send({ t: 'resume', code: h.code, pid: h.pid, token: h.token });
    expect(nh.room().host).toBe(h.pid); // l'hôte d'origine est rendu
    nh.send({ t: 'start' });
    expect(nh.room().phase).toBe('question');
  });

  it('leave en lobby : le joueur disparaît ; hôte transféré ; room supprimée quand vide', () => {
    const env = makeEnv();
    const h = create(env);
    const b = join(env, h.code, 'Bob');
    h.send({ t: 'leave' });
    expect(b.room().players.map((p) => p.name)).toEqual(['Bob']);
    expect(b.room().host).toBe(b.pid);
    // un joueur parti ne peut plus reprendre
    const x = client(env, '2.2.2.2');
    x.send({ t: 'resume', code: h.code, pid: h.pid, token: h.token });
    expect(x.err().code).toBe('not_found');
    b.send({ t: 'leave' });
    expect(env.mgr.rooms.size).toBe(0);
  });

  it('leave en partie : le joueur reste au tableau, sans reprise possible', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    others[0].send({ t: 'leave' });
    expect(host.room().players).toHaveLength(3);
    expect(host.room().players[1].connected).toBe(false);
    const x = client(env, '2.2.2.2');
    x.send({ t: 'resume', code: host.code, pid: others[0].pid, token: others[0].token });
    expect(x.err().code).toBe('not_found');
  });
});

describe('expiration', () => {
  it('room sans joueur connecté supprimée après 5 min, avec closed', () => {
    const env = makeEnv();
    const { host: h, others: [b] } = started(env, 2);
    h.drop();
    env.advance(4 * 60_000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(1);
    b.drop();
    env.advance(4 * 60_000 + 59_000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(1);
    env.advance(1000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(0);
    const x = client(env, '3.3.3.3');
    x.send({ t: 'resume', code: h.code, pid: h.pid, token: h.token });
    expect(x.err().code).toBe('not_found');
  });

  it('une reprise avant 5 min remet le compteur à zéro', () => {
    const env = makeEnv();
    const h = create(env);
    h.drop();
    env.advance(4 * 60_000);
    const nh = client(env, '1.1.1.5');
    nh.send({ t: 'resume', code: h.code, pid: h.pid, token: h.token });
    env.advance(4 * 60_000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(1);
  });

  it('room inactive 45 min supprimée et joueurs prévenus (closed) ; l\'activité prolonge', () => {
    const env = makeEnv();
    const { host: h, others: [b] } = started(env, 2, { themes: ['geo'], levels: ['facile'], n: 30, time: 30 });
    env.advance(40 * 60_000);
    b.send({ t: 'ping' }); // un ping n'est pas une activité de room
    h.send({ t: 'profile', name: 'Host2', avatar: 'a1' });
    env.advance(44 * 60_000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(1);
    env.advance(60_000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(0);
    expect(h.last().t).toBe('closed');
    expect(b.last().t).toBe('closed');
  });

  it('shutdown ferme tout et libère les timers', () => {
    const env = makeEnv();
    const { host, others } = started(env);
    expect(env.timers.size).toBe(1);
    env.mgr.shutdown();
    expect(env.timers.size).toBe(0);
    expect(host.last().t).toBe('closed');
    expect(env.mgr.rooms.size).toBe(0);
  });
});

describe('bank.js', () => {
  it('dossier inexistant : banque vide', () => {
    const b = loadBank('/nonexistent/bank-dir');
    expect(b.empty).toBe(true);
    expect(b.themes).toEqual([]);
    expect(b.pool(['x'], ['y'])).toEqual([]);
  });

  it('charge <theme>/<niveau>.json, ignore les entrées invalides', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdbank-'));
    try {
      fs.mkdirSync(path.join(dir, 'histoire'));
      fs.writeFileSync(path.join(dir, 'histoire', 'facile.json'), JSON.stringify([
        { q: 'ok ?', a: ['1', '2', '3', '4'], c: 2 },
        { q: 'mauvais c', a: ['1', '2', '3', '4'], c: 4 },
        { q: 'trois', a: ['1', '2', '3'], c: 0 },
        { q: 'doublons', a: ['1', '1', '3', '4'], c: 0 },
      ]));
      fs.writeFileSync(path.join(dir, 'histoire', 'cassé.json'), '{');
      fs.writeFileSync(path.join(dir, 'histoire', 'moyen.json'), '{"pas":"un tableau"}');
      fs.mkdirSync(path.join(dir, 'vide'));
      fs.writeFileSync(path.join(dir, 'fichier.txt'), 'x');
      const b = loadBank(dir);
      expect(b.themes).toEqual(['histoire']);
      expect(b.levels).toEqual(['facile']);
      expect(b.size).toBe(1);
      expect(b.pool(['histoire', '__proto__'], ['facile', 'constructor'])).toEqual([{ q: 'ok ?', a: ['1', '2', '3', '4'], c: 2, theme: 'histoire', level: 'facile' }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pool sans doublon de texte entre couples', () => {
    const q = makeQuestions('dup', 3);
    const b = makeBank({ a: { facile: q }, b: { facile: q } });
    expect(b.pool(['a', 'b'], ['facile'])).toHaveLength(3);
  });
});

describe('revue : fantômes, hôte, limites', () => {
  const play = (env, all) => { for (let k = 0; k < 5; k++) { for (const c of all) c.send({ t: 'answer', qi: k, i: 0 }); env.advance(4000); } };

  it('again retire les joueurs partis en cours de partie (pas de fantôme ni de place prise)', () => {
    const env = makeEnv();
    const { host, others } = started(env, 3);
    others[0].send({ t: 'leave' });
    play(env, [host, others[1]]);
    expect(host.room().phase).toBe('final');
    expect(host.room().players).toHaveLength(3);
    host.send({ t: 'again' });
    expect(host.room().phase).toBe('lobby');
    expect(host.room().players.map((p) => p.id)).toEqual([host.pid, others[1].pid]);
  });

  it('places max : les fantômes ne comptent plus dans la limite', () => {
    const env = makeEnv();
    const { host, others } = started(env, 8);
    for (const o of others.slice(0, 3)) o.send({ t: 'leave' });
    play(env, [host, ...others.slice(3)]);
    host.send({ t: 'again' });
    const j = join(env, host.code, 'Neuf', '10.0.9.9');
    expect(j.last('joined')).not.toBeNull();
    expect(host.room().players).toHaveLength(6);
  });

  it('au salon, un joueur déconnecté depuis plus de 60 s est retiré, un retour rapide est conservé', () => {
    const env = makeEnv();
    const host = create(env, 'H', '5.0.0.1');
    const a = join(env, host.code, 'A', '5.0.0.2');
    const b = join(env, host.code, 'B', '5.0.0.3');
    a.drop(); b.drop();
    env.advance(30000);
    const nb = client(env, '5.0.0.3');
    nb.send({ t: 'resume', code: b.code, pid: b.pid, token: b.token });
    env.advance(40000);
    env.mgr.sweep();
    expect(host.room().players.map((p) => p.name)).toEqual(['H', 'B']);
  });

  it('resume avec une room disparue : not_found', () => {
    const env = makeEnv();
    const h = create(env, 'H', '6.0.0.1');
    env.mgr.dropRoom(env.mgr.rooms.get(h.code), true);
    const n = client(env, '6.0.0.2');
    n.send({ t: 'resume', code: h.code, pid: h.pid, token: h.token });
    expect(n.err().code).toBe('not_found');
  });

  it('hôte rendu au retour après une coupure brève', () => {
    const env = makeEnv();
    const host = create(env, 'H', '7.0.0.1');
    const a = join(env, host.code, 'A', '7.0.0.2');
    host.drop();
    expect(a.room().host).toBe(a.pid);
    const nh = client(env, '7.0.0.1');
    nh.send({ t: 'resume', code: host.code, pid: host.pid, token: host.token });
    expect(nh.room().host).toBe(host.pid);
    expect(a.room().host).toBe(host.pid);
  });

  it("hôte parti pour de bon : pas rendu", () => {
    const env = makeEnv();
    const host = create(env, 'H', '7.1.0.1');
    const a = join(env, host.code, 'A', '7.1.0.2');
    host.send({ t: 'leave' });
    expect(a.room().host).toBe(a.pid);
    expect(env.mgr.rooms.get(host.code).origHost).toBeNull();
  });

  it('réponse d\'une question périmée : ignorée sans erreur', () => {
    const env = makeEnv();
    const { host } = started(env, 2);
    host.clear();
    host.send({ t: 'answer', qi: 99, i: 0 });
    expect(host.err()).toBeNull();
    host.send({ t: 'answer', qi: 0, i: 9 });
    expect(host.err().code).toBe('bad');
  });

  it('rate limit : après 5 dépassements la socket est fermée', () => {
    const env = makeEnv();
    const c = client(env, '8.0.0.1');
    let dropped = 0;
    c.sess.drop = () => { dropped++; };
    for (let k = 0; k < 24; k++) c.send({ t: 'ping' });
    expect(dropped).toBe(0);
    for (let k = 0; k < 10; k++) c.send({ t: 'ping' });
    expect(dropped).toBeGreaterThan(0);
  });

  it('un salon inactif expire plus vite qu\'une partie', () => {
    const env = makeEnv();
    const h = create(env, 'H', '9.0.0.1');
    join(env, h.code, 'A', '9.0.0.2');
    env.advance(16 * 60 * 1000);
    env.mgr.sweep();
    expect(env.mgr.rooms.size).toBe(0);
  });
});
