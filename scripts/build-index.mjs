// Génère data/index.json à partir de data/bank/<theme>/<niveau>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEVELS = [
  ['cp', 'CP', 'primaire'], ['ce1', 'CE1', 'primaire'], ['ce2', 'CE2', 'primaire'], ['cm1', 'CM1', 'primaire'], ['cm2', 'CM2', 'primaire'],
  ['6e', '6e', 'college'], ['5e', '5e', 'college'], ['4e', '4e', 'college'], ['3e', '3e', 'college'],
  ['2nde', 'Seconde', 'lycee'], ['1ere', 'Première', 'lycee'], ['term', 'Terminale', 'lycee'],
];
export const THEMES = [
  ['maths', 'Maths'], ['francais', 'Français'], ['histoire', 'Histoire'], ['geographie', 'Géographie'], ['sciences', 'Sciences et vie'],
  ['physique-chimie', 'Physique-chimie'], ['anglais', 'Anglais'], ['culture-generale', 'Culture générale'], ['arts', 'Arts'],
  ['sport', 'Sport'], ['numerique', 'Numérique'], ['emc', 'Citoyenneté (EMC)'],
];

export function buildIndex(root) {
  const bank = path.join(root, 'data/bank');
  return {
    levels: LEVELS.map(([id, name, group]) => ({ id, name, group })),
    themes: THEMES.map(([id, name]) => {
      const counts = {};
      for (const [lv] of LEVELS) {
        const f = path.join(bank, id, `${lv}.json`);
        if (fs.existsSync(f)) counts[lv] = JSON.parse(fs.readFileSync(f, 'utf8')).length;
      }
      return { id, name, counts };
    }).filter((t) => Object.keys(t.counts).length),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  fs.writeFileSync(path.join(root, 'data/index.json'), JSON.stringify(buildIndex(root)) + '\n');
  console.log('data/index.json écrit');
}
