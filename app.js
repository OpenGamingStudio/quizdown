(() => {
'use strict';

const VERSION = '3.0.0';
const TIME = 15, BASE = 100, BONUS = 50, AUTO_NEXT_MS = 3000, LEAVE_MS = 200;
const app = document.getElementById('app');
const soundBtn = document.getElementById('sound');
const settingsBtn = document.getElementById('settings');
const liveBox = document.getElementById('live');
let timerId = null, advanceId = null, keyHandler = null;
// Échap : action « Retour » de l'écran courant ; quitHook = partie en cours (pause / reprise pendant la confirmation)
let backAction = null, quitHook = null;
// sortie de carte en cours : les Réglages restent fermés
let leaving = false;

/* ---------- utilitaires ---------- */
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stop = () => { clearInterval(timerId); clearTimeout(advanceId); if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; } };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const plural = (n, label) => `${n} ${n > 1 ? label.split(' ').map((w) => w + 's').join(' ') : label}`;
/* formes pleines A carré, B rond, C triangle, D losange (lettre + forme + couleur : jamais la couleur seule) */
const SHAPES = ['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="12" cy="12" r="10"/>', '<path d="M12 2 23 21H1z"/>', '<path d="M12 1 23 12 12 23 1 12z"/>'];
const shape = (i, cls = 'shape') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SHAPES[i % 4]}</svg>`;
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5 9.5 18 20 6"/></svg>';
const ICON_KO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" aria-hidden="true"><path d="M5 5 19 19M19 5 5 19"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/><path class="on" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path class="off" d="m16 9 6 6m0-6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('') || '?';
const jeton = (name, i, size = '') => `<span class="jeton j${i % 4} ${size}" aria-hidden="true">${esc(initials(name))}</span>`;
const KEY = 'quizdown.best.v2';
/* records par réglage de partie (thèmes, niveaux, nombre, temps) : { signature: { s: score, l: libellé, t: date } }, les 30 plus récents */
const loadBest = () => {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw).slice(0, 60)) if (v && Number.isFinite(v.s) && v.s > 0 && typeof v.l === 'string') out[k] = { s: Math.min(Math.floor(v.s), 100000), l: v.l.slice(0, 90), t: Number(v.t) || 0 };
  } catch {}
  return out;
};
const saveBest = (id, score, label) => {
  const b = loadBest(); const isNew = score > (b[id]?.s || 0);
  if (isNew) {
    b[id] = { s: score, l: label, t: Date.now() };
    const keep = {};
    Object.keys(b).sort((x, y) => b[y].t - b[x].t).slice(0, 30).forEach((k) => { keep[k] = b[k]; });
    try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch {}
  }
  return isNew;
};

/* annonce lecteur d'écran (zone polite hors de <main>) : vidée puis remplie pour que le même texte soit relu */
let sayId = 0;
function say(msg) { liveBox.textContent = ''; clearTimeout(sayId); sayId = setTimeout(() => { liveBox.textContent = msg; }, 60); }

let firstShow = true;
function show(node, focusSel, title) {
  stop();
  liveBox.textContent = '';
  document.title = `${title || node.dataset.title || 'Jeu de quiz'} · QuizDown`;
  backAction = null; quitHook = null;
  leaving = false;
  app.replaceChildren(node);
  const f = (focusSel && node.querySelector(focusSel)) || node.querySelector('h1,h2');
  // premier affichage : le focus reste au début de la page (lien d'évitement, en-tête) ; ensuite il suit chaque changement d'écran
  if (f && !firstShow) { if (!f.matches('button,input')) f.tabIndex = -1; f.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
  firstShow = false;
}

/* la carte sort par la gauche avant l'écran suivant (même axe que l'entrée) */
function leave(node, next) {
  stop();
  leaving = true;
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

/* ---------- réglages (persistés) : son, volume, minuteur, raccourcis clavier ---------- */
const SKEY = 'quizdown.settings.v1';
const settings = { sound: true, volume: 80, keys: true, vibrate: true };
try {
  const raw = JSON.parse(localStorage.getItem(SKEY));
  if (raw && typeof raw === 'object') {
    if (typeof raw.sound === 'boolean') settings.sound = raw.sound;
    if (Number.isFinite(raw.volume)) settings.volume = Math.min(100, Math.max(0, Math.round(raw.volume / 10) * 10));
    if (typeof raw.keys === 'boolean') settings.keys = raw.keys;
    if (typeof raw.vibrate === 'boolean') settings.vibrate = raw.vibrate;
  } else if (localStorage.getItem('quizdown.sound') === 'off') settings.sound = false;
} catch {}
const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} };
let ctx = null;
function refreshSound() {
  soundBtn.innerHTML = `${ICON_SOUND}<span class="max-[479px]:sr-only">${settings.sound ? 'Son activé' : 'Son coupé'}</span>`;
  soundBtn.dataset.on = settings.sound;
}
soundBtn.onclick = () => { settings.sound = !settings.sound; saveSettings(); refreshSound(); beep('ok'); };
function beep(kind) {
  if (!settings.sound || !settings.volume) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { ok: [660, 880], ko: [220, 160], end: [523, 659, 784] }[kind];
    const vol = 0.15 * settings.volume / 80;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.12;
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}
/* vibration courte sur mobile : désactivable dans les Réglages, jamais en mouvement réduit */
const CAN_VIBRATE = typeof navigator.vibrate === 'function';
const PULSES = { ok: [25], ko: [40, 40, 40], temps: [90] };
function buzz(kind) {
  if (!CAN_VIBRATE || !settings.vibrate || reduced.matches) return;
  try { navigator.vibrate(PULSES[kind]); } catch {}
}

/* ---------- banque : index + un fichier par thème x niveau, chargé à la demande ---------- */
const isStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
const GROUPS = [['primaire', 'Primaire', 'CP à CM2'], ['college', 'Collège', '6e à 3e'], ['lycee', 'Lycée', '2nde à Terminale']];
let idx = { levels: [], themes: [] };
function validIndex(d) {
  if (!d || !Array.isArray(d.levels) || !Array.isArray(d.themes)) return null;
  const levels = d.levels.filter((l) => l && /^[a-z0-9]{2,6}$/.test(l.id) && isStr(l.name, 20) && GROUPS.some((g) => g[0] === l.group));
  const ids = new Set(levels.map((l) => l.id));
  const themes = d.themes.map((t) => {
    if (!t || !/^[a-z0-9-]{2,40}$/.test(t.id) || !isStr(t.name, 60) || !t.counts || typeof t.counts !== 'object') return null;
    const counts = {};
    for (const [k, v] of Object.entries(t.counts)) if (ids.has(k) && Number.isInteger(v) && v > 0) counts[k] = v;
    return Object.keys(counts).length ? { id: t.id, name: t.name, counts } : null;
  }).filter(Boolean);
  return themes.length && levels.length ? { levels, themes } : null;
}
const validQs = (a) => Array.isArray(a) ? a.filter((q) => q && isStr(q.q, 300) && Array.isArray(q.a) && q.a.length === 4 && q.a.every((x) => isStr(x, 120)) && Number.isInteger(q.c) && q.c >= 0 && q.c < 4) : [];
const bankCache = new Map();
function fetchFile(t, l) {
  const k = `${t}/${l}`;
  if (!bankCache.has(k)) bankCache.set(k, fetch(`data/bank/${k}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(validQs).catch((e) => { bankCache.delete(k); throw e; }));
  return bankCache.get(k);
}
const themeOf = (id) => idx.themes.find((t) => t.id === id);
const levelOf = (id) => idx.levels.find((l) => l.id === id);
/* couples thème x niveau qui ont des questions : [thème, niveau, nombre] */
const combos = (cfg) => cfg.themes.flatMap((t) => cfg.levels.map((l) => [t, l, themeOf(t)?.counts[l] || 0])).filter((c) => c[2] > 0);
const available = (cfg) => combos(cfg).reduce((s, c) => s + c[2], 0);
/* tirage équitable : on prend à tour de rôle une question dans chaque couple, on ne charge que les fichiers utiles ; sans doublon */
async function drawQuestions(cfg) {
  const cs = shuffle(combos(cfg)).map(([t, l, left]) => ({ t, l, left, take: 0 }));
  for (let k = Math.min(cfg.n, available(cfg)); k > 0;) {
    let moved = false;
    for (const c of cs) if (k > 0 && c.take < c.left) { c.take++; k--; moved = true; }
    if (!moved) break;
  }
  const parts = await Promise.all(cs.filter((c) => c.take).map(async (c) => shuffle(await fetchFile(c.t, c.l)).slice(0, c.take).map((q) => ({ ...q, theme: themeOf(c.t).name, level: levelOf(c.l).name }))));
  const seen = new Set();
  return shuffle(parts.flat().filter((q) => !seen.has(q.q) && seen.add(q.q)));
}

