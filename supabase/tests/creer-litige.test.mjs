// Tests de la fonction creer-litige avec un Supabase simulé – lancer depuis la racine : node supabase/tests/creer-litige.test.mjs
let handler; const inserts = []; let litigesOuverts = 0;
globalThis.Deno = { serve(h) { handler = h; }, env: { get: () => 'x' } };
const q = (table) => {
  const o = { _t: table,
    select(_c, opt) { this._count = opt?.count; return this; }, eq() { return this; }, not() { return this; },
    update(v) { inserts.push(['update', table, v]); return this; },
    insert(v) { inserts.push(['insert', table, v]); return this; },
    single() { return Promise.resolve({ data: { id: 'L1', reference: 'RPR-2026-TEST01' }, error: null }); },
    then(res) { return Promise.resolve(this._count ? { count: litigesOuverts } : { error: null }).then(res); } };
  return o; };
globalThis.__client = { auth: { getUser: async (t) => t === 'bon' ? { data: { user: { id: 'U1' } } } : { error: 'x', data: {} } }, from: q };
const src = (await import('node:fs')).readFileSync('supabase/functions/creer-litige/index.ts', 'utf8')
  .replace("import { createClient } from 'npm:@supabase/supabase-js@2';", 'const createClient = () => globalThis.__client;');
await import('data:text/javascript,' + encodeURIComponent(src));
const appel = async (jeton, corps, origine = 'https://reprendr.fr') => {
  const r = await handler(new Request('https://f', { method: 'POST', headers: { Authorization: 'Bearer ' + jeton, Origin: origine }, body: JSON.stringify(corps) }));
  return { statut: r.status, corps: await r.json(), cors: r.headers.get('Access-Control-Allow-Origin') }; };
const bon = { profil: { prenom: 'Marie', nom: 'Dupont' }, reponses: { type_litige: 'souscription_cachee', entreprise_nom: 'Société X', moyen_paiement: 'prelevement_sepa', autorisation: 'aucune', contrat_en_ligne: true, debits: [{ date: '2026-09-05', montant: '12.99' }, { date: 'n\'importe', montant: 5 }, { date: '2026-08-05', montant: -3 }], demarches: {} } };
const t = (n, c) => console.log((c ? '  ✔ ' : '  ✘ ') + n);
let r = await appel('mauvais', bon); t('Sans connexion valide : 401', r.statut === 401);
r = await appel('bon', { reponses: { entreprise_nom: 'X' } }); t('Type de litige manquant : 400', r.statut === 400);
r = await appel('bon', { ...bon, reponses: { ...bon.reponses, secteur: 'assurance' } }); t('Hors périmètre : 422 avec bilan', r.statut === 422 && r.corps.bilan.orientation === 'mediateur_sectoriel');
litigesOuverts = 10; r = await appel('bon', bon); t('Limite de 10 dossiers en cours : 429', r.statut === 429); litigesOuverts = 0;
inserts.length = 0; r = await appel('bon', bon);
t('Dossier valide : 201 avec référence', r.statut === 201 && r.corps.reference === 'RPR-2026-TEST01');
const debits = inserts.find(i => i[1] === 'debits')?.[2] || [];
t('Débits invalides écartés (1 seul retenu sur 3)', debits.length === 1 && debits[0].montant === 12.99);
const lit = inserts.find(i => i[1] === 'litiges')[2];
t('Litige enregistré avec user_id du jeton et point d\'entrée « reclamation »', lit.user_id === 'U1' && lit.point_entree === 'reclamation' && lit.montant_reclame === 12.99);
t('Trace dans le journal', inserts.some(i => i[1] === 'journal'));
r = await appel('bon', bon, 'https://site-pirate.com'); t('Origine inconnue : en-tête CORS non accordé', r.cors === 'https://reprendr.fr');
