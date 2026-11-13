(() => {
'use strict';

const ROUNDS = 10, TIME = 15, BASE = 100, BONUS = 50, FEEDBACK_MS = 1400;
const app = document.getElementById('app');
const soundBtn = document.getElementById('sound');
let themes = [];
let timerId = null, advanceId = null, keyHandler = null;

/* ---------- utilitaires ---------- */
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stop = () => { clearInterval(timerId); clearTimeout(advanceId); if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
/* formes pleines A carré, B rond, C triangle, D losange (lettre + forme + couleur : jamais la couleur seule) */
const SHAPES = ['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="12" cy="12" r="10"/>', '<path d="M12 2 23 21H1z"/>', '<path d="M12 1 23 12 12 23 1 12z"/>'];
const shape = (i) => `<svg class="shape" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SHAPES[i % 4]}</svg>`;
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6"/></svg>';
const ICON_KO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>';
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('') || '?';
const jeton = (name, i, big) => `<span class="jeton j${i % 4}${big ? ' big' : ''}" aria-hidden="true">${esc(initials(name))}</span>`;
const KEY = 'quizdown.best.v1';
const loadBest = () => {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (Number.isFinite(v) && v > 0) out[k] = Math.min(Math.floor(v), 100000);
  } catch {}
  return out;
};
const saveBest = (id, score) => {
  const b = loadBest(); const isNew = score > (b[id] || 0);
  if (isNew) { b[id] = score; try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {} }
  return isNew;
};

function show(node, focusSel) {
  stop();
  app.replaceChildren(node);
  const f = (focusSel && node.querySelector(focusSel)) || node.querySelector('h1,h2');
  if (f) { if (!f.matches('button,input')) f.tabIndex = -1; f.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

/* ---------- sons (WebAudio, sans fichier) ---------- */
let soundOn = true;
try { soundOn = localStorage.getItem('quizdown.sound') !== 'off'; } catch {}
let ctx = null;
function refreshSound() { soundBtn.textContent = 'Son : ' + (soundOn ? 'oui' : 'non'); soundBtn.setAttribute('aria-pressed', soundOn); }
soundBtn.onclick = () => { soundOn = !soundOn; try { localStorage.setItem('quizdown.sound', soundOn ? 'on' : 'off'); } catch {} refreshSound(); beep('ok'); };
function beep(kind) {
  if (!soundOn) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { ok: [660, 880], ko: [220, 160], end: [523, 659, 784] }[kind];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.12;
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}

/* ---------- données : on ne fait confiance à aucun champ du JSON ---------- */
const isStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
function validThemes(d) {
  if (!d || !Array.isArray(d.themes)) return [];
  return d.themes.map((t) => {
    if (!t || !isStr(t.id, 40) || !/^[a-z0-9-]+$/.test(t.id) || !isStr(t.name, 60) || !Array.isArray(t.questions)) return null;
    const questions = t.questions.filter((q) => q && isStr(q.q, 300) && Array.isArray(q.a) && q.a.length === 4 && q.a.every((x) => isStr(x, 120)) && Number.isInteger(q.c) && q.c >= 0 && q.c < 4);
    return questions.length >= 1 ? { id: t.id, name: t.name, questions } : null;
  }).filter(Boolean);
}

/* ---------- écrans ---------- */
function home() {
  const best = loadBest();
  const lines = themes.filter((t) => best[t.id]).map((t) => `${esc(t.name)} : ${best[t.id]} pts`);
  show(el(`<section class="plate">
    <h1 class="logo">Quiz<span>Down</span></h1>
    <p class="tag">${ROUNDS} questions, ${TIME} secondes chacune. Répondez vite, répondez juste.</p>
    <div class="stack">
      <button class="btn primary big-btn" data-mode="solo">Jouer solo<small>Battez votre record, gardé sur cet appareil</small></button>
      <button class="btn alt big-btn" data-mode="multi">Jouer à plusieurs<small>2 à 4 joueurs, chacun son tour sur le même téléphone</small></button>
    </div>
    ${lines.length ? `<div class="card best"><strong>Vos records</strong>${lines.join('<br>')}</div>` : ''}
  </section>`), '.primary');
  app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => b.dataset.mode === 'solo' ? pickTheme((t) => startGame(t, ['Vous'])) : setupMulti());
}

function pickTheme(next) {
  const best = loadBest();
  const n = el(`<section>
    <h2>Choisissez un paquet</h2>
    <div class="deck">${themes.map((t, i) => `<button class="btn" data-id="${esc(t.id)}">${esc(t.name)}${shape(i)}<small>${t.questions.length} questions${best[t.id] ? ' · record ' + best[t.id] + ' pts' : ''}</small></button>`).join('')}</div>
    <p class="after"><button class="btn inline" id="back">Retour</button></p>
  </section>`);
  show(n, '.btn');
  n.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => next(themes.find((t) => t.id === b.dataset.id)));
  n.querySelector('#back').onclick = home;
}

function setupMulti() {
  let count = 2;
  const n = el(`<section class="card">
    <h2>Joueurs</h2>
    <form class="stack" novalidate>
      <div><label id="cl">Nombre de joueurs</label>
        <div class="seg" role="group" aria-labelledby="cl">${[2,3,4].map((c) => `<button type="button" class="btn" data-n="${c}">${c}</button>`).join('')}</div></div>
      <div class="stack" id="names"></div>
      <button class="btn primary" type="submit">Choisir le thème</button>
      <button class="btn" type="button" id="back">Retour</button>
    </form></section>`);
  const names = n.querySelector('#names');
  const draw = () => {
    n.querySelectorAll('[data-n]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.n === count));
    const old = [...names.querySelectorAll('input')].map((i) => i.value);
    names.innerHTML = Array.from({ length: count }, (_, i) => `<div><label for="p${i}">Joueur ${i + 1}</label><input type="text" id="p${i}" maxlength="16" autocomplete="off" value="${esc(old[i] || '')}"></div>`).join('');
  };
  n.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { count = +b.dataset.n; draw(); });
  draw(); show(n, '#p0');
  n.querySelector('#back').onclick = home;
  n.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const list = [...names.querySelectorAll('input')].map((i, k) => i.value.trim() || `Joueur ${k + 1}`);
    pickTheme((t) => startGame(t, list));
  };
}

/* ---------- partie (solo = 1 joueur) ---------- */
function startGame(theme, players) {
  const qs = shuffle(theme.questions).slice(0, ROUNDS).map((q) => {
    const answers = shuffle(q.a.map((text, i) => ({ text, ok: i === q.c })));
    return { q: q.q, answers };
  });
  const g = { theme, players: players.map((name) => ({ name, score: 0, good: 0, missed: [] })), qs, qi: 0, pi: 0 };
  if (players.length > 1) handover(g); else ask(g);
}

function handover(g) {
  const p = g.players[g.pi];
  const n = el(`<section class="card">
    <p class="kicker">Question ${g.qi + 1} sur ${g.qs.length}</p>
    <h2>À toi,</h2>
    <p class="who">${jeton(p.name, g.pi, true)}<span>${esc(p.name)}</span></p>
    <p>Passez le téléphone, puis appuyez quand vous êtes prêt.</p>
    <button class="btn primary" id="go">Je suis prêt</button></section>`);
  show(n, '#go');
  n.querySelector('#go').onclick = () => ask(g);
}

function ask(g) {
  const q = g.qs[g.qi], p = g.players[g.pi], multi = g.players.length > 1;
  const n = el(`<section>
    <div class="hud"><span>${multi ? esc(p.name) + ' · ' : ''}Question ${g.qi + 1}/${g.qs.length}</span><span>Score <strong id="sc">${p.score}</strong></span></div>
    <div class="timer"><div class="rail" id="tm" role="progressbar" aria-valuemin="0" aria-valuemax="${TIME}" aria-valuenow="${TIME}" aria-label="Temps restant en secondes"><i></i></div><span class="secs" id="secs" aria-hidden="true"></span></div>
    <div class="qcard"><p class="kicker">${esc(g.theme.name)}</p><h2 class="question">${esc(q.q)}</h2></div>
    <div class="answers" role="group" aria-label="Réponses">${q.answers.map((a, i) => `<button class="btn ans a${i}" data-i="${i}"><span class="key">${'ABCD'[i]}</span><span>${esc(a.text)}</span>${shape(i)}</button>`).join('')}</div>
    <p class="fb" id="fb"></p>
    <button class="btn primary inline" id="next" hidden></button>
  </section>`);
  show(n, '.question');
  const btns = [...n.querySelectorAll('[data-i]')];
  const bar = n.querySelector('#tm'), fill = bar.firstElementChild, secs = n.querySelector('#secs'), fb = n.querySelector('#fb'), nextBtn = n.querySelector('#next');
  const t0 = performance.now();
  let done = false;

  const finish = (idx) => {
    if (done) return; done = true;
    stop();
    const left = Math.max(0, TIME - (performance.now() - t0) / 1000);
    const right = idx >= 0 && q.answers[idx].ok;
    const gain = right ? BASE + Math.round(BONUS * left / TIME) : 0;
    p.score += gain; if (right) p.good++; else p.missed.push({ q: q.q, a: q.answers.find((x) => x.ok).text });
    btns.forEach((b) => { b.disabled = true; });
    // en multi, la bonne réponse n'est révélée qu'au dernier joueur de la question
    if (!multi || g.pi === g.players.length - 1) {
      btns.forEach((b, i) => {
        if (q.answers[i].ok) { b.classList.add('ok'); b.insertAdjacentHTML('beforeend', `<span class="verdict">${ICON_OK}Juste</span>`); }
        else if (i === idx) { b.classList.add('ko'); b.insertAdjacentHTML('beforeend', `<span class="verdict">${ICON_KO}Faux</span>`); }
      });
      n.querySelector('#sc').textContent = p.score;
      const good = q.answers.find((x) => x.ok).text;
      fb.textContent = right ? `Bien vu ! +${gain} points` : idx < 0 ? `Temps écoulé, c'était : ${good}.` : `Raté, c'était : ${good}.`;
      beep(right ? 'ok' : 'ko');
    } else {
      fb.textContent = idx < 0 ? 'Temps écoulé. Réponse enregistrée.' : 'Réponse enregistrée.';
    }
    const last = g.pi === g.players.length - 1 && g.qi === g.qs.length - 1;
    nextBtn.textContent = last ? 'Voir les résultats' : 'Suite'; nextBtn.hidden = false; nextBtn.focus();
    const go = () => { if (++g.pi >= g.players.length) { g.pi = 0; g.qi++; } g.qi >= g.qs.length ? results(g) : g.players.length > 1 ? handover(g) : ask(g); };
    nextBtn.onclick = go;
    if (g.players.length === 1) advanceId = setTimeout(go, FEEDBACK_MS + 600);
  };
  const onKey = (e) => {
    const i = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[e.key.toLowerCase()];
    if (i !== undefined && !e.ctrlKey && !e.metaKey && !e.altKey) finish(i);
  };
  keyHandler = onKey; document.addEventListener('keydown', onKey);
  btns.forEach((b, i) => b.onclick = () => finish(i));
  timerId = setInterval(() => {
    const left = TIME - (performance.now() - t0) / 1000;
    // mouvement réduit : le sablier se vide par paliers d'une seconde
    const shown = reduced.matches ? Math.ceil(Math.max(0, left)) : Math.max(0, left);
    fill.style.width = shown / TIME * 100 + '%';
    secs.textContent = left <= 5 ? Math.ceil(Math.max(0, left)) : '';
    bar.setAttribute('aria-valuenow', Math.ceil(Math.max(0, left)));
    if (left <= 0) finish(-1);
  }, 100);
}

function results(g) {
  beep('end');
  const multi = g.players.length > 1;
  let body;
  if (!multi) {
    const p = g.players[0], isNew = saveBest(g.theme.id, p.score), best = loadBest()[g.theme.id];
    body = `<p class="kicker">${esc(g.theme.name)}</p><h2>Résultats</h2>
      <p class="big">${p.score} <span class="unit">pts</span></p>
      <p>${p.good} bonne${p.good > 1 ? 's' : ''} réponse${p.good > 1 ? 's' : ''} sur ${g.qs.length}.</p>
      <p class="best">${isNew && p.score > 0 ? '<strong>Nouveau record !</strong>' : 'Record sur ce thème : <strong>' + (best || 0) + ' pts</strong>'}</p>
      ${p.missed.length ? `<h3 class="kicker after">Les bonnes réponses</h3><ul class="missed">${p.missed.map((m) => `<li>${esc(m.q)}<br><strong>${esc(m.a)}</strong></li>`).join('')}</ul>` : ''}`;
  } else {
    const rank = g.players.slice().sort((a, b) => b.score - a.score || b.good - a.good);
    const top = rank[0], tie = rank.filter((p) => p.score === top.score && p.good === top.good).length > 1;
    body = `<p class="kicker">${esc(g.theme.name)}</p><h2>${tie ? 'Égalité !' : esc(top.name) + ' gagne !'}</h2>
      <table><thead><tr><th>#</th><th>Joueur</th><th>Bonnes rép.</th><th>Score</th></tr></thead><tbody>
      ${rank.map((p, i) => `<tr class="${p.score === top.score && p.good === top.good ? 'win' : ''}"><td>${i + 1}</td><td><span class="player">${jeton(p.name, g.players.indexOf(p))}${esc(p.name)}</span></td><td>${p.good}/${g.qs.length}</td><td>${p.score}</td></tr>`).join('')}</tbody></table>`;
  }
  const n = el(`<section class="card">${body}<div class="stack"><button class="btn primary" id="again">Rejouer</button><button class="btn" id="menu">Changer de thème</button></div></section>`);
  show(n, 'h2');
  n.querySelector('#again').onclick = () => startGame(g.theme, g.players.map((p) => p.name));
  n.querySelector('#menu').onclick = () => pickTheme((t) => startGame(t, g.players.map((p) => p.name)));
}

/* ---------- démarrage ---------- */
document.getElementById('home').onclick = () => themes.length && home();
refreshSound();
fetch('data/questions.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => { themes = validThemes(d); if (!themes.length) throw new Error('data'); home(); })
  .catch(() => show(el('<section class="card"><h2>Impossible de charger les questions</h2><p>Lancez le jeu depuis un serveur web (voir le README), pas en ouvrant le fichier directement.</p></section>')));
})();
