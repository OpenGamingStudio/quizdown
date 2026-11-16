// Chargement de la banque de questions : <BANK_DIR>/<theme>/<niveau>.json = [{q, a:[4], c}]
// La banque peut ne pas exister : le serveur démarre quand même (banque vide).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BANK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/bank');

const ID_RE = /^[a-z0-9_-]{1,40}$/i;

function validQuestion(x) {
  return (
    x && typeof x === 'object' &&
    typeof x.q === 'string' && x.q.length > 0 && x.q.length <= 300 &&
    Array.isArray(x.a) && x.a.length === 4 &&
    x.a.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200) &&
    new Set(x.a).size === 4 &&
    Number.isInteger(x.c) && x.c >= 0 && x.c <= 3
  );
}

/** Construit une banque à partir d'une table { theme: { niveau: [questions] } }. */
export function makeBank(table) {
  const themes = Object.keys(table).sort();
  const levelSet = new Set();
  let size = 0;
  for (const t of themes) {
    for (const l of Object.keys(table[t])) {
      levelSet.add(l);
      size += table[t][l].length;
    }
  }
  const levels = [...levelSet].sort();
  return {
    themes,
    levels,
    size,
    empty: size === 0,
    /** Questions des couples thème x niveau choisis, sans doublon de texte. */
    pool(themeIds, levelIds) {
      const seen = new Set();
      const out = [];
      for (const t of themeIds) {
        const lv = Object.prototype.hasOwnProperty.call(table, t) ? table[t] : null;
        if (!lv) continue;
        for (const l of levelIds) {
          if (!Object.prototype.hasOwnProperty.call(lv, l)) continue;
          for (const x of lv[l]) {
            if (seen.has(x.q)) continue;
            seen.add(x.q);
            out.push({ q: x.q, a: x.a, c: x.c, theme: t, level: l });
          }
        }
      }
      return out;
    },
  };
}

export function loadBank(dir = process.env.BANK_DIR || DEFAULT_BANK_DIR) {
  const table = {};
  let themeDirs = [];
  try {
    themeDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && ID_RE.test(d.name));
  } catch {
    return makeBank(table);
  }
  for (const td of themeDirs) {
    const levels = {};
    let files = [];
    try {
      files = fs.readdirSync(path.join(dir, td.name)).filter((f) => f.endsWith('.json') && ID_RE.test(f.slice(0, -5)));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, td.name, f), 'utf8'));
        if (!Array.isArray(data)) continue;
        const ok = data.filter(validQuestion);
        if (ok.length) levels[f.slice(0, -5)] = ok;
      } catch {
        // fichier illisible ou JSON invalide : ignoré
      }
    }
    if (Object.keys(levels).length) table[td.name] = levels;
  }
  return makeBank(table);
}
