(() => {
'use strict';

const ROUNDS = 10, TIME = 15, BASE = 100, BONUS = 50, AUTO_NEXT_MS = 2000, LEAVE_MS = 200;
const app = document.getElementById('app');
const soundBtn = document.getElementById('sound');
let themes = [];
let timerId = null, advanceId = null, keyHandler = null;
// Échap : action « Retour » de l'écran courant ; quitHook = partie en cours (pause / reprise pendant la confirmation)
let backAction = null, quitHook = null;

/* ---------- utilitaires ---------- */
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stop = () => { clearInterval(timerId); clearTimeout(advanceId); if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
/* formes pleines A carré, B rond, C triangle, D losange (lettre + forme + couleur : jamais la couleur seule) */
const SHAPES = ['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="12" cy="12" r="10"/>', '<path d="M12 2 23 21H1z"/>', '<path d="M12 1 23 12 12 23 1 12z"/>'];
const shape = (i, cls = 'shape') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SHAPES[i % 4]}</svg>`;
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6"/></svg>';
const ICON_KO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path class="off" d="m16 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('') || '?';
const jeton = (name, i, size = '') => `<span class="jeton j${i % 4} ${size}" aria-hidden="true">${esc(initials(name))}</span>`;
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
  backAction = null; quitHook = null;
  app.replaceChildren(node);
  const f = (focusSel && node.querySelector(focusSel)) || node.querySelector('h1,h2');
  if (f) { if (!f.matches('button,input')) f.tabIndex = -1; f.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

/* la carte sort par la gauche avant l'écran suivant (même axe que l'entrée) */
function leave(node, next) {
  stop();
  // pendant la sortie, ni Échap ni pause : rien ne doit annuler le minuteur qui affiche l'écran suivant
  backAction = null; quitHook = null;
  if (reduced.matches) return next();
  node.classList.add('sortie');
  advanceId = setTimeout(next, LEAVE_MS);
}

/* le score compte jusqu'à sa nouvelle valeur en 400 ms (direct en mouvement réduit) */
function countUp(out, from, to, ms = 400) {
  if (reduced.matches || from === to) { out.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    out.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1 && out.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- son et vibration (WebAudio, sans fichier) ---------- */
let soundOn = true;
try { soundOn = localStorage.getItem('quizdown.sound') !== 'off'; } catch {}
let ctx = null;
function refreshSound() {
  soundBtn.innerHTML = `${ICON_SOUND}<span>Son ${soundOn ? 'oui' : 'non'}</span>`;
  soundBtn.setAttribute('aria-pressed', soundOn);
}
soundBtn.onclick = () => { soundOn = !soundOn; try { localStorage.setItem('quizdown.sound', soundOn ? 'on' : 'off'); } catch {} refreshSound(); beep('ok'); };
function beep(kind) {
  if (!soundOn) return;
  try { if (kind === 'ko' && navigator.vibrate) navigator.vibrate([40, 40, 40]); } catch {}
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

/* ---------- accueil ---------- */
function home() {
  const best = loadBest();
  const records = themes.filter((t) => best[t.id]);
  const n = el(`<section class="accueil">
    <h1 class="logo">Quiz<span>Down</span></h1>
    <p class="tag">${ROUNDS} questions, ${TIME} secondes chacune. Répondez vite, répondez juste.</p>
    <div class="modes">
      <button class="btn mode primary" type="button" data-mode="solo">${shape(0, 'shape mode-shape')}<span class="mode-title">Jouer solo</span><small>Battez votre record, gardé sur cet appareil</small></button>
      <button class="btn mode alt" type="button" data-mode="multi">${shape(1, 'shape mode-shape')}<span class="mode-title">Jouer à plusieurs</span><small>2 à 4 joueurs, chacun son tour sur le même téléphone</small></button>
    </div>
    <div class="card regles">
      <h2 class="etiquette">Comment jouer</h2>
      <ol class="etapes">
        <li>${shape(0, 'shape puce p0')}<span>Choisissez un paquet de questions.</span></li>
        <li>${shape(1, 'shape puce p1')}<span>Touchez la bonne réponse avant la fin du sablier. Au clavier : <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd>.</span></li>
        <li>${shape(2, 'shape puce p2')}<span>Juste = ${BASE} points, plus jusqu'à ${BONUS} de bonus si vous êtes rapide.</span></li>
      </ol>
    </div>
    ${records.length ? `<div class="card records"><h2 class="etiquette">Vos records</h2><ul>${records.map((t) => `<li><span>${esc(t.name)}</span><strong>${best[t.id]} pts</strong></li>`).join('')}</ul></div>` : ''}
  </section>`);
  show(n);
  n.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => b.dataset.mode === 'solo' ? pickTheme((t) => startGame(t, ['Vous'])) : pickTheme((t) => setupMulti(t)));
}

/* ---------- choix du paquet : des cartes en éventail, chacune sa couleur et sa forme ---------- */
function pickTheme(next, back = home) {
  const best = loadBest();
  const n = el(`<section>
    <h2>Choisissez un paquet</h2>
    <p class="sous">${ROUNDS} questions tirées au hasard dans le paquet.</p>
    <div class="deck">${themes.map((t, i) => `<button class="btn paquet k${i % 5}" type="button" data-id="${esc(t.id)}">
      ${shape(i, 'shape paquet-shape')}
      <span class="paquet-nom">${esc(t.name)}</span>
      <small>${t.questions.length} questions${best[t.id] ? `<br>Record : ${best[t.id]} pts` : ''}</small>
    </button>`).join('')}</div>
    <p class="after"><button class="btn court back-btn" type="button" id="back">${ICON_BACK}Retour</button></p>
  </section>`);
  show(n);
  n.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => next(themes.find((t) => t.id === b.dataset.id)));
  n.querySelector('#back').onclick = back; backAction = back;
}

/* ---------- multijoueur : nombre et prénoms (après le choix du paquet) ---------- */
const NAME_MAX = 12;
function setupMulti(theme, prev = []) {
  let count = Math.max(2, prev.length);
  const n = el(`<section class="card">
    <p class="etiquette">${esc(theme.name)}</p>
    <h2>Qui joue ?</h2>
    <form class="stack" novalidate>
      <div><p class="etiquette" id="cl">Nombre de joueurs</p>
        <div class="seg" role="group" aria-labelledby="cl">${[2,3,4].map((c) => `<button type="button" class="btn" data-n="${c}">${c}</button>`).join('')}</div></div>
      <div class="stack" id="names"></div>
      <p class="raison" id="raison" aria-live="polite"></p>
      <button class="btn primary" type="submit" id="go" data-main aria-describedby="raison">C'est parti</button>
      <button class="btn back-btn" type="button" id="back">${ICON_BACK}Changer de paquet</button>
    </form></section>`);
  const names = n.querySelector('#names'), go = n.querySelector('#go'), raison = n.querySelector('#raison');
  const values = () => [...names.querySelectorAll('input')].map((i) => i.value.trim());
  // prénoms vides ou en double : « C'est parti » reste désactivé, la raison est écrite sous les champs
  const check = () => {
    const v = values(), low = v.map((x) => x.toLocaleLowerCase('fr'));
    const empty = v.findIndex((x) => !x), dup = low.findIndex((x, i) => x && low.indexOf(x) !== i);
    raison.textContent = empty >= 0 ? `Donnez un prénom au joueur ${empty + 1}.` : dup >= 0 ? `Deux joueurs s'appellent « ${v[dup]} » : changez l'un des deux prénoms.` : '';
    go.disabled = !!raison.textContent;
    names.querySelectorAll('input').forEach((inp, i) => inp.setAttribute('aria-invalid', i === empty || (dup >= 0 && low[i] === low[dup])));
  };
  const draw = () => {
    n.querySelectorAll('[data-n]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.n === count));
    const old = values();
    names.innerHTML = Array.from({ length: count }, (_, i) => {
      const v = old[i] ?? prev[i] ?? `Joueur ${i + 1}`;
      return `<div><label for="p${i}">Joueur ${i + 1}</label>
      <div class="nom">${jeton(v || `Joueur ${i + 1}`, i)}<input type="text" id="p${i}" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" value="${esc(v)}"></div></div>`;
    }).join('');
    names.querySelectorAll('input').forEach((inp, i) => inp.oninput = () => { inp.previousElementSibling.textContent = initials(inp.value.trim() || `Joueur ${i + 1}`); check(); });
    check();
  };
  n.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { count = +b.dataset.n; draw(); });
  draw(); show(n);
  const back = () => pickTheme((t) => setupMulti(t, values()));
  n.querySelector('#back').onclick = back; backAction = back;
  n.querySelector('form').onsubmit = (e) => {
    e.preventDefault(); check();
    if (!go.disabled) startGame(theme, values());
  };
}

