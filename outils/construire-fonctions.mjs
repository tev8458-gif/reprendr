// Construit les fichiers index.ts des fonctions serveur en y insérant le moteur du diagnostic.
// Usage : node outils/construire-fonctions.mjs
// Source unique du moteur : moteur/diagnostic.js. Ne jamais modifier index.ts à la main.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
const moteur = readFileSync('moteur/diagnostic.js', 'utf8').replace(/^export /gm, '');
for (const nom of readdirSync('supabase/functions')) {
  const src = `supabase/functions/${nom}/source.js`;
  if (!existsSync(src)) continue;
  const code = readFileSync(src, 'utf8');
  const sortie = '// FICHIER GÉNÉRÉ – modifier source.js puis relancer outils/construire-fonctions.mjs\n' +
    code.replace('/*__MOTEUR__*/', '// ----- Moteur du diagnostic (copie de moteur/diagnostic.js) -----\n' + moteur);
  writeFileSync(`supabase/functions/${nom}/index.ts`, sortie);
  console.log('construit :', `supabase/functions/${nom}/index.ts`);
}