/* ---------- réglages de la partie (mémorisés) : thèmes, niveaux, nombre de questions, temps par question ---------- */
const CKEY = 'quizdown.config.v1';
const NS = [5, 10, 15, 20, 30], N_MAX = 50, TIMES = [10, 15, 20, 30, 0];
let config = { themes: ['culture-generale'], levels: ['cm1', 'cm2', '6e'], n: 10, time: TIME };
function loadConfig() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(CKEY)); } catch {}
  let old = null;
  try { old = JSON.parse(localStorage.getItem(SKEY))?.timer; } catch {}
  const c = { ...config };
  if (!raw && old) c.time = { normal: TIME, long: TIME * 2, off: 0 }[old] ?? TIME;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.themes)) c.themes = raw.themes.filter((t) => themeOf(t));
    if (Array.isArray(raw.levels)) c.levels = raw.levels.filter((l) => levelOf(l));
    if (Number.isInteger(raw.n) && raw.n >= 1 && raw.n <= N_MAX) c.n = raw.n;
    if (TIMES.includes(raw.time)) c.time = raw.time;
  }
  c.themes = c.themes.filter((t) => themeOf(t)); c.levels = c.levels.filter((l) => levelOf(l));
  if (!c.themes.length) c.themes = [idx.themes[0].id];
  if (!c.levels.length) c.levels = idx.levels.slice(0, 3).map((l) => l.id);
  config = c;
}
const saveConfig = () => { try { localStorage.setItem(CKEY, JSON.stringify(config)); } catch {} };
const timeLabel = (t) => t ? `${t} s` : 'Sans limite';
const themesLabel = (cfg) => { const n = cfg.themes.map((t) => themeOf(t)?.name).filter(Boolean); return n.length <= 2 ? n.join(' + ') : `${n.length} thèmes`; };
const levelsLabel = (cfg) => { const n = idx.levels.filter((l) => cfg.levels.includes(l.id)).map((l) => l.name); return n.length <= 3 ? n.join(', ') : `${n.length} niveaux`; };
const fullLabel = (cfg) => `${themesLabel(cfg)} · ${levelsLabel(cfg)} · ${Math.min(cfg.n, available(cfg))} questions`;
const sigOf = (cfg) => [cfg.themes.slice().sort().join('+'), cfg.levels.slice().sort().join('+'), cfg.n, cfg.time].join('|');
const ICONS = {
  maths: '<path d="M5 12h14"/><circle cx="12" cy="6" r="1.6"/><circle cx="12" cy="18" r="1.6"/>',
  francais: '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
  histoire: '<path d="M3 20h18M5 20V10M10 20V10M14 20V10M19 20V10M3 10l9-6 9 6z"/>',
  geographie: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  sciences: '<path d="M5 19C5 9 11 5 20 4c0 9-4 15-13 15zM5 19l8-8"/>',
  'physique-chimie': '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8"/>',
  anglais: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
  'culture-generale': '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
  arts: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3c0-6-4-11-8-11z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
  sport: '<circle cx="12" cy="12" r="9"/><path d="M5 6c5 2 5 10 0 12M19 6c-5 2-5 10 0 12"/>',
  numerique: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  emc: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
};
const icon = (id) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;

/* ---------- accueil ---------- */
function home() {
  const best = loadBest();
  const records = Object.values(best).sort((a, b) => b.t - a.t).slice(0, 5);
  const n = el(`<section class="accueil" data-title="Accueil">
    <h1 class="logo">Quiz<span>Down</span></h1>
    <p class="tag">Vos thèmes, votre niveau, de 5 à 30 questions. Répondez vite, répondez juste.</p>
    <div class="modes">
      <button class="btn mode primary" type="button" data-mode="solo">${shape(0, 'shape mode-shape')}<span class="mode-title">Jouer solo</span><small>Réglez la partie et battez votre record, gardé sur cet appareil</small></button>
      <button class="btn mode alt" type="button" data-mode="multi">${shape(1, 'shape mode-shape')}<span class="mode-title">Jouer à plusieurs</span><small>2 à 4 joueurs, chacun son tour sur le même téléphone</small></button>
      <button class="btn mode online" type="button" data-mode="online">${shape(2, 'shape mode-shape')}<span class="mode-title">Jouer en ligne</span><small>Chacun sur son téléphone, avec un code à partager (room privée)</small></button>
    </div>
    <div class="card regles">
      <h2 class="etiquette">Comment jouer</h2>
      <ol class="etapes">
        <li>${shape(0, 'shape puce p0')}<span>Réglez la partie : thèmes, niveau (CP à Terminale), nombre de questions et temps.</span></li>
        <li>${shape(1, 'shape puce p1')}<span>Touchez la bonne réponse${config.time ? ' avant la fin du sablier' : ''}. ${settings.keys ? ' Au clavier : <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd>.' : ''}</span></li>
        <li>${shape(2, 'shape puce p2')}<span>Juste = ${BASE} points, plus jusqu'à ${BONUS} de bonus si vous êtes rapide.</span></li>
      </ol>
    </div>
    ${records.length ? `<div class="card records"><h2 class="etiquette">Vos records</h2><ul>${records.map((r) => `<li><span>${esc(r.l)}</span><strong>${r.s} pts</strong></li>`).join('')}</ul></div>` : ''}
  </section>`);
  show(n);
  n.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => b.dataset.mode === 'online' ? onlineMenu() : reglages(b.dataset.mode === 'multi'));
}