/* ---------- quitter une partie : confirmation (dialog natif, « Continuer » a le focus) ---------- */
function confirmQuit() {
  if (document.querySelector('dialog[open]')) return;
  const hook = quitHook;
  hook?.pause?.();
  const d = el(`<dialog class="confirm" aria-labelledby="qt" aria-describedby="qd">
    <h2 id="qt">Quitter la partie ?</h2>
    <p id="qd">Le score sera perdu.</p>
    <div class="confirm-actions"><button class="btn danger" type="button" data-q="quit">Quitter</button><button class="btn primary" type="button" data-q="stay" autofocus>Continuer</button></div>
  </dialog>`);
  document.body.append(d);
  const close = (quit) => { d.close(); d.remove(); if (quit) home(); else hook?.resume?.(); };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
  d.querySelector('[data-q=quit]').onclick = () => close(true);
  d.querySelector('[data-q=stay]').onclick = () => close(false);
  d.showModal();
  d.querySelector('[data-q=stay]').focus();
}

/* bandeau de partie : Retour, paquet, numéro, score ; en multi les jetons, celui du tour agrandi */
const bandeau = (g, score) => `<div class="hud">
  <button class="hud-back" type="button" id="quit" aria-label="Quitter la partie">${ICON_BACK}</button>
  <p class="hud-theme">${esc(g.theme.name)}</p>
  ${g.players.length > 1 ? `<ul class="hud-jetons">${g.players.map((o, i) => `<li class="${i === g.pi ? 'tour' : ''}">${jeton(o.name, i, i === g.pi ? '' : 'small')}<span class="sr-only">${esc(o.name)}${i === g.pi ? ', à son tour' : ''}</span></li>`).join('')}</ul>` : ''}
  <p class="hud-box"><span class="sr-only">Question </span>${g.qi + 1}/${g.qs.length}</p>
  <p class="hud-box hud-score"><span class="sr-only">Score </span><strong id="sc">${score}</strong></p>
</div>`;

