/*!
 * account.js 1.2.0 - compte et sauvegarde multi-jeux d'OpenGamingStudio (MIT).
 * Sans dépendance, à copier tel quel dans chaque jeu. Le jeu reste utilisable sans compte.
 *
 *   OGSAccount.init({
 *     game: 'trou-malin',               // identifiant du jeu (a-z, 0-9, tiret)
 *     version: '2.1.1',                 // version du jeu (affichée dans la sauvegarde)
 *     getSave: () => ({...}),           // le contrat : l'état à sauvegarder (objet JSON)  [alias : getState]
 *     applySave: (data) => {...},       // applique une sauvegarde venant du compte        [alias : setState]
 *     isEmpty: (obj) => boolean,        // optionnel : true si l'état local est vierge
 *     describe: (obj) => 'texte court', // optionnel : résumé affiché pour choisir en cas de conflit
 *     color: '#FFB703',                 // optionnel : couleur d'identité du jeu
 *     anchor: 'top-right',              // optionnel : top-right | top-left | bottom-right | bottom-left
 *     offset: [12, 12],                 // optionnel : marges en px
 *   });
 */
(function () {
  'use strict';
  var API = 'https://api.opengamingstudio.com';
  var wanted = true, cfg, user = null, me = { hasCode: false, identities: [], providers: [] }, notice = '',  pending = null, root, btn, dot, panel, lastHash = '', pushTimer = 0, busy = false, status = { kind: 'anon' }, retryAt = 0;

  // ---- utilitaires ----
  function hash(o) { var s = JSON.stringify(o), h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h + ':' + s.length; }
  function metaKey() { return 'ogs-account:' + cfg.game; }
  function loadMeta() { try { return JSON.parse(localStorage.getItem(metaKey())) || {}; } catch (e) { return {}; } }
  function saveMeta(m) { try { localStorage.setItem(metaKey(), JSON.stringify(m)); } catch (e) { /* stockage bloqué */ } }
  function isEmpty(s) { return cfg.isEmpty ? !!cfg.isEmpty(s) : !s || Object.keys(s).length === 0; }
  function when(ms) { try { return new Date(ms).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function el(tag, props) {
    var e = document.createElement(tag);
    for (var k in props || {}) { if (k === 'text') e.textContent = props[k]; else if (k === 'class') e.className = props[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }
  function svgEl(tag, attrs) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function api(method, path, body, opts) {
    var init = { method: method, credentials: 'include', headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    if (opts && opts.keepalive) init.keepalive = true;
    return fetch(cfg.apiBase + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; });
    });
  }
  var ERR = {
    pseudo_pris: 'Ce pseudo est déjà pris.',
    pseudo_invalide: 'Le pseudo fait de 3 à 20 caractères : lettres, chiffres, _ ou -.',
    identifiants_invalides: 'Pseudo ou code incorrect.',
    trop_de_jeux: 'Trop de jeux sauvegardés sur ce compte.',
    sauvegarde_trop_grosse: 'La sauvegarde est trop grosse.',
    refuse: 'Connexion annulée.',
    echec_fournisseur: 'La connexion a échoué. Réessaie dans un instant.',
    deja_lie: 'Ce compte Google ou Discord est déjà lié à un autre compte du studio.',
    non_connecte: 'Connecte-toi d’abord, puis réessaie.',
    derniere_methode: 'Garde au moins une façon de te connecter.'
  };
  function errText(r) {
    if (r.status === 429) { var m = Math.max(1, Math.ceil((r.json.retryAfter || 60) / 60)); return 'Trop d’essais. Réessaie dans ' + m + ' minute' + (m > 1 ? 's' : '') + '.'; }
    return ERR[r.json && r.json.error] || 'Une erreur est survenue. Réessaie.';
  }

  var PNAMES = { google: 'Google', discord: 'Discord' };
  function loadMe() {
    return api('GET', '/v1/me').then(function (r) { if (r.status === 200) { user = r.json.pseudo; me = r.json; } if (panel) renderPanel(); paint(); }, function () { /* hors ligne */ });
  }
  function loadProviders() {
    return api('GET', '/v1/providers').then(function (r) { if (r.status === 200) { me.providers = r.json.providers || []; if (panel) renderPanel(); } }, function () { /* hors ligne */ });
  }
  function cleanUrl() {
    var u = new URL(location.href); u.searchParams.delete('ogs_auth'); u.searchParams.delete('ogs_error'); return u.toString();
  }
  /** Va chez Google / Discord (page entière) ; l'API revient sur cette page. Un lien (link) ajoute la méthode au compte actuel. */
  function goProvider(name, link) {
    flush();
    location.href = cfg.apiBase + '/auth/' + name + '/start?return=' + encodeURIComponent(cleanUrl()) + (link ? '&link=1' : '');
  }
  /** Au retour d'un fournisseur : ogs_auth=ok|lie|erreur (+ ogs_error), puis on nettoie l'adresse. */
  function handleReturn() {
    var u = new URL(location.href), a = u.searchParams.get('ogs_auth');
    if (!a) return false;
    var e = u.searchParams.get('ogs_error');
    try { history.replaceState(null, '', cleanUrl()); } catch (x) { /* ignoré */ }
    if (a === 'erreur') fields.error = ERR[e] || 'La connexion a échoué.';
    else notice = a === 'lie' ? 'Méthode de connexion ajoutée.' : 'Connecté.';
    return true;
  }

  // ---- synchronisation ----
  function setStatus(s) { status = s; paint(); }
  function applyRemote(remote) {
    cfg.setState(remote.data);
    lastHash = hash(cfg.getState());
    saveMeta({ user: user, rev: remote.rev, hash: lastHash });
    setStatus({ kind: 'ok', at: remote.updatedAt });
  }
  function push(baseRev, force, keepalive) {
    var state = cfg.getState(), h = hash(state);
    return api('PUT', '/v1/saves/' + cfg.game, { data: state, baseRev: baseRev, force: !!force, gameVersion: cfg.version || '' }, { keepalive: keepalive }).then(function (r) {
      if (r.status === 200) { lastHash = h; saveMeta({ user: user, rev: r.json.rev, hash: h }); setStatus({ kind: 'ok', at: r.json.updatedAt }); return true; }
      if (r.status === 409) { askConflict(r.json.save); return false; }
      if (r.status === 401) { user = null; setStatus({ kind: 'anon' }); return false; }
      retryAt = Date.now() + 30000; setStatus({ kind: 'error' }); return false;
    }, function () { retryAt = Date.now() + 30000; setStatus({ kind: 'error' }); return false; });
  }
  function sync() {
    if (!user || busy || pending) return Promise.resolve();
    busy = true; setStatus({ kind: 'sync' });
    var local = cfg.getState(), h = hash(local), meta = loadMeta();
    var mine = meta.user === user;
    return api('GET', '/v1/saves/' + cfg.game).then(function (r) {
      if (r.status === 404) { return isEmpty(local) ? setStatus({ kind: 'ok', at: 0 }) : push(0); }
      if (r.status === 401) { user = null; return setStatus({ kind: 'anon' }); }
      if (r.status !== 200) { retryAt = Date.now() + 30000; return setStatus({ kind: 'error' }); }
      var remote = r.json;
      if (hash(remote.data) === h) { lastHash = h; saveMeta({ user: user, rev: remote.rev, hash: h }); return setStatus({ kind: 'ok', at: remote.updatedAt }); }
      if (mine && meta.rev === remote.rev) return h !== meta.hash ? push(remote.rev) : setStatus({ kind: 'ok', at: remote.updatedAt });
      var localChanged = mine ? h !== meta.hash : !isEmpty(local);
      if (!localChanged) return applyRemote(remote);
      askConflict(remote);
    }, function () { retryAt = Date.now() + 30000; setStatus({ kind: 'error' }); }).then(function () { busy = false; }, function () { busy = false; });
  }
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      if (!user || busy || pending) return;
      busy = true;
      var meta = loadMeta();
      push(meta.user === user ? meta.rev || 0 : 0).then(function () { busy = false; }, function () { busy = false; });
    }, 10000); // anti-rebond : 10 s après la dernière modification
  }
  function tick() {
    if (!user || pending || busy) return;
    var h = hash(cfg.getState());
    if (h !== lastHash) { lastHash = h; schedulePush(); setStatus({ kind: 'wait' }); }
    else if (status.kind === 'error' && Date.now() > retryAt) sync();
  }
  function flush() {
    if (!user || pending || busy) return;
    var meta = loadMeta();
    if (hash(cfg.getState()) !== meta.hash && meta.user === user) { clearTimeout(pushTimer); push(meta.rev || 0, false, true); }
  }

  function askConflict(remote) {
    if (!remote) { retryAt = Date.now() + 30000; return setStatus({ kind: 'error' }); }
    pending = remote; setStatus({ kind: 'conflict' }); openPanel();
  }
  function resolveConflict(keepLocal) {
    var remote = pending; pending = null;
    if (keepLocal) { push(remote.rev, true).then(function () { renderPanel(); }); }
    else { applyRemote(remote); renderPanel(); }
  }

  // ---- interface ----
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:Fredoka,"Segoe UI",sans-serif}',
    '.b{position:fixed;z-index:2147483000;width:48px;height:48px;border-radius:24px;border:3px solid #1b1b2f;background:#fff;color:#1b1b2f;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;touch-action:manipulation}',
    '.b:hover{background:var(--c)}.b:focus-visible,button:focus-visible,input:focus-visible{outline:4px solid #1b1b2f;outline-offset:2px}',
    '.d{position:absolute;right:-3px;bottom:-3px;width:16px;height:16px;border-radius:8px;border:3px solid #fff;background:#9a9aa8}',
    '.d.ok{background:#1fa764}.d.wait,.d.sync{background:#ff9f1c}.d.error,.d.conflict{background:#e63946}',
    '.o{position:fixed;inset:0;z-index:2147483001;background:rgba(27,27,47,.72);display:flex;align-items:center;justify-content:center;padding:12px;overflow:auto}',
    '.p{width:100%;max-width:420px;max-height:100%;overflow:auto;background:#fff;color:#1b1b2f;border:4px solid #1b1b2f;border-radius:20px;padding:20px;font-size:17px;line-height:1.35}',
    'h2{margin:0 0 12px;font-size:24px;font-weight:700}p{margin:0 0 12px}.s{font-size:15px}',
    '.t{display:flex;gap:8px;margin-bottom:16px}',
    '.t button{flex:1}',
    'button.k{min-height:48px;border:3px solid #1b1b2f;border-radius:14px;background:#fff;color:#1b1b2f;font-size:17px;font-weight:600;padding:8px 14px;cursor:pointer;touch-action:manipulation}',
    'button.k.on,button.k.main{background:var(--c)}button.k:hover{background:var(--c)}button.k:disabled{opacity:.45;cursor:not-allowed}',
    'button.k.danger{background:#fff;border-color:#e63946;color:#b0202d}',
    '.mt{margin-top:12px}.col{display:flex;flex-direction:column;gap:10px}.p>button.k,.col>button.k{width:100%}',
    'label{display:block;font-weight:600;margin-bottom:4px}',
    'input[type=text],input[type=password]{width:100%;min-height:48px;border:3px solid #1b1b2f;border-radius:14px;padding:8px 12px;font-size:18px;background:#fff;color:#1b1b2f}',
    '.err{background:#ffe3e5;border:3px solid #e63946;border-radius:12px;padding:8px 12px;margin-bottom:12px;font-weight:600}',
    '.code{font-size:22px;font-weight:700;letter-spacing:1px;text-align:center;background:var(--c);border:3px solid #1b1b2f;border-radius:14px;padding:12px 8px;word-break:break-all;user-select:all}',
    '.qr{display:block;margin:12px auto;width:200px;height:200px;border:3px solid #1b1b2f;border-radius:8px;background:#fff}',
    '.chk{display:flex;gap:10px;align-items:center;min-height:48px;font-weight:600}.chk input{width:28px;height:28px;flex:none}',
    'h3{margin:12px 0 8px;font-size:18px;font-weight:700}.ok{background:#dff7e8;border:3px solid #1fa764;border-radius:12px;padding:8px 12px;margin-bottom:12px;font-weight:600}.sep{text-align:center;margin:12px 0}',
    '.meth{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.meth strong{flex:1 1 100%}.meth .s{flex:1 1 auto}.meth button.k{width:auto;flex:none}',
    'button.k.prov{background:#fff}button.k.prov.google{border-color:#4285f4}button.k.prov.discord{border-color:#5865f2}',
    '.two{display:flex;flex-direction:column;gap:10px}.card{border:3px solid #1b1b2f;border-radius:14px;padding:12px}.card strong{display:block}',
    '@media (prefers-reduced-motion:no-preference){.b{transition:background .12s}}'
  ].join('\n');

  var view = 'login', fields = { pseudo: '', error: '', created: null, copied: false, ack: false, working: false };

  function iconUser() {
    var s = svgEl('svg', { width: 26, height: 26, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    s.appendChild(svgEl('circle', { cx: 12, cy: 8, r: 4.5, fill: 'currentColor' }));
    s.appendChild(svgEl('path', { d: 'M3.5 21c0-4.8 3.8-7.5 8.5-7.5s8.5 2.7 8.5 7.5z', fill: 'currentColor' }));
    return s;
  }
  function place() {
    var a = cfg.anchor || 'top-right', o = cfg.offset || [12, 12];
    btn.style.top = btn.style.bottom = btn.style.left = btn.style.right = 'auto';
    btn.style[a.indexOf('top') === 0 ? 'top' : 'bottom'] = o[1] + 'px';
    btn.style[a.indexOf('left') > 0 ? 'left' : 'right'] = o[0] + 'px';
  }
  function paint() {
    if (!btn) return;
    dot.className = 'd ' + (user ? status.kind : '');
    var label = !user ? 'Compte : se connecter pour sauvegarder' : 'Compte de ' + user + (status.kind === 'ok' ? ' : sauvegardé' : status.kind === 'error' ? ' : hors ligne, nouvel essai bientôt' : status.kind === 'conflict' ? ' : choisis ta sauvegarde' : ' : synchronisation');
    btn.setAttribute('aria-label', label); btn.title = label;
    if (panel) renderPanel();
  }
  function openPanel() {
    if (panel) return;
    if (!user) loadProviders();
    panel = el('div', { class: 'o', onclick: function (e) { if (e.target === panel && !canClose()) return; if (e.target === panel) closePanel(); } });
    root.appendChild(panel);
    view = user ? 'account' : (view === 'register' ? 'register' : 'login');
    renderPanel();
  }
  function canClose() { return !(fields.created && !fields.ack) && !pending; }
  function closePanel() { if (!panel) return; panel.remove(); panel = null; fields.error = ''; fields.created = null; fields.ack = false; btn.focus(); }
  function copyText(t, done) {
    function fallback() { try { var ta = el('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { /* pas de presse-papiers */ } }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
  }
  function drawQr(qr) {
    var q = 2, n = qr.size + q * 2, d = '';
    qr.rows.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (row[x] === '1') d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z'; });
    var s = svgEl('svg', { class: 'qr', viewBox: '0 0 ' + n + ' ' + n, role: 'img', 'aria-label': 'QR code : pseudo et code de récupération', 'shape-rendering': 'crispEdges' });
    s.appendChild(svgEl('rect', { width: n, height: n, fill: '#fff' }));
    s.appendChild(svgEl('path', { d: d, fill: '#1b1b2f' }));
    return s;
  }
  function textField(id, label, type, value, ph, auto) {
    var inp = el('input', { type: type, id: id, autocomplete: auto || 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: type === 'password' ? 40 : 20, placeholder: ph || '' });
    inp.value = value || '';
    return { wrap: el('div', null, el('label', { for: id, text: label }), inp), input: inp };
  }
  function submitAuth(kind, pseudoIn, codeIn) {
    if (fields.working) return;
    fields.pseudo = pseudoIn.value.trim(); fields.error = ''; fields.working = true; renderPanel();
    var p = kind === 'register' ? api('POST', '/v1/register', { pseudo: fields.pseudo }) : api('POST', '/v1/login', { pseudo: fields.pseudo, code: codeIn.value });
    p.then(function (r) {
      fields.working = false;
      if (r.status === 201) { user = r.json.pseudo; fields.created = r.json; fields.ack = false; fields.copied = false; view = 'created'; saveMeta({}); me = { hasCode: true, identities: [], providers: me.providers }; paint(); sync(); }
      else if (r.status === 200) { user = r.json.pseudo; view = 'account'; fields.error = ''; paint(); loadMe(); sync(); }
      else { fields.error = errText(r); renderPanel(); }
    }, function () { fields.working = false; fields.error = 'Pas de connexion à internet. Le jeu reste sauvegardé sur cet appareil.'; renderPanel(); });
  }
  function renderPanel() {
    if (!panel) return;
    panel.textContent = '';
    var p = el('div', { class: 'p', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Compte' });
    panel.appendChild(p);
    var focus = null;
    if (pending) {
      var loc = cfg.describe ? cfg.describe(cfg.getState()) : '', rem = cfg.describe ? cfg.describe(pending.data) : '';
      p.appendChild(el('h2', { text: 'Deux sauvegardes différentes' }));
      p.appendChild(el('p', { text: 'Cet appareil et ton compte n’ont pas la même progression. Laquelle garder ? L’autre sera remplacée.' }));
      var two = el('div', { class: 'two' });
      var b1 = el('button', { class: 'k main', type: 'button', onclick: function () { resolveConflict(true); } }, 'Garder celle de cet appareil');
      var b2 = el('button', { class: 'k main', type: 'button', onclick: function () { resolveConflict(false); } }, 'Garder celle du compte');
      two.appendChild(el('div', { class: 'card' }, el('strong', { text: 'Cet appareil' }), el('span', { class: 's', text: loc || 'Progression sur cet appareil' })));
      two.appendChild(b1);
      two.appendChild(el('div', { class: 'card' }, el('strong', { text: 'Ton compte' }), el('span', { class: 's', text: (rem ? rem + ' - ' : '') + 'sauvegardée le ' + when(pending.updatedAt) + (pending.gameVersion ? ' (version ' + pending.gameVersion + ')' : '') })));
      two.appendChild(b2);
      p.appendChild(two); focus = b1;
    } else if (view === 'created' && fields.created) {
      var c = fields.created;
      p.appendChild(el('h2', { text: c.again ? 'Nouveau code de récupération' : (c.fresh ? 'Code de récupération créé' : 'Compte créé : ' + c.pseudo) }));
      p.appendChild(el('p', { text: 'Voici ton code de récupération. Il ne s’affiche qu’une seule fois : note-le ou copie-le. Sans lui, impossible de te reconnecter.' }));
      p.appendChild(el('div', { class: 'code', text: c.code }));
      var row = el('div', { class: 'col mt' });
      row.appendChild(el('button', { class: 'k main', type: 'button', onclick: function () { copyText(c.code, function () { fields.copied = true; renderPanel(); }); } }, fields.copied ? 'Code copié' : 'Copier le code'));
      p.appendChild(row);
      p.appendChild(el('p', { class: 's mt', text: 'Pour jouer sur un autre appareil, scanne ce QR code avec ton téléphone : il contient ton pseudo et ton code.' }));
      p.appendChild(drawQr(c.qr));
      var ck = el('input', { type: 'checkbox', id: 'ack' }); ck.checked = fields.ack;
      var go = el('button', { class: 'k main', type: 'button', onclick: function () { view = 'account'; fields.created = null; fields.ack = false; renderPanel(); } }, 'Continuer');
      go.disabled = !fields.ack;
      ck.addEventListener('change', function () { fields.ack = ck.checked; go.disabled = !ck.checked; });
      p.appendChild(el('label', { class: 'chk', for: 'ack' }, ck, 'J’ai noté mon code'));
      p.appendChild(go); focus = row.firstChild;
    } else if (view === 'account' && user) {
      p.appendChild(el('h2', { text: 'Salut ' + user + ' !' }));
      var msg = status.kind === 'ok' ? (status.at ? 'Ta progression est sauvegardée toute seule (' + when(status.at) + ').' : 'Ton compte est prêt. La progression se sauvegarde toute seule.')
        : status.kind === 'error' ? 'Pas de réseau pour l’instant. Ta progression reste sur cet appareil et partira dès que possible.' : 'Synchronisation en cours…';
      p.appendChild(el('p', { text: msg }));
      if (notice) { p.appendChild(el('div', { class: 'ok', role: 'status', text: notice })); notice = ''; }
      if (fields.error) p.appendChild(el('div', { class: 'err', role: 'alert', text: fields.error }));
      p.appendChild(el('h3', { text: 'Façons de te connecter' }));
      var meths = el('div', { class: 'col' });
      var only = me.identities.length + (me.hasCode ? 1 : 0) <= 1;
      function methodRow(label, linked, linkBtn, unlinkBtn, off) {
        return el('div', { class: 'card meth' }, el('strong', { text: label }), el('span', { class: 's', text: linked ? 'Activée' : (off || 'Pas encore liée') }), linked ? unlinkBtn : linkBtn);
      }
      var codeBtn = el('button', { class: 'k', type: 'button', onclick: function () {
        if (me.hasCode && !window.confirm('Créer un nouveau code ? L’ancien ne marchera plus.')) return;
        api('POST', '/v1/me/code', {}).then(function (r) {
          if (r.status === 200) { r.json.fresh = true; fields.created = r.json; fields.ack = false; fields.copied = false; view = 'created'; me.hasCode = true; renderPanel(); }
          else { fields.error = errText(r); renderPanel(); }
        }, function () { fields.error = 'Pas de connexion à internet.'; renderPanel(); });
      } }, me.hasCode ? 'Nouveau code' : 'Créer un code');
      meths.appendChild(methodRow('Pseudo + code de récupération', me.hasCode, codeBtn, codeBtn, 'Pas encore créé'));
      Object.keys(PNAMES).forEach(function (n) {
        if (me.identities.indexOf(n) < 0 && me.providers.indexOf(n) < 0) return;
        var on = me.identities.indexOf(n) >= 0;
        var lb = el('button', { class: 'k', type: 'button', onclick: function () { goProvider(n, true); } }, 'Lier ' + PNAMES[n]);
        var ub = el('button', { class: 'k', type: 'button', onclick: function () {
          api('DELETE', '/v1/me/identities/' + n).then(function (r) { if (r.status === 200) { me = r.json; fields.error = ''; } else fields.error = errText(r); renderPanel(); });
        } }, 'Retirer');
        ub.disabled = only;
        meths.appendChild(methodRow(PNAMES[n], on, lb, ub));
      });
      p.appendChild(meths);
      var col = el('div', { class: 'col mt' });
      col.appendChild(el('button', { class: 'k', type: 'button', onclick: function () { api('POST', '/v1/logout', {}).then(function () { user = null; saveMeta({}); view = 'login'; setStatus({ kind: 'anon' }); loadProviders(); }, function () { user = null; view = 'login'; setStatus({ kind: 'anon' }); }); } }, 'Se déconnecter'));
      col.appendChild(el('button', { class: 'k danger', type: 'button', onclick: function () {
        if (!window.confirm('Supprimer ton compte et toutes ses sauvegardes ? Ta progression restera sur cet appareil.')) return;
        api('DELETE', '/v1/me').then(function () { user = null; saveMeta({}); view = 'login'; setStatus({ kind: 'anon' }); });
      } }, 'Supprimer mon compte'));
      var closeB = el('button', { class: 'k main', type: 'button', onclick: closePanel }, 'Fermer');
      col.appendChild(closeB);
      p.appendChild(col); focus = closeB;
    } else {
      p.appendChild(el('h2', { text: 'Ton compte' }));
      p.appendChild(el('p', { class: 's', text: 'Sauvegarde ta progression et retrouve-la sur tous tes appareils. Pas d’e-mail, pas de nom réel : juste un pseudo.' }));
      var provs = me.providers.filter(function (n) { return PNAMES[n]; });
      if (provs.length) {
        var pb = el('div', { class: 'col' });
        provs.forEach(function (n) { pb.appendChild(el('button', { class: 'k prov ' + n, type: 'button', onclick: function () { goProvider(n, false); } }, 'Continuer avec ' + PNAMES[n])); });
        p.appendChild(pb);
        p.appendChild(el('p', { class: 's sep', text: 'ou avec un pseudo' }));
      }
      var tabs = el('div', { class: 't', role: 'tablist' });
      tabs.appendChild(el('button', { class: 'k' + (view === 'register' ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': view === 'register', onclick: function () { view = 'register'; fields.error = ''; renderPanel(); } }, 'Créer un compte'));
      tabs.appendChild(el('button', { class: 'k' + (view !== 'register' ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': view !== 'register', onclick: function () { view = 'login'; fields.error = ''; renderPanel(); } }, 'Se connecter'));
      p.appendChild(tabs);
      if (fields.error) p.appendChild(el('div', { class: 'err', role: 'alert', text: fields.error }));
      var reg = view === 'register';
      var pf = textField('ogs-pseudo', 'Pseudo', 'text', fields.pseudo, reg ? 'ex. PandaRapide' : '', 'username');
      var cf = reg ? null : textField('ogs-code', 'Code de récupération', 'password', '', 'XXXX-XXXX-XXXX-XXXX', 'current-password');
      var form = el('form', { class: 'col', novalidate: 'novalidate', onsubmit: function (e) { e.preventDefault(); submitAuth(reg ? 'register' : 'login', pf.input, cf && cf.input); } });
      form.appendChild(pf.wrap);
      if (cf) form.appendChild(cf.wrap);
      if (reg) form.appendChild(el('p', { class: 's', text: '3 à 20 caractères : lettres, chiffres, _ ou -. Ne mets pas ton vrai nom. Un code secret te sera donné.' }));
      var sub = el('button', { class: 'k main', type: 'submit' }, fields.working ? 'Un instant…' : (reg ? 'Créer mon compte' : 'Me connecter'));
      sub.disabled = fields.working;
      form.appendChild(sub);
      form.appendChild(el('button', { class: 'k', type: 'button', onclick: closePanel }, 'Plus tard'));
      p.appendChild(form); focus = pf.input;
    }
    if (focus && !panel.__focused) { panel.__focused = true; setTimeout(function () { try { focus.focus(); } catch (e) { /* ignoré */ } }, 0); }
  }

  function mount() {
    var host = el('div'); host.setAttribute('data-ogs-account', '');
    var sh = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root = el('div'); root.style.setProperty('--c', cfg.color || '#FFB703');
    try { var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); sh.adoptedStyleSheets = [sheet]; }
    catch (e) { sh.appendChild(el('style', { text: CSS })); } // anciens navigateurs
    sh.appendChild(root);
    dot = el('span', { class: 'd' });
    btn = el('button', { class: 'b', type: 'button', onclick: function () { openPanel(); } }, iconUser(), dot);
    root.appendChild(btn); place(); paint(); if (!wanted) btn.style.display = 'none';
    document.body.appendChild(host);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && canClose()) closePanel(); });
  }

  window.OGSAccount = {
    version: '1.2.0',
    init: function (c) {
      if (cfg) return;
      c = c || {};
      // Contrat simple : getSave() renvoie l'état, applySave(data) l'applique (anciens noms : getState / setState).
      var gs = c.getSave || c.getState, as = c.applySave || c.setState;
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(c.game || '') || typeof gs !== 'function' || typeof as !== 'function') return;
      c.getState = gs; c.setState = as; cfg = c; cfg.apiBase = c.apiBase || API;
      function start() {
        var back = handleReturn();
        mount(); lastHash = hash(cfg.getState());
        // Session détectée au chargement (cookie multidomaine, fetch avec credentials) : restauration automatique, sans bouton.
        api('GET', '/v1/me').then(function (r) {
          if (r.status === 200) { user = r.json.pseudo; me = r.json; setStatus({ kind: 'sync' }); view = 'account'; if (back) openPanel(); return sync(); }
          return loadProviders().then(function () { if (back) openPanel(); });
        }, function () { /* hors ligne : le jeu continue en local */ });
        setInterval(tick, 5000);
        document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); else if (user) sync(); });
        window.addEventListener('pagehide', flush);
      }
      if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    },
    /** Optionnel : à appeler après un changement important pour sauvegarder sans attendre. */
    /** Optionnel : cache ou montre le bouton selon l'écran du jeu (la synchronisation continue). */
    show: function (on) { wanted = on !== false; if (btn) btn.style.display = wanted ? '' : 'none'; if (!wanted && panel && canClose()) closePanel(); },
    notifyChange: function () { if (cfg && user) tick(); },
    sync: sync
  };
})();