/* ---------- réglages de la partie : thèmes, niveaux, nombre de questions, temps (mémorisés) ---------- */
const reglages = (multi, names = []) => setup({ title: 'Réglages de la partie', cta: multi ? 'Suivant : les joueurs' : 'Jouer', back: home, next: (c) => multi ? setupMulti(c, names) : startGame(c, names.length ? names : ['Vous']) });
const toggle = (arr, v) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
function setup({ title, cta, back, next, noTime = false, online = false, init = null }) {
  const nMax = online ? 30 : N_MAX, nMin = online ? 5 : 1, times = online ? TIMES.filter(Boolean) : TIMES;
  const base = init || config;
  const cfg = { ...base, themes: base.themes.slice(), levels: base.levels.slice() };
  if (online && !times.includes(cfg.time)) cfg.time = 20;
  cfg.n = Math.min(nMax, Math.max(nMin, cfg.n));
  const n = el(`<section class="card reglage" data-title="${esc(title)}">
    <h1>${esc(title)}</h1>
    <form class="stack" novalidate>
      <fieldset class="bloc"><legend class="etiquette">Thèmes</legend>
        <div class="chips" id="themes">${idx.themes.map((t) => `<button type="button" class="chip" data-t="${esc(t.id)}" aria-pressed="false">${icon(t.id)}<span>${esc(t.name)}</span></button>`).join('')}</div>
        <button type="button" class="lien" id="t-all"></button></fieldset>
      <fieldset class="bloc"><legend class="etiquette">Niveaux</legend>
        <div class="chips groupes">${GROUPS.map(([g, name, sub]) => `<button type="button" class="chip groupe" data-g="${g}" aria-pressed="false"><span>${name}</span><small>${sub}</small></button>`).join('')}</div>
        <div class="chips" id="levels">${idx.levels.map((l) => `<button type="button" class="chip petit" data-l="${l.id}" aria-pressed="false">${esc(l.name)}</button>`).join('')}</div></fieldset>
      <fieldset class="bloc"><legend class="etiquette">Nombre de questions</legend>
        <div class="chips" id="ns">${NS.map((v) => `<button type="button" class="chip petit" data-n="${v}" aria-pressed="false">${v}</button>`).join('')}</div>
        <label for="n-custom">Ou un autre nombre (${nMin} à ${nMax})</label>
        <input type="number" id="n-custom" inputmode="numeric" min="${nMin}" max="${nMax}" autocomplete="off">
        <p class="note">Tirées au hasard, sans doublon.</p></fieldset>
      ${noTime ? '' : `<fieldset class="bloc"><legend class="etiquette">Temps par question</legend>
        <div class="chips" id="times">${times.map((v) => `<button type="button" class="chip petit" data-time="${v}" aria-pressed="false">${timeLabel(v)}</button>`).join('')}</div>
        <p class="note" id="time-note"></p></fieldset>`}
      <p class="raison" id="raison" role="status"></p>
      <button class="btn primary" type="submit" id="go" data-main>${esc(cta)}</button>
      <button class="btn back-btn" type="button" id="back">${ICON_BACK}Retour</button>
    </form></section>`);
  const q = (sel) => n.querySelector(sel), qa = (sel) => [...n.querySelectorAll(sel)];
  const go = q('#go'), raison = q('#raison'), custom = q('#n-custom');
  const refresh = () => {
    qa('[data-t]').forEach((b) => b.setAttribute('aria-pressed', cfg.themes.includes(b.dataset.t)));
    qa('[data-l]').forEach((b) => b.setAttribute('aria-pressed', cfg.levels.includes(b.dataset.l)));
    qa('[data-g]').forEach((b) => { const ids = idx.levels.filter((l) => l.group === b.dataset.g).map((l) => l.id); b.setAttribute('aria-pressed', ids.every((i) => cfg.levels.includes(i))); });
    qa('[data-n]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.n === cfg.n));
    qa('[data-time]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.time === cfg.time));
    q('#t-all').textContent = cfg.themes.length === idx.themes.length ? 'Tout décocher' : 'Tout cocher';
    const tn = q('#time-note'); if (tn) tn.textContent = cfg.time > TIME || !cfg.time ? 'Au-delà de 15 s, la question suivante attend votre clic.' : '';
    const avail = available(cfg);
    raison.textContent = !cfg.themes.length ? 'Choisissez au moins un thème.' : !cfg.levels.length ? 'Choisissez au moins un niveau.' : !avail ? 'Aucune question pour ce mélange : ajoutez un niveau ou un autre thème.'
      : cfg.n > avail ? `Il n'y a que ${plural(avail, 'question')} pour ce mélange : la partie en aura ${avail}.` : `${plural(avail, 'question disponible')} pour ce mélange.`;
    go.disabled = !cfg.themes.length || !cfg.levels.length || !avail;
  };
  q('#themes').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { cfg.themes = toggle(cfg.themes, b.dataset.t); refresh(); } };
  q('#t-all').onclick = () => { cfg.themes = cfg.themes.length === idx.themes.length ? [] : idx.themes.map((t) => t.id); refresh(); };
  q('#levels').onclick = (e) => { const b = e.target.closest('[data-l]'); if (b) { cfg.levels = toggle(cfg.levels, b.dataset.l); refresh(); } };
  qa('[data-g]').forEach((b) => b.onclick = () => {
    const ids = idx.levels.filter((l) => l.group === b.dataset.g).map((l) => l.id), all = ids.every((i) => cfg.levels.includes(i));
    cfg.levels = all ? cfg.levels.filter((l) => !ids.includes(l)) : [...new Set([...cfg.levels, ...ids])]; refresh();
  });
  qa('[data-n]').forEach((b) => b.onclick = () => { cfg.n = +b.dataset.n; custom.value = cfg.n; refresh(); });
  custom.value = cfg.n;
  custom.oninput = () => { const v = parseInt(custom.value, 10); if (v >= nMin && v <= nMax) { cfg.n = v; refresh(); } };
  custom.onblur = () => { custom.value = cfg.n; };
  qa('[data-time]').forEach((b) => b.onclick = () => { cfg.time = +b.dataset.time; refresh(); });
  refresh(); show(n);
  q('#back').onclick = back; backAction = back;
  q('form').onsubmit = (e) => { e.preventDefault(); if (go.disabled) return; const c = { themes: cfg.themes, levels: cfg.levels, n: cfg.n, time: cfg.time }; if (!online) { config = c; saveConfig(); } next(c); };
}

/* ---------- multijoueur : nombre et prénoms (après le choix du paquet) ---------- */
const NAME_MAX = 12;
function setupMulti(cfg, prev = []) {
  let count = Math.max(2, prev.length);
  const n = el(`<section class="card" data-title="Qui joue ?">
    <p class="etiquette">${esc(fullLabel(cfg))}</p>
    <h1>Qui joue ?</h1>
    <form class="stack" novalidate>
      <div><p class="etiquette" id="cl">Nombre de joueurs</p>
        <div class="seg" role="group" aria-labelledby="cl">${[2,3,4].map((c) => `<button type="button" class="btn" data-n="${c}" aria-label="${c} joueurs">${c}</button>`).join('')}</div></div>
      <div class="stack" id="names"></div>
      <p class="raison" id="raison" role="status"></p>
      <button class="btn primary" type="submit" id="go" data-main>C'est parti</button>
      <button class="btn back-btn" type="button" id="back">${ICON_BACK}Changer les réglages</button>
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
      <div class="nom">${jeton(v || `Joueur ${i + 1}`, i)}<input type="text" id="p${i}" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" aria-describedby="raison" value="${esc(v)}"></div></div>`;
    }).join('');
    names.querySelectorAll('input').forEach((inp, i) => inp.oninput = () => { inp.previousElementSibling.textContent = initials(inp.value.trim() || `Joueur ${i + 1}`); check(); });
    check();
  };
  n.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { count = +b.dataset.n; draw(); });
  draw(); show(n);
  const back = () => reglages(true, values());
  n.querySelector('#back').onclick = back; backAction = back;
  n.querySelector('form').onsubmit = (e) => {
    e.preventDefault(); check();
    if (!go.disabled) startGame(cfg, values());
  };
}

