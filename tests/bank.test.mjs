import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, LEVELS, THEMES } from '../scripts/build-index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idx = buildIndex(root);
const lv = new Set(LEVELS.map((l) => l[0]));
const norm = (s) => s.trim().toLowerCase();

describe('banque de questions', () => {
  it('index.json est à jour', () => {
    expect(JSON.parse(fs.readFileSync(path.join(root, 'data/index.json'), 'utf8'))).toEqual(idx);
  });
  it('aucun fichier hors thème/niveau connus', () => {
    const ids = new Set(THEMES.map((t) => t[0]));
    for (const t of fs.readdirSync(path.join(root, 'data/bank'))) {
      expect(ids.has(t), t).toBe(true);
      for (const f of fs.readdirSync(path.join(root, 'data/bank', t))) expect(lv.has(f.replace(/\.json$/, '')), `${t}/${f}`).toBe(true);
    }
  });
  for (const t of idx.themes) {
    describe(t.id, () => {
      const all = new Set();
      for (const l of Object.keys(t.counts)) {
        it(`${l} : 30+ questions valides, sans doublon`, () => {
          const a = JSON.parse(fs.readFileSync(path.join(root, 'data/bank', t.id, `${l}.json`), 'utf8'));
          expect(a.length).toBeGreaterThanOrEqual(30);
          const seen = new Set();
          a.forEach((x, i) => {
            const p = `${t.id}/${l}#${i}`;
            expect(typeof x.q === 'string' && x.q.length > 0 && x.q.length <= 200, p + ' q').toBe(true);
            expect(Array.isArray(x.a) && x.a.length === 4, p + ' 4 choix').toBe(true);
            expect(new Set(x.a.map(norm)).size, p + ' choix distincts').toBe(4);
            expect(x.a.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 60), p + ' longueur').toBe(true);
            expect([0, 1, 2, 3].includes(x.c), p + ' c').toBe(true);
            expect(seen.has(norm(x.q)), p + ' doublon').toBe(false);
            seen.add(norm(x.q));
            expect(all.has(norm(x.q)), p + ' doublon entre niveaux').toBe(false);
            all.add(norm(x.q));
          });
        });
      }
    });
  }
});