/* ---------- partie (solo = 1 joueur) ---------- */
function startGame(theme, players) {
  const qs = shuffle(theme.questions).slice(0, ROUNDS).map((q) => {
    const answers = shuffle(q.a.map((text, i) => ({ text, ok: i === q.c })));
    return { q: q.q, answers };
  });
  const g = { theme, players: players.map((name) => ({ name, score: 0, good: 0, missed: [], track: [] })), qs, qi: 0, pi: 0 };
  if (players.length > 1) handover(g); else ask(g);
}

/* progression : une case par question (coche = juste, croix = faux, case épaisse = en cours) */
const pips = (g, p) => `<ol class="pips" aria-hidden="true">${g.qs.map((_, i) => {
  const r = p.track[i];
  return `<li class="${r === true ? 'ok' : r === false ? 'ko' : i === g.qi ? 'now' : ''}">${r === true ? ICON_OK : r === false ? ICON_KO : ''}</li>`;
}).join('')}</ol>`;

function handover(g) {
  const p = g.players[g.pi];
  const others = g.players.map((o, i) => `<li class="${i === g.pi ? 'moi' : ''}">${jeton(o.name, i, 'small')}<span>${esc(o.name)}</span><strong>${o.score}</strong></li>`).join('');
  const n = el(`<section class="passe j${g.pi % 4}">
    <p class="etiquette">${esc(g.theme.name)} · Question ${g.qi + 1}/${g.qs.length}</p>
    <h2 class="who">${jeton(p.name, g.pi, 'big')}<span>À toi, ${esc(p.name)}</span></h2>
    <p>Prends le téléphone. Le sablier démarre quand tu appuies sur « Je suis prêt ».</p>
    <button class="btn primary" type="button" id="go" data-main>Je suis prêt</button>
    <div class="card scores"><h3 class="etiquette">Scores</h3><ul class="mini">${others}</ul></div>
    <p class="after"><button class="btn court back-btn" type="button" id="quit">${ICON_BACK}Quitter la partie</button></p></section>`);
  show(n);
  n.querySelector('#go').onclick = () => ask(g);
  n.querySelector('#quit').onclick = confirmQuit; backAction = confirmQuit;
}