/* ---------- réglages : dialog natif (Échap ferme, le focus revient au bouton), minuteur en pause pendant l'ouverture ---------- */
const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>';
function openSettings() {
  if (leaving || document.querySelector('dialog[open]')) return;
  const hook = quitHook;
  hook?.pause?.();
  const d = el(`<dialog class="confirm reglages" aria-labelledby="rt">
    <h2 id="rt">Réglages</h2>
    <div class="stack">
      <label class="coche"><input type="checkbox" id="r-sound"${settings.sound ? ' checked' : ''}>Sons</label>
      <div><label for="r-vol">Volume : <output id="r-volv" for="r-vol">${settings.volume} %</output></label>
        <input type="range" id="r-vol" min="0" max="100" step="10" value="${settings.volume}"></div>
      ${CAN_VIBRATE ? `<label class="coche"><input type="checkbox" id="r-vib"${settings.vibrate ? ' checked' : ''}>Vibration courte à chaque réponse</label>` : ''}
      <label class="coche"><input type="checkbox" id="r-keys"${settings.keys ? ' checked' : ''}>Raccourcis clavier A B C D et 1 à 4 pendant les questions</label>
    </div>
    <p class="note">Le temps par question se règle avant chaque partie.</p>
    <div class="confirm-actions one"><button class="btn primary" type="button" id="r-close" autofocus>Fermer</button></div>
    <p class="note version">QuizDown v${VERSION}</p>
  </dialog>`);
  document.body.append(d);
  const onHome = !!app.querySelector('.accueil');
  const close = () => {
    d.close(); d.remove(); hook?.resume?.();
    // accueil : le texte dépend des réglages (raccourcis), on le redessine puis le focus revient au bouton
    if (onHome && app.querySelector('.accueil') && !leaving) { home(); settingsBtn.focus({ preventScroll: true }); }
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.querySelector('#r-close').onclick = close;
  d.querySelector('#r-sound').onchange = (e) => { settings.sound = e.target.checked; saveSettings(); refreshSound(); beep('ok'); };
  const vol = d.querySelector('#r-vol');
  vol.oninput = () => { settings.volume = +vol.value; d.querySelector('#r-volv').textContent = `${vol.value} %`; saveSettings(); };
  vol.onchange = () => beep('ok');
  d.querySelector('#r-vib')?.addEventListener('change', (e) => { settings.vibrate = e.target.checked; saveSettings(); buzz('ok'); });
  d.querySelector('#r-keys').onchange = (e) => { settings.keys = e.target.checked; saveSettings(); };
  d.showModal();
  d.querySelector('#r-close').focus();
}
settingsBtn.onclick = openSettings;
settingsBtn.querySelector('svg').outerHTML = ICON_GEAR;

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
  <button class="hud-back" type="button" id="quit">${ICON_BACK}<span class="sr-only">Quitter la partie</span></button>
  <p class="hud-theme">${esc(g.label)}</p>
  ${g.players.length > 1 ? `<ul class="hud-jetons">${g.players.map((o, i) => `<li class="${i === g.pi ? 'tour' : ''}">${jeton(o.name, i, i === g.pi ? '' : 'small')}<span class="sr-only">${esc(o.name)}${i === g.pi ? ', à son tour' : ''}</span></li>`).join('')}</ul>` : ''}
  <p class="hud-box"><span class="sr-only">Question </span>${g.qi + 1}<span aria-hidden="true">/</span><span class="sr-only"> sur </span>${g.qs.length}</p>
  <p class="hud-box hud-score"><span class="sr-only">Score : </span><strong id="sc">${score}</strong></p>
</div>`;

/* ---------- partie (solo = 1 joueur) ---------- */
async function startGame(cfg, players) {
  show(el('<section class="card" data-title="Préparation"><h1>Préparation…</h1><p role="status">On mélange les questions.</p></section>'));
  let raw = [];
  try { raw = await drawQuestions(cfg); } catch {}
  if (!raw.length) { show(el('<section class="card" data-title="Erreur de chargement"><h1>Impossible de charger les questions</h1><p>Vérifiez votre connexion puis réessayez.</p><button class="btn primary" type="button" id="retry">Revenir aux réglages</button></section>')); app.querySelector('#retry').onclick = () => reglages(players.length > 1, players); return; }
  const qs = raw.map((q) => ({ q: q.q, theme: q.theme, level: q.level, answers: shuffle(q.a.map((text, i) => ({ text, ok: i === q.c }))) }));
  const g = { cfg, sig: sigOf(cfg), label: themesLabel(cfg), full: fullLabel(cfg), time: cfg.time, players: players.map((name) => ({ name, score: 0, good: 0, missed: [], track: [] })), qs, qi: 0, pi: 0 };
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
  const n = el(`<section class="passe j${g.pi % 4}" data-title="Au tour de ${esc(p.name)}">
    <p class="etiquette">${esc(g.label)} · Question ${g.qi + 1}/${g.qs.length}</p>
    <h1 class="who">${jeton(p.name, g.pi, 'big')}<span>À toi, ${esc(p.name)}</span></h1>
    <p>Prends le téléphone. ${g.time ? 'Le sablier démarre' : 'La question s\'affiche'} quand tu appuies sur « Je suis prêt ».</p>
    <button class="btn primary" type="button" id="go" data-main>Je suis prêt</button>
    <div class="card scores"><h2 class="etiquette">Scores</h2><ul class="mini">${others}</ul></div>
    <p class="after"><button class="btn court back-btn" type="button" id="quit">${ICON_BACK}Quitter la partie</button></p></section>`);
  show(n);
  n.querySelector('#go').onclick = () => ask(g);
  n.querySelector('#quit').onclick = confirmQuit; backAction = confirmQuit;
}

function ask(g) {
  const q = g.qs[g.qi], p = g.players[g.pi], multi = g.players.length > 1, T = g.time, auto = T > 0 && T <= TIME;
  const n = el(`<section class="manche" data-title="Question ${g.qi + 1} sur ${g.qs.length}">
    <h1 class="sr-only" id="qmeta">${esc(q.theme)}, ${esc(q.level)}, question ${g.qi + 1} sur ${g.qs.length}${multi ? `, ${esc(p.name)}` : ''}</h1>
    ${bandeau(g, p.score)}
    ${pips(g, p)}
    ${T ? `<div class="timer"><div class="rail" id="tm" aria-hidden="true"><i></i></div><span class="secs" id="secs" aria-hidden="true"></span></div>` : ''}
    <div class="qcard"><p class="etiquette">${esc(q.theme)} · ${esc(q.level)}${multi ? ` · À ${esc(p.name)} de répondre` : ''}</p><h2 class="question" id="qtxt" aria-describedby="qmeta">${esc(q.q)}</h2></div>
    <div class="answers" role="group" aria-labelledby="qtxt">${q.answers.map((a, i) => `<button class="btn ans a${i}" type="button" data-i="${i}" ${settings.keys ? ` aria-keyshortcuts="${'ABCD'[i]}"` : ''}><span class="key" aria-hidden="true">${'ABCD'[i]}</span><span class="ans-txt">${esc(a.text)}</span>${shape(i)}</button>`).join('')}</div>
    <div class="suite">
      <p class="fb" id="fb"></p>
      <button class="btn primary court" type="button" id="next" data-main hidden></button>
    </div>
    ${settings.keys ? '<p class="astuce">Clavier : <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> ou <kbd>1</kbd> à <kbd>4</kbd></p>' : ''}
  </section>`);
  show(n, '.question');
  n.querySelector('#quit').onclick = confirmQuit; backAction = confirmQuit;
  const btns = [...n.querySelectorAll('[data-i]')];
  const bar = n.querySelector('#tm'), fill = bar?.firstElementChild, secs = n.querySelector('#secs'), fb = n.querySelector('#fb'), nextBtn = n.querySelector('#next'), sc = n.querySelector('#sc');
  let t0 = performance.now(), done = false;
  // annonces du temps restant par paliers (jamais chaque seconde)
  const marks = T > TIME ? [20, 10, 5] : T ? [10, 5] : [];

  const finish = (idx) => {
    if (done) return; done = true;
    stop();
    const left = T ? Math.max(0, T - (performance.now() - t0) / 1000) : 0;
    const right = idx >= 0 && q.answers[idx].ok;
    const gain = right ? BASE + (T ? Math.round(BONUS * left / T) : 0) : 0;
    const before = p.score;
    p.score += gain; p.track[g.qi] = right;
    if (right) p.good++; else p.missed.push({ q: q.q, a: q.answers.find((x) => x.ok).text, mine: idx < 0 ? null : q.answers[idx].text });
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
      buzz(right ? 'ok' : idx < 0 ? 'temps' : 'ko');
      say(right ? `Juste. Plus ${gain} points. Score : ${p.score}.` : `${idx < 0 ? 'Temps écoulé' : 'Faux'}. La bonne réponse était : ${good}. Score : ${p.score}.`);
    } else {
      sc.textContent = p.score;
      fb.className = 'fb neutre';
      fb.textContent = idx < 0 ? 'Temps écoulé. Réponse enregistrée.' : 'Réponse enregistrée. La bonne réponse sera révélée au dernier joueur.';
      say(fb.textContent);
    }
    const last = g.pi === g.players.length - 1 && g.qi === g.qs.length - 1;
    nextBtn.textContent = last ? 'Voir les résultats' : multi ? 'Joueur suivant' : 'Question suivante'; nextBtn.hidden = false; nextBtn.focus({ preventScroll: true });
    const go = () => leave(n, () => { if (++g.pi >= g.players.length) { g.pi = 0; g.qi++; } g.qi >= g.qs.length ? results(g) : multi ? handover(g) : ask(g); });
    nextBtn.onclick = go;
    // solo, minuteur normal : on enchaîne seul après 3 s, « Question suivante » permet d'accélérer (sinon on attend le clic : temps réglable, WCAG 2.2.1)
    if (!multi && !last && auto) advanceId = setTimeout(go, AUTO_NEXT_MS);
    // le Retour reste possible pendant le retour de réponse : la pause suspend l'enchaînement automatique
    quitHook = { pause: () => clearTimeout(advanceId), resume: () => { if (!multi && !last && auto) advanceId = setTimeout(go, AUTO_NEXT_MS); } };
  };
  const onKey = (e) => {
    if (!settings.keys || leaving || e.repeat || e.target.closest?.('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey || done || document.querySelector('dialog[open]')) return;
    const i = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[e.key.toLowerCase()];
    if (i !== undefined) finish(i);
  };
  keyHandler = onKey; document.addEventListener('keydown', onKey);
  btns.forEach((b, i) => b.onclick = () => finish(i));
  const tick = () => {
    const left = T - (performance.now() - t0) / 1000, now = Math.ceil(Math.max(0, left));
    // mouvement réduit : le sablier se vide par paliers d'une seconde
    fill.style.width = (reduced.matches ? now : Math.max(0, left)) / T * 100 + '%';
    bar.classList.toggle('urgent', left <= 5);
    secs.textContent = left <= 5 ? now : '';
    while (marks.length && left <= marks[0]) { const m = marks.shift(); if (!marks.length || left > marks[0]) say(`${m} secondes restantes`); }
    if (left <= 0) finish(-1);
  };
  if (T) timerId = setInterval(tick, 100);
  // pendant la confirmation « Quitter ? », le sablier est en pause
  let pausedAt = 0;
  quitHook = {
    pause: () => { clearInterval(timerId); pausedAt = performance.now(); },
    resume: () => { if (done || !T) return; t0 += performance.now() - pausedAt; timerId = setInterval(tick, 100); },
  };
}

/* ---------- fin de partie ---------- */
const winners0 = (g) => { const r = g.players.slice().sort((a, b) => b.score - a.score || b.good - a.good), w = r.filter((p) => p.score === r[0].score && p.good === r[0].good); return w.length > 1 ? `Partie terminée. Égalité : ${w.map((p) => p.name).join(' et ')}.` : `Partie terminée. ${r[0].name} gagne avec ${r[0].score} points.`; };
const bilan = (good, total) => good === total ? 'Sans faute. Chapeau !'
  : good >= total * 0.8 ? 'Excellent, il s\'en est fallu de peu.'
  : good >= total * 0.5 ? 'Bien joué, la moyenne est largement passée.'
  : good > 0 ? 'Ça se défend. Une revanche ?'
  : 'C\'est coriace. On retente ?';

/* récap des questions ratées : la question, la réponse donnée (ou « temps écoulé ») et la bonne réponse */
const recap = (missed, title = '') => `${title ? `<h2 class="etiquette">${title}</h2>` : ''}<ol class="missed">${missed.map((m) => `<li><span class="mq">${esc(m.q)}</span>
  <span class="mine">${ICON_KO}<span><span class="lbl">${m.mine === null ? 'Temps écoulé' : 'Votre réponse'}</span>${m.mine === null ? '' : ` <s>${esc(m.mine)}</s>`}</span></span>
  <span class="good">${ICON_OK}<span><span class="lbl">Bonne réponse</span> <strong>${esc(m.a)}</strong></span></span></li>`).join('')}</ol>`;

function results(g) {
  beep('end');
  const multi = g.players.length > 1;
  let body;
  if (!multi) {
    const p = g.players[0], isNew = saveBest(g.sig, p.score, g.full), best = loadBest()[g.sig]?.s;
    body = `<div class="fin-a"><p class="etiquette">${esc(g.full)} · Résultats</p>
      <h1 class="score-geant"><span class="sr-only">Score : </span><span id="final">${p.score}</span> <span class="unit">pts</span></h1>
      <p class="bilan">${bilan(p.good, g.qs.length)}</p>
      <p>${plural(p.good, 'bonne réponse')} sur ${g.qs.length}.</p>
      <p class="record ${isNew && p.score > 0 ? 'nouveau' : ''}">${isNew && p.score > 0 ? `${shape(3)}<span>Nouveau record !</span>` : `<span>Record pour ce réglage : <strong>${best || 0} pts</strong></span>`}</p></div>
      ${p.missed.length ? `<div class="fin-b">${recap(p.missed, `À retenir : ${plural(p.missed.length, 'question ratée')}`)}</div>` : ''}`;
  } else {
    const rank = g.players.slice().sort((a, b) => b.score - a.score || b.good - a.good);
    const top = rank[0], max = Math.max(1, top.score);
    const winners = rank.filter((p) => p.score === top.score && p.good === top.good);
    // rang « compétition » : les ex aequo partagent la même place
    const place = (p) => rank.findIndex((o) => o.score === p.score && o.good === p.good) + 1;
    body = `<div class="fin-a"><p class="etiquette">${esc(g.full)} · Résultats</p>
      <h1>${winners.length > 1 ? 'Égalité !' : esc(top.name) + ' gagne !'}</h1>
      <p class="bilan">${winners.length > 1 ? winners.map((p) => esc(p.name)).join(' et ') + ' finissent ex aequo.' : `${plural(top.good, 'bonne réponse')} sur ${g.qs.length}, bravo.`}</p>
      <ol class="podium" aria-hidden="true">${rank.map((p) => {
        const i = g.players.indexOf(p), h = 12 + Math.round(88 * p.score / max), r = place(p);
        return `<li class="${r === 1 ? 'win' : ''}">
          <span class="colonne"><span class="pile j${i % 4}" data-h="${h}">${jeton(p.name, i)}</span></span>
          <span class="place">${r === 1 ? '1er' : r + 'e'}</span><span class="podium-nom">${esc(p.name)}</span>
          <span class="podium-score">${p.score} pts</span><span class="podium-good">${p.good}/${g.qs.length}</span></li>`;
      }).join('')}</ol></div>
      <div class="fin-b"><table class="detail"><caption class="sr-only">Détail des scores</caption><thead><tr><th scope="col">Place</th><th scope="col">Joueur</th><th scope="col">Justes</th><th scope="col">Points</th></tr></thead>
      <tbody>${rank.map((p) => `<tr><td>${place(p)}</td><td>${esc(p.name)}</td><td>${p.good}/${g.qs.length}</td><td>${p.score}</td></tr>`).join('')}</tbody></table>
      ${rank.some((p) => p.missed.length) ? `<h2 class="etiquette recap-titre">À retenir</h2>${rank.filter((p) => p.missed.length).map((p) => `<details class="joueur-ratees"><summary>${jeton(p.name, g.players.indexOf(p), 'small')}<span>${esc(p.name)} : ${plural(p.missed.length, 'question ratée')}</span></summary>${recap(p.missed)}</details>`).join('')}` : ''}</div>`;
  }
  const n = el(`<section class="card fin" data-title="Résultats"><div class="fin-grid">${body}</div><div class="stack after fin-actions"><button class="btn primary" type="button" id="again" data-main>Rejouer</button><button class="btn" type="button" id="menu">Changer les réglages</button><button class="btn" type="button" id="accueil">Accueil</button></div></section>`);
  show(n, 'h1');
  backAction = home;
  say(multi ? (winners0(g)) : `Partie terminée. Score : ${g.players[0].score} points, ${plural(g.players[0].good, 'bonne réponse')} sur ${g.qs.length}.`);
  if (!multi) countUp(n.querySelector('#final'), 0, g.players[0].score, 700);
  // hauteur des colonnes via CSSOM (la CSP interdit les attributs style inline)
  n.querySelectorAll('.pile').forEach((s) => { s.style.height = s.dataset.h + '%'; });
  const names = g.players.map((p) => p.name);
  n.querySelector('#again').onclick = () => startGame(g.cfg, names);
  n.querySelector('#menu').onclick = () => reglages(multi, names);
  n.querySelector('#accueil').onclick = home;
}

/* ---------- en ligne : room privée sur WebSocket (le serveur chronomètre et note, le client n'envoie que son choix) ---------- */
const PKEY = 'quizdown.online.v1', RKEY = 'quizdown.room.v1';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', AV_N = 12;
const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[OI01]/g, '').slice(0, 5);
const validCode = (c) => c.length === 5 && [...c].every((x) => CODE_CHARS.includes(x));
const loadProfile = () => { try { const p = JSON.parse(localStorage.getItem(PKEY)); return { name: String(p.name || '').slice(0, NAME_MAX), av: Number.isInteger(p.av) && p.av >= 0 && p.av < AV_N ? p.av : Math.floor(Math.random() * AV_N) }; } catch { return { name: '', av: Math.floor(Math.random() * AV_N) }; } };
const saveProfile = (p) => { try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch {} };
const getSess = () => { try { const s = JSON.parse(sessionStorage.getItem(RKEY)); return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null; } catch { return null; } };
const setSess = (s) => { try { s ? sessionStorage.setItem(RKEY, JSON.stringify(s)) : sessionStorage.removeItem(RKEY); } catch {} };
/* avatars : 4 couleurs x 3 visages, aplats, dessinés en SVG (aucune image à charger) */
const FACES = [
  '<path d="M8 14.5c1 2 2.500 3 4 3s3-1 4-3" fill="none" stroke="#1B1B1F" stroke-width="2" stroke-linecap="round"/>',
  '<path d="M8 14h8c0 3-1.800 4.500-4 4.500S8 17 8 14z" fill="#1B1B1F"/>',
  '<path d="M7.500 15c1.500 1.800 3 2.500 4.500 2.500s3-.7 4.500-2.500" fill="none" stroke="#1B1B1F" stroke-width="2" stroke-linecap="round"/><rect x="5" y="8" width="6" height="4" rx="1.500" fill="#1B1B1F"/><rect x="13" y="8" width="6" height="4" rx="1.500" fill="#1B1B1F"/><path d="M11 9.500h2" stroke="#1B1B1F" stroke-width="1.500"/>',
];
const avatar = (a, cls = '') => { const n = Math.abs(a | 0) % AV_N, f = Math.floor(n / 4); return `<svg class="avatar c${n % 4} ${cls}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.500"/>${f === 2 ? '' : '<circle cx="8.500" cy="10" r="1.500" fill="#1B1B1F"/><circle cx="15.500" cy="10" r="1.500" fill="#1B1B1F"/>'}${FACES[f]}</svg>`; };
const avNum = (id) => { const m = /^a(\d+)$/.exec(id || ''); return m ? +m[1] : 0; };

const on = { ws: null, st: null, at: 0, sess: null, first: null, retry: 0, rt: 0, ping: 0, view: null, picked: null, off: false, tick: 0 };
const wsUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const send = (m) => { if (on.ws && on.ws.readyState === 1) on.ws.send(JSON.stringify(m)); };
function netOpen(first) {
  on.off = false; on.first = first || null; on.st = null; on.sess = first ? null : (on.sess || getSess());
  if (first) setSess(null);
  netConnect();
}
function netConnect() {
  clearTimeout(on.rt);
  if (on.ws && on.ws.readyState <= 1) return;
  let ws;
  try { ws = new WebSocket(wsUrl()); } catch { return netLost(); }
  on.ws = ws;
  ws.onopen = () => {
    on.retry = 0;
    if (on.first) { send(on.first); on.first = null; }
    else if (on.sess) send({ t: 'resume', code: on.sess.code, pid: on.sess.pid, token: on.sess.token });
    clearInterval(on.ping); on.ping = setInterval(() => send({ t: 'ping' }), 25000);
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } netMsg(m); };
  ws.onclose = () => { if (on.ws === ws) { clearInterval(on.ping); on.ws = null; netLost(); } };
  ws.onerror = () => {};
}
function netLost() {
  if (on.off) return;
  if (!on.sess) { if (on.view?.key === 'menu') oerr('Connexion impossible. Vérifiez votre réseau puis réessayez.'); return; }
  // téléphone en veille ou réseau coupé : on reprend la place avec le jeton, pendant 2 minutes
  if (++on.retry > 24) { netEnd('La connexion est perdue. La partie continue sans vous.'); return; }
  const b = document.getElementById('net-banner'); if (b) b.hidden = false;
  on.rt = setTimeout(netConnect, Math.min(5000, 500 * on.retry));
}
function netEnd(msg) {
  on.off = true; clearTimeout(on.rt); clearInterval(on.ping); clearInterval(on.tick);
  if (on.ws) { const w = on.ws; on.ws = null; w.onclose = null; try { w.close(); } catch {} }
  on.sess = null; on.st = null; on.view = null; setSess(null);
  if (msg) { home(); app.insertAdjacentHTML('afterbegin', `<p class="card alerte" role="alert">${esc(msg)}</p>`); say(msg); } else home();
}
function oerr(msg) { const e = document.getElementById('oerr'); if (e) e.textContent = msg; say(msg); }
function netMsg(m) {
  if (m.t === 'joined') { on.sess = { code: m.code, pid: m.pid, token: m.token }; setSess(on.sess); const b = document.getElementById('net-banner'); if (b) b.hidden = true; return; }
  if (m.t === 'closed') return netEnd('La room a été fermée.');
  if (m.t === 'error') {
    if (on.sess && !on.st) return netEnd(m.code === 'not_found' ? 'Cette room n\'existe plus.' : 'Impossible de reprendre la partie.');
    return oerr(m.msg || 'Une erreur est survenue.');
  }
  if (m.t === 'room') { on.st = m; on.at = performance.now(); const b = document.getElementById('net-banner'); if (b) b.hidden = true; render(); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && on.sess && !on.off && !(on.ws && on.ws.readyState <= 1)) { on.retry = 0; netConnect(); } });
window.addEventListener('online', () => { if (on.sess && !on.off) netConnect(); });

const banner = '<p class="net-banner card alerte" id="net-banner" role="status" hidden>Connexion perdue, reconnexion…</p>';
const oLeave = () => { send({ t: 'leave' }); netEnd(); };
const onlineSettingsLabel = (s) => `${themesLabel(s)} · ${levelsLabel(s)} · ${s.n} questions · ${s.time} s`;

/* menu : pseudo, avatar, créer ou rejoindre */
function onlineMenu(code = '') {
  on.view = { key: 'menu' };
  const prof = loadProfile();
  const n = el(`<section class="card" data-title="Jouer en ligne">
    <h1>Jouer en ligne</h1>
    <p class="note">Une room privée : seuls ceux qui ont le code ou le lien peuvent entrer. 2 à 8 joueurs, chacun sur son téléphone.</p>
    <form class="stack" novalidate>
      <div><label for="o-name">Votre pseudo</label>
        <input type="text" id="o-name" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" value="${esc(prof.name)}"></div>
      <fieldset class="bloc"><legend class="etiquette">Votre avatar</legend>
        <div class="avatars" id="avs">${Array.from({ length: AV_N }, (_, i) => `<button type="button" class="av-btn" data-a="${i}" aria-pressed="false" aria-label="Avatar ${i + 1}">${avatar(i)}</button>`).join('')}</div></fieldset>
      <p class="raison" id="oerr" role="alert"></p>
      <button class="btn primary" type="button" id="create" data-main>Créer une room</button>
      <div class="ou" aria-hidden="true">ou</div>
      <div><label for="o-code">Rejoindre avec un code (5 caractères)</label>
        <input type="text" id="o-code" class="code-in" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" value="${esc(code)}"></div>
      <button class="btn alt" type="submit" id="join">Rejoindre</button>
      <button class="btn back-btn" type="button" id="back">${ICON_BACK}Retour</button>
    </form></section>`);
  show(n, code ? '#o-name' : undefined);
  let av = prof.av;
  const name = n.querySelector('#o-name'), cin = n.querySelector('#o-code');
  const drawAv = () => n.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.a === av));
  drawAv();
  n.querySelector('#avs').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) { av = +b.dataset.a; drawAv(); } };
  cin.oninput = () => { cin.value = cleanCode(cin.value); };
  const me = () => {
    const nm = name.value.replace(/\s+/g, ' ').trim();
    if (!nm) { oerr('Choisissez un pseudo.'); name.focus(); return null; }
    saveProfile({ name: nm, av });
    return { name: nm, avatar: 'a' + av };
  };
  n.querySelector('#create').onclick = () => { const p = me(); if (p) { oerr(''); netOpen({ t: 'create', ...p }); } };
  n.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const p = me(); if (!p) return;
    const c = cleanCode(cin.value);
    if (!validCode(c)) { oerr('Le code a 5 caractères (lettres et chiffres, sans O, 0, I, 1).'); cin.focus(); return; }
    oerr(''); netOpen({ t: 'join', code: c, ...p });
  };
  n.querySelector('#back').onclick = () => { netEnd(); }; backAction = () => netEnd();
}

/* un seul rendu par clé de vue (phase + question) ; ensuite on met à jour sur place */
function render() {
  const st = on.st; if (!st) return;
  if (on.view?.key === 'reglages' && st.phase === 'lobby') return;
  const key = st.phase === 'lobby' ? 'lobby' : st.phase === 'final' ? 'final' : 'q' + st.qi;
  if (on.view?.key !== key) { clearInterval(on.tick); on.picked = null; on.view = { key }; ({ lobby: viewLobby, final: viewFinal }[key] || viewQuestion)(st); }
  on.view.update?.(st);
}
const me = (st) => st.players.find((p) => p.id === st.you);
const plRow = (p, st, extra = '') => `<li class="${p.id === st.you ? 'moi' : ''} ${p.connected ? '' : 'off'}">${avatar(avNum(p.avatar), 'small')}<span class="pn">${esc(p.name)}${p.id === st.host ? ' <small class="hote">hôte</small>' : ''}${p.connected ? '' : ' <small>reconnexion…</small>'}</span>${extra}</li>`;

function viewLobby(st) {
  const n = el(`<section class="card lobby" data-title="Salle d'attente">
    ${banner}
    <p class="etiquette">Code de la room</p>
    <p class="code-geant" id="code" aria-label="Code : ${[...st.code].join(' ')}">${esc(st.code)}</p>
    <div class="stack"><button class="btn alt" type="button" id="share">Partager le lien</button><p class="note" id="shared" role="status"></p></div>
    <h2 class="etiquette" id="pc"></h2>
    <ul class="mini lobby-joueurs" id="pl"></ul>
    <div class="bloc"><h2 class="etiquette">La partie</h2><p id="cfg" class="cfg"></p><button class="btn court" type="button" id="reglages" hidden>Régler la partie</button></div>
    <p class="raison" id="oerr" role="alert"></p>
    <button class="btn primary" type="button" id="start" data-main hidden>Lancer la partie</button>
    <p class="note" id="wait" hidden>L'hôte lance la partie quand tout le monde est là.</p>
    <button class="btn back-btn" type="button" id="quit">${ICON_BACK}Quitter la room</button></section>`);
  show(n, '#code');
  const link = `${location.origin}${location.pathname}?room=${st.code}`;
  n.querySelector('#share').onclick = async () => {
    const out = n.querySelector('#shared');
    try { if (navigator.share) { await navigator.share({ title: 'QuizDown', text: `Rejoins ma partie QuizDown : code ${st.code}`, url: link }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link); out.textContent = 'Lien copié.'; } catch { out.textContent = link; }
  };
  n.querySelector('#quit').onclick = oLeave; backAction = oLeave;
  n.querySelector('#start').onclick = () => { oerr(''); send({ t: 'start' }); };
  n.querySelector('#reglages').onclick = () => {
    const cur = on.st.settings;
    const back = () => { on.view = null; render(); };
    on.view = { key: 'reglages' };
    setup({ title: 'Réglages de la partie', cta: 'Valider', online: true, init: cur, back, next: (c) => { send({ t: 'settings', settings: c }); back(); } });
  };
  on.view.update = (s) => {
    const host = s.host === s.you, conn = s.players.filter((p) => p.connected).length;
    n.querySelector('#pc').textContent = `Joueurs (${s.players.length}/8)`;
    n.querySelector('#pl').innerHTML = s.players.map((p) => plRow(p, s)).join('');
    n.querySelector('#cfg').textContent = onlineSettingsLabel(s.settings);
    n.querySelector('#reglages').hidden = !host;
    const go = n.querySelector('#start'); go.hidden = !host; go.disabled = conn < 2;
    go.textContent = conn < 2 ? 'Il faut au moins 2 joueurs' : 'Lancer la partie';
    n.querySelector('#wait').hidden = host;
  };
}

function viewQuestion(st) {
  const T = st.T / 1000, auto = true;
  const n = el(`<section class="manche" data-title="Question ${st.qi + 1} sur ${st.total}">
    ${banner}
    <h1 class="sr-only" id="qmeta">${esc(st.q.theme)}, ${esc(st.q.level)}, question ${st.qi + 1} sur ${st.total}</h1>
    <div class="hud"><button class="hud-back" type="button" id="quit">${ICON_BACK}<span class="sr-only">Quitter la room</span></button>
      <p class="hud-theme">Room ${esc(st.code)}</p>
      <p class="hud-box"><span class="sr-only">Question </span>${st.qi + 1}<span aria-hidden="true">/</span><span class="sr-only"> sur </span>${st.total}</p>
      <p class="hud-box hud-score"><span class="sr-only">Score : </span><strong id="sc">${me(st)?.score || 0}</strong></p></div>
    <div class="timer"><div class="rail" id="tm" aria-hidden="true"><i></i></div><span class="secs" id="secs" aria-hidden="true"></span></div>
    <div class="qcard"><p class="etiquette">${esc(st.q.theme)} · ${esc(st.q.level)}</p><h2 class="question" id="qtxt" aria-describedby="qmeta">${esc(st.q.text)}</h2></div>
    <div class="answers" role="group" aria-labelledby="qtxt">${st.q.answers.map((a, i) => `<button class="btn ans a${i}" type="button" data-i="${i}" ${settings.keys ? ` aria-keyshortcuts="${'ABCD'[i]}"` : ''}><span class="key" aria-hidden="true">${'ABCD'[i]}</span><span class="ans-txt">${esc(a)}</span>${shape(i)}</button>`).join('')}</div>
    <p class="fb" id="fb"></p>
    <h2 class="etiquette">Classement en direct</h2>
    <ol class="mini live" id="pl"></ol></section>`);
  show(n, '.question');
  n.querySelector('#quit').onclick = oLeave; backAction = oLeave;
  const btns = [...n.querySelectorAll('[data-i]')], fill = n.querySelector('#tm').firstElementChild, secs = n.querySelector('#secs'), fb = n.querySelector('#fb'), bar = n.querySelector('#tm');
  let revealed = false;
  const pick = (i) => {
    if (on.picked !== null || revealed || on.st.phase !== 'question') return;
    on.picked = i; send({ t: 'answer', qi: on.st.qi, i });
    btns.forEach((b, k) => { b.disabled = true; if (k === i) b.classList.add('choisi'); });
    fb.className = 'fb neutre'; fb.textContent = 'Réponse envoyée. On attend les autres…'; say(fb.textContent);
  };
  btns.forEach((b, i) => b.onclick = () => pick(i));
  const onKey = (e) => {
    if (!settings.keys || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select') || document.querySelector('dialog[open]')) return;
    const i = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 }[e.key.toLowerCase()];
    if (i !== undefined) pick(i);
  };
  keyHandler = onKey; document.addEventListener('keydown', onKey);
  const left = () => Math.max(0, on.st.ms - (performance.now() - on.at)) / 1000;
  const tick = () => {
    if (on.st.phase !== 'question') return;
    const l = left();
    fill.style.width = (reduced.matches ? Math.ceil(l) : l) / T * 100 + '%';
    bar.classList.toggle('urgent', l <= 5); secs.textContent = l <= 5 ? Math.ceil(l) : '';
  };
  on.tick = setInterval(tick, 100); tick();
  on.view.update = (s) => {
    const mine = me(s);
    n.querySelector('#sc').textContent = mine?.score || 0;
    const rank = s.players.slice().sort((a, b) => b.score - a.score || b.good - a.good);
    n.querySelector('#pl').innerHTML = rank.map((p) => plRow(p, s, `<span class="pt">${p.score}</span>${s.phase === 'question' ? (p.answered ? `<span class="rep">${ICON_OK}<span class="sr-only">a répondu</span></span>` : '') : ''}`)).join('');
    if (s.phase === 'reveal' && !revealed) {
      revealed = true; clearInterval(on.tick); bar.classList.remove('urgent'); secs.textContent = '';
      const r = s.reveal, mineR = r.results.find((x) => x.id === s.you), gain = mineR?.gain || 0, idx0 = mineR ? mineR.i : -1;
      btns.forEach((b, i) => {
        b.disabled = true;
        if (i === r.correct) { b.classList.add('ok'); b.insertAdjacentHTML('beforeend', `<span class="verdict">${ICON_OK}Juste</span>`); }
        else if (i === idx0) { b.classList.add('ko'); b.insertAdjacentHTML('beforeend', `<span class="verdict">${ICON_KO}Faux</span>`); }
        else b.classList.remove('choisi');
      });
      if (idx0 >= 0) btns[idx0].classList.add('choisi');
      const right = idx0 === r.correct;
      fb.className = 'fb ' + (right ? 'juste' : idx0 < 0 ? 'temps' : 'faux');
      fb.innerHTML = right ? `${ICON_OK}<span>Juste, <strong class="gain">+${gain}</strong> points</span>` : `${ICON_KO}<span>${idx0 < 0 ? 'Temps écoulé' : 'Faux'}, la bonne réponse était <strong>${esc(s.q.answers[r.correct])}</strong></span>`;
      beep(right ? 'ok' : 'ko'); buzz(right ? 'ok' : idx0 < 0 ? 'temps' : 'ko');
      say(`${right ? `Juste. Plus ${gain} points.` : `${idx0 < 0 ? 'Temps écoulé' : 'Faux'}. Bonne réponse : ${s.q.answers[r.correct]}.`} Prochaine question dans quelques secondes.`);
    }
  };
}

function viewFinal(st) {
  beep('end');
  const rank = st.players.slice().sort((a, b) => b.score - a.score || b.good - a.good);
  const top = rank[0], max = Math.max(1, top.score);
  const winners = rank.filter((p) => p.score === top.score && p.good === top.good);
  const place = (p) => rank.findIndex((o) => o.score === p.score && o.good === p.good) + 1;
  const mine = me(st), host = st.host === st.you;
  const n = el(`<section class="card fin" data-title="Résultats">${banner}<div class="fin-grid"><div class="fin-a">
    <p class="etiquette">Room ${esc(st.code)} · Résultats</p>
    <h1>${winners.length > 1 ? 'Égalité !' : esc(top.name) + ' gagne !'}</h1>
    <p class="bilan">${winners.length > 1 ? winners.map((p) => esc(p.name)).join(' et ') + ' finissent ex aequo.' : `${plural(top.good, 'bonne réponse')} sur ${st.total}, bravo.`}</p>
    <ol class="podium" aria-hidden="true">${rank.map((p) => {
      const h = 12 + Math.round(88 * p.score / max), r = place(p);
      return `<li class="${r === 1 ? 'win' : ''}"><span class="colonne"><span class="pile" data-h="${h}">${avatar(avNum(p.avatar), 'big')}</span></span><span class="place">${r === 1 ? '1er' : r + 'e'}</span><span class="podium-nom">${esc(p.name)}</span><span class="podium-score">${p.score} pts</span><span class="podium-good">${p.good}/${st.total}</span></li>`;
    }).join('')}</ol></div>
    <div class="fin-b"><table class="detail"><caption class="sr-only">Détail des scores</caption><thead><tr><th scope="col">Place</th><th scope="col">Joueur</th><th scope="col">Justes</th><th scope="col">Points</th></tr></thead>
    <tbody>${rank.map((p) => `<tr><td>${place(p)}</td><td>${esc(p.name)}${p.id === st.you ? ' (vous)' : ''}</td><td>${p.good}/${st.total}</td><td>${p.score}</td></tr>`).join('')}</tbody></table>
    ${st.missed?.length ? recap(st.missed, `À retenir : ${plural(st.missed.length, 'question ratée')}`) : '<p class="bilan">Aucune erreur, bravo !</p>'}</div></div>
    <div class="stack after fin-actions"><button class="btn primary" type="button" id="again" data-main ${host ? '' : 'hidden'}>Rejouer avec les mêmes joueurs</button>
    <p class="note" id="wait" ${host ? 'hidden' : ''}>L'hôte peut relancer une partie.</p>
    <button class="btn" type="button" id="quit">Quitter la room</button></div></section>`);
  show(n, 'h1'); backAction = oLeave;
  say(winners0({ players: rank }));
  n.querySelectorAll('.pile').forEach((s) => { s.style.height = s.dataset.h + '%'; });
  n.querySelector('#again').onclick = () => send({ t: 'again' });
  n.querySelector('#quit').onclick = oLeave;
  on.view.update = (s) => {
    const h = s.host === s.you; n.querySelector('#again').hidden = !h; n.querySelector('#wait').hidden = h;
  };
}

/* lien direct : ?room=CODE ouvre le menu avec le code ; une room en cours (téléphone rechargé) est reprise */
function onlineBoot() {
  const q = new URLSearchParams(location.search).get('room');
  if (q) { history.replaceState(null, '', location.pathname); const c = cleanCode(q); if (c) { const s = getSess(); if (s && s.code === c) { netOpen(null); return true; } onlineMenu(c); return true; } }
  if (getSess()) { netOpen(null); return true; }
  return false;
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
  if (!idx.themes.length) return;
  if (on.sess && !on.off) { if (confirm('Quitter la room ?')) oLeave(); return; }
  if (app.querySelector('#quit')) { if (backAction === confirmQuit) confirmQuit(); return; }
  home();
};
refreshSound();
fetch('data/index.json')
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((d) => { const v = validIndex(d); if (!v) throw new Error('data'); idx = v; loadConfig(); if (!onlineBoot()) home(); })
  .catch(() => show(el('<section class="card" data-title="Erreur de chargement"><h1>Impossible de charger les questions</h1><p>Lancez le jeu depuis un serveur web (voir le README), pas en ouvrant le fichier directement.</p></section>')));
})();