function ask(g) {
  const q = g.qs[g.qi], p = g.players[g.pi], multi = g.players.length > 1;
  const n = el(`<section class="manche">
    ${bandeau(g, p.score)}
    ${pips(g, p)}
    <div class="timer"><div class="rail" id="tm" role="progressbar" aria-valuemin="0" aria-valuemax="${TIME}" aria-valuenow="${TIME}" aria-label="Temps restant en secondes"><i></i></div><span class="secs" id="secs" aria-hidden="true"></span><span class="sr-only" id="alerte" aria-live="assertive"></span></div>
    <div class="qcard">${multi ? `<p class="etiquette">À ${esc(p.name)} de répondre</p>` : ''}<h2 class="question">${esc(q.q)}</h2></div>
    <div class="answers" role="group" aria-label="Réponses">${q.answers.map((a, i) => `<button class="btn ans a${i}" type="button" data-i="${i}" aria-keyshortcuts="${'ABCD'[i]}"><span class="key">${'ABCD'[i]}</span><span class="ans-txt">${esc(a.text)}</span>${shape(i)}</button>`).join('')}</div>
    <div class="suite">
      <p class="fb" id="fb" role="status"></p>
      <button class="btn primary court" type="button" id="next" data-main hidden></button>
    </div>
    <p class="astuce">Clavier : <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> ou <kbd>1</kbd> à <kbd>4</kbd></p>
  </section>`);
  show(n, '.question');
  n.querySelector('#quit').onclick = confirmQuit; backAction = confirmQuit;
  const btns = [...n.querySelectorAll('[data-i]')];
  const bar = n.querySelector('#tm'), fill = bar.firstElementChild, secs = n.querySelector('#secs'), fb = n.querySelector('#fb'), nextBtn = n.querySelector('#next'), sc = n.querySelector('#sc');
  let t0 = performance.now(), done = false, lastNow = TIME, warned = false;

  const finish = (idx) => {
    if (done) return; done = true;
    stop();
    const left = Math.max(0, TIME - (performance.now() - t0) / 1000);
    const right = idx >= 0 && q.answers[idx].ok;
    const gain = right ? BASE + Math.round(BONUS * left / TIME) : 0;
    const before = p.score;
    p.score += gain; p.track[g.qi] = right;
    if (right) p.good++; else p.missed.push({ q: q.q, a: q.answers.find((x) => x.ok).text, timeout: idx < 0 });
    btns.forEach((b) => { b.disabled = true; });
    if (idx >= 0) btns[idx].classList.add('choisi');
    const pip = n.querySelectorAll('.pips li')[g.qi];
    // en multi, la bonne réponse n'est révélée qu'au dernier joueur de la question
    if (!multi || g.pi === g.players.length - 1) {
      btns.forEach((b, i) => {
        if (q.answers[i].ok) { b.classList.add('ok'); b.insertAdjacentHTML('beforeend', `<span class="verdict">${ICON_OK}Juste</span>`); }
        else if (i === idx) { b.classList.add('ko'); b.insertAdjacentHTML('beforeend', `<span class="verdict">${ICON_KO}Faux</span>`); }
      });
      countUp(sc, before, p.score);
      pip.className = right ? 'ok' : 'ko'; pip.innerHTML = right ? ICON_OK : ICON_KO;
      const good = q.answers.find((x) => x.ok).text;
      fb.className = 'fb ' + (right ? 'juste' : idx < 0 ? 'temps' : 'faux');
      fb.innerHTML = right ? `${ICON_OK}<span>Juste, <strong class="gain">+${gain}</strong> points</span>`
        : `${ICON_KO}<span>${idx < 0 ? 'Temps écoulé' : 'Faux'}, la bonne réponse était <strong>${esc(good)}</strong></span>`;
      beep(right ? 'ok' : 'ko');
    } else {
      sc.textContent = p.score;
      fb.className = 'fb neutre';
      fb.textContent = idx < 0 ? 'Temps écoulé. Réponse enregistrée.' : 'Réponse enregistrée. La bonne réponse sera révélée au dernier joueur.';
    }
    const last = g.pi === g.players.length - 1 && g.qi === g.qs.length - 1;
    nextBtn.textContent = last ? 'Voir les résultats' : multi ? 'Joueur suivant' : 'Question suivante'; nextBtn.hidden = false; nextBtn.focus({ preventScroll: true });
    const go = () => leave(n, () => { if (++g.pi >= g.players.length) { g.pi = 0; g.qi++; } g.qi >= g.qs.length ? results(g) : multi ? handover(g) : ask(g); });
    nextBtn.onclick = go;
    // solo : on enchaîne seul après 2 s, « Question suivante » permet d'accélérer
    if (!multi && !last) advanceId = setTimeout(go, AUTO_NEXT_MS);
    // le Retour reste possible pendant le retour de réponse : la pause suspend l'enchaînement automatique
    quitHook = { pause: () => clearTimeout(advanceId), resume: () => { if (!multi && !last) advanceId = setTimeout(go, AUTO_NEXT_MS); } };
  };
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || done || document.querySelector('dialog[open]')) return;
    const i = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[e.key.toLowerCase()];
    if (i !== undefined) finish(i);
  };
  keyHandler = onKey; document.addEventListener('keydown', onKey);
  btns.forEach((b, i) => b.onclick = () => finish(i));
  const tick = () => {
    const left = TIME - (performance.now() - t0) / 1000, now = Math.ceil(Math.max(0, left));
    // mouvement réduit : le sablier se vide par paliers d'une seconde
    fill.style.width = (reduced.matches ? now : Math.max(0, left)) / TIME * 100 + '%';
    bar.classList.toggle('urgent', left <= 5);
    secs.textContent = left <= 5 ? now : '';
    if (now !== lastNow) { lastNow = now; bar.setAttribute('aria-valuenow', now); }
    if (left <= 5 && !warned) { warned = true; n.querySelector('#alerte').textContent = '5 secondes'; }
    if (left <= 0) finish(-1);
  };
  timerId = setInterval(tick, 100);
  // pendant la confirmation « Quitter ? », le sablier est en pause
  let pausedAt = 0;
  quitHook = {
    pause: () => { clearInterval(timerId); pausedAt = performance.now(); },
    resume: () => { if (done) return; t0 += performance.now() - pausedAt; timerId = setInterval(tick, 100); },
  };
}

/* ---------- fin de partie ---------- */
const bilan = (good, total) => good === total ? 'Sans faute. Chapeau !'
  : good >= total * 0.8 ? 'Excellent, il s\'en est fallu de peu.'
  : good >= total * 0.5 ? 'Bien joué, la moyenne est largement passée.'
  : good > 0 ? 'Ce paquet se défend. Une revanche ?'
  : 'Ce paquet résiste. On retente ?';

function results(g) {
  beep('end');
  const multi = g.players.length > 1;
  let body;
  if (!multi) {
    const p = g.players[0], isNew = saveBest(g.theme.id, p.score), best = loadBest()[g.theme.id];
    body = `<div class="fin-a"><p class="etiquette">${esc(g.theme.name)} · Résultats</p>
      <h2 class="score-geant"><span id="final">${p.score}</span> <span class="unit">pts</span></h2>
      <p class="bilan">${bilan(p.good, g.qs.length)}</p>
      <p>${plural(p.good, 'bonne réponse')} sur ${g.qs.length}.</p>
      <p class="record ${isNew && p.score > 0 ? 'nouveau' : ''}">${isNew && p.score > 0 ? `${shape(3)}<span>Nouveau record !</span>` : `<span>Record : <strong>${best || 0} pts</strong></span>`}</p></div>
      ${p.missed.length ? `<div class="fin-b"><h3 class="etiquette">À retenir</h3><ul class="missed">${p.missed.map((m) => `<li><span>${esc(m.q)}</span><strong>${esc(m.a)}</strong></li>`).join('')}</ul></div>` : ''}`;
  } else {
    const rank = g.players.slice().sort((a, b) => b.score - a.score || b.good - a.good);
    const top = rank[0], max = Math.max(1, top.score);
    const winners = rank.filter((p) => p.score === top.score && p.good === top.good);
    // rang « compétition » : les ex aequo partagent la même place
    const place = (p) => rank.findIndex((o) => o.score === p.score && o.good === p.good) + 1;
    body = `<div class="fin-a"><p class="etiquette">${esc(g.theme.name)} · Résultats</p>
      <h2>${winners.length > 1 ? 'Égalité !' : esc(top.name) + ' gagne !'}</h2>
      <p class="bilan">${winners.length > 1 ? winners.map((p) => esc(p.name)).join(' et ') + ' finissent ex aequo.' : `${plural(top.good, 'bonne réponse')} sur ${g.qs.length}, bravo.`}</p>
      <ol class="podium">${rank.map((p) => {
        const i = g.players.indexOf(p), h = 12 + Math.round(88 * p.score / max), r = place(p);
        return `<li class="${r === 1 ? 'win' : ''}">
          <span class="colonne"><span class="pile j${i % 4}" data-h="${h}">${jeton(p.name, i)}</span></span>
          <span class="place">${r === 1 ? '1er' : r + 'e'}</span><span class="podium-nom">${esc(p.name)}</span>
          <span class="podium-score">${p.score} pts</span><span class="podium-good">${p.good}/${g.qs.length}</span></li>`;
      }).join('')}</ol></div>
      <div class="fin-b"><table class="detail"><caption class="sr-only">Détail des scores</caption><thead><tr><th scope="col">Place</th><th scope="col">Joueur</th><th scope="col">Justes</th><th scope="col">Points</th></tr></thead>
      <tbody>${rank.map((p) => `<tr><td>${place(p)}</td><td>${esc(p.name)}</td><td>${p.good}/${g.qs.length}</td><td>${p.score}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const n = el(`<section class="card fin"><div class="fin-grid">${body}</div><div class="stack after fin-actions"><button class="btn primary" type="button" id="again" data-main>Rejouer</button><button class="btn" type="button" id="menu">Changer de thème</button><button class="btn" type="button" id="accueil">Accueil</button></div></section>`);
  show(n, 'h2');
  backAction = home;
  if (!multi) countUp(n.querySelector('#final'), 0, g.players[0].score, 700);
  // hauteur des colonnes via CSSOM (la CSP interdit les attributs style inline)
  n.querySelectorAll('.pile').forEach((s) => { s.style.height = s.dataset.h + '%'; });
  const names = g.players.map((p) => p.name);
  n.querySelector('#again').onclick = () => startGame(g.theme, names);
  n.querySelector('#menu').onclick = () => pickTheme((t) => multi ? setupMulti(t, names) : startGame(t, names));
  n.querySelector('#accueil').onclick = home;
}

/* ---------- clavier global : Échap = Retour, Entrée / Espace = bouton principal ---------- */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape' && backAction) { e.preventDefault(); backAction(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button,input,a,textarea,select')) {
    const main = app.querySelector('[data-main]:not([hidden]):not([disabled])');
    if (main) { e.preventDefault(); main.click(); }
  }
});

/* ---------- démarrage ---------- */
// en partie, le logo passe par la confirmation ; pendant la sortie de carte (backAction nul), il est ignoré
document.getElementById('home').onclick = () => {
  if (!themes.length) return;
  if (app.querySelector('#quit')) { if (backAction === confirmQuit) confirmQuit(); return; }
  home();
};
refreshSound();
fetch('data/questions.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => { themes = validThemes(d); if (!themes.length) throw new Error('data'); home(); })
  .catch(() => show(el('<section class="card"><h2>Impossible de charger les questions</h2><p>Lancez le jeu depuis un serveur web (voir le README), pas en ouvrant le fichier directement.</p></section>')));
})();
