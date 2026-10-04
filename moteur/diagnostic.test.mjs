// Cas types du diagnostic – lancer avec : node moteur/diagnostic.test.mjs
import assert from 'node:assert/strict';
import { diagnostiquer, REGLES } from './diagnostic.js';

const J = '2026-10-03'; // date du jour fixe pour les tests
let ok = 0, ko = 0;
function cas(nom, fn) { try { fn(); ok++; console.log('  ✔ ' + nom); } catch (e) { ko++; console.log('  ✘ ' + nom + '\n     ' + e.message); } }
const base = (x = {}) => ({ type_litige: 'souscription_cachee', secteur: 'general', moyen_paiement: 'prelevement_sepa',
  autorisation: 'aucune', debits: [{ date: '2026-09-05', montant: 12.99 }, { date: '2026-08-05', montant: 12.99 }],
  contrat_en_ligne: true, demarches: {}, ...x });

console.log('\nPérimètre');
cas('Secteur banque : hors périmètre, orientation médiateur sectoriel', () => {
  const b = diagnostiquer(base({ secteur: 'banque' }), J);
  assert.equal(b.dans_le_perimetre, false); assert.equal(b.orientation, 'mediateur_sectoriel'); });
cas('Secteurs assurance, énergie et télécoms : dans le périmètre', () => {
  for (const secteur of ['assurance', 'energie', 'telecom']) assert.equal(diagnostiquer(base({ secteur }), J).dans_le_perimetre, true); });
cas('Montant supérieur à 5 000 € : orientation avocat', () => {
  const b = diagnostiquer(base({ debits: [{ date: '2026-09-01', montant: 5200 }] }), J);
  assert.equal(b.orientation, 'avocat'); });
cas('Tous les débits de plus de 5 ans : prescription', () => {
  const b = diagnostiquer(base({ debits: [{ date: '2020-01-10', montant: 20 }] }), J);
  assert.equal(b.orientation, 'prescription'); });
cas('Débits mixtes : les plus de 5 ans sont exclus du montant', () => {
  const b = diagnostiquer(base({ debits: [{ date: '2020-01-10', montant: 20 }, { date: '2026-09-10', montant: 10 }] }), J);
  assert.equal(b.dans_le_perimetre, true); assert.equal(b.montant_total, 10); assert.equal(b.debits_prescrits.length, 1); });
cas('Résiliation jamais demandée : il faut d\'abord résilier', () => {
  const b = diagnostiquer(base({ type_litige: 'resiliation_refusee', resiliation: {} }), J);
  assert.equal(b.orientation, 'resilier_d_abord'); });
cas('Aucun débit indiqué : hors périmètre', () => {
  assert.equal(diagnostiquer(base({ debits: [] }), J).orientation, 'aucun_debit'); });

console.log('\nVoie bancaire');
cas('SEPA non autorisé, débits récents : C1, date limite = plus ancien débit + 13 mois', () => {
  const b = diagnostiquer(base(), J);
  assert.equal(b.voie_bancaire.modele, 'C1'); assert.equal(b.voie_bancaire.date_limite, '2027-09-05'); assert.equal(b.voie_bancaire.montant, 25.98); });
cas('Carte non autorisée : C1 également', () => {
  assert.equal(diagnostiquer(base({ moyen_paiement: 'carte' }), J).voie_bancaire.modele, 'C1'); });
cas('Non autorisé mais débit de plus de 13 mois : exclu de la voie bancaire', () => {
  const b = diagnostiquer(base({ debits: [{ date: '2025-08-01', montant: 15 }, { date: '2026-09-01', montant: 15 }] }), J);
  assert.equal(b.voie_bancaire.debits.length, 1); assert.equal(b.montant_total, 30); });
cas('SEPA avec case piégée : C2, seulement les débits de moins de 8 semaines', () => {
  const b = diagnostiquer(base({ autorisation: 'piegee' }), J);
  assert.equal(b.voie_bancaire.modele, 'C2'); assert.equal(b.voie_bancaire.debits.length, 1); assert.equal(b.voie_bancaire.date_limite, '2026-10-31'); });
cas('Limite exacte des 8 semaines (56 jours) : encore éligible', () => {
  const b = diagnostiquer(base({ autorisation: 'donnee', debits: [{ date: '2026-08-08', montant: 9 }] }), J);
  assert.equal(b.voie_bancaire.ouverte, true); });
cas('57 jours : plus éligible', () => {
  const b = diagnostiquer(base({ autorisation: 'donnee', debits: [{ date: '2026-08-07', montant: 9 }] }), J);
  assert.equal(b.voie_bancaire.ouverte, false); });
cas('Carte avec autorisation donnée : pas de voie bancaire, conseil de blocage', () => {
  const b = diagnostiquer(base({ moyen_paiement: 'carte', autorisation: 'donnee' }), J);
  assert.equal(b.voie_bancaire.ouverte, false); assert.ok(b.conseils.some(c => c.includes('bloquer'))); });
cas('Échéance bancaire proche : alerte urgente', () => {
  const b = diagnostiquer(base({ autorisation: 'piegee', debits: [{ date: '2026-08-20', montant: 9 }] }), J);
  assert.ok(b.alertes.some(a => a.startsWith('Urgent'))); });
cas('Virement ou autre moyen : pas de voie bancaire', () => {
  assert.equal(diagnostiquer(base({ moyen_paiement: 'autre' }), J).voie_bancaire.ouverte, false); });

console.log('\nRétractation');
cas('Souscription il y a 10 jours : rétractation ouverte, 14 jours', () => {
  const b = diagnostiquer(base({ date_souscription: '2026-09-23' }), J);
  assert.equal(b.retractation.ouverte, true); assert.equal(b.retractation.date_limite, '2026-10-07'); assert.ok(b.fondements.includes('A1-retractation')); });
cas('Souscription il y a 3 mois, information fournie : rétractation fermée', () => {
  const b = diagnostiquer(base({ date_souscription: '2026-07-01', information_retractation: 'oui' }), J);
  assert.equal(b.retractation.ouverte, false); assert.ok(!b.fondements.includes('A1-retractation')); });
cas('Souscription il y a 3 mois, information non fournie : délai prolongé de 12 mois', () => {
  const b = diagnostiquer(base({ date_souscription: '2026-07-01', information_retractation: 'non' }), J);
  assert.equal(b.retractation.prolongee, true); assert.equal(b.retractation.date_limite, '2027-07-15'); assert.equal(b.retractation.ouverte, true); });
cas('Contrat hors ligne : pas de rétractation à distance', () => {
  assert.equal(diagnostiquer(base({ contrat_en_ligne: false, date_souscription: '2026-09-30' }), J).retractation.applicable, false); });

console.log('\nPoint d\'entrée et prix');
cas('Rien fait : réclamation, formule complète, 51,60 € maximum', () => {
  const b = diagnostiquer(base(), J);
  assert.equal(b.point_entree, 'reclamation'); assert.equal(b.formule, 'complete'); assert.equal(b.prix_maximum, 51.6); });
cas('Seulement un appel téléphonique : réclamation, justification explicite', () => {
  const b = diagnostiquer(base({ demarches: { contact_oral: true } }), J);
  assert.equal(b.point_entree, 'reclamation'); assert.ok(b.justifications.some(j => j.parce_que.includes('trace écrite'))); });
cas('Réclamation écrite il y a 5 jours : attente', () => {
  assert.equal(diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2026-09-28', reponse: 'aucune' } }), J).point_entree, 'attente_reclamation'); });
cas('Réclamation il y a 20 jours sans réponse : relance conseillée, MED + médiation 29,80 €', () => {
  const b = diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2026-09-13', reponse: 'aucune' } }), J);
  assert.equal(b.point_entree, 'relance'); assert.equal(b.prix_maximum, 29.8); assert.ok(b.options[0].conseillee); });
cas('Réclamation il y a 45 jours sans réponse : mise en demeure directe', () => {
  assert.equal(diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2026-08-19', reponse: 'aucune' } }), J).point_entree, 'mise_en_demeure'); });
cas('Refus écrit de l\'entreprise : mise en demeure', () => {
  assert.equal(diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2026-09-30', reponse: 'refus' } }), J).point_entree, 'mise_en_demeure'); });
cas('Réponse partielle après 45 jours : relance', () => {
  assert.equal(diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2026-08-19', reponse: 'partielle' } }), J).point_entree, 'relance'); });
cas('Mise en demeure envoyée il y a 20 jours : médiation, 9,90 €', () => {
  const b = diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2026-08-01', mise_en_demeure_envoyee: true, date_mise_en_demeure: '2026-09-13' } }), J);
  assert.equal(b.point_entree, 'mediation'); assert.equal(b.prix_maximum, 9.9); });
cas('Mise en demeure envoyée il y a 5 jours : attente', () => {
  assert.equal(diagnostiquer(base({ demarches: { mise_en_demeure_envoyee: true, date_mise_en_demeure: '2026-09-28' } }), J).point_entree, 'attente_mise_en_demeure'); });
cas('Réclamation de plus d\'un an : avertissement sur la médiation', () => {
  const b = diagnostiquer(base({ demarches: { reclamation_ecrite: true, date_reclamation: '2025-09-01', reponse: 'aucune' } }), J);
  assert.ok(b.points_faibles.some(p => p.includes('plus d\'un an'))); });

console.log('\nFondements');
cas('Résiliation refusée, demande écrite, contrat en ligne : A3, A3a, A3a-en-ligne', () => {
  const b = diagnostiquer(base({ type_litige: 'resiliation_refusee', resiliation: { date_demande: '2026-07-01', canal: 'email' } }), J);
  assert.deepEqual(b.fondements, ['A3', 'A3a', 'A3a-en-ligne']); });
cas('Résiliation demandée par téléphone : point faible signalé', () => {
  const b = diagnostiquer(base({ type_litige: 'resiliation_refusee', resiliation: { date_demande: '2026-07-01', canal: 'telephone' } }), J);
  assert.ok(b.points_faibles.some(p => p.includes('téléphone'))); });
cas('Reconduction sans information : A3b', () => {
  assert.ok(diagnostiquer(base({ type_litige: 'resiliation_refusee', resiliation: { reconduction_sans_information: true } }), J).fondements.includes('A3b')); });
cas('Service non commandé : A2 ; frais non autorisés : A4', () => {
  assert.deepEqual(diagnostiquer(base({ type_litige: 'service_non_commande' }), J).fondements, ['A2']);
  assert.deepEqual(diagnostiquer(base({ type_litige: 'frais_non_autorises' }), J).fondements, ['A4']); });

console.log('\nSecteurs');
const resil = (x) => base({ type_litige: 'resiliation_refusee', resiliation: { date_demande: '2026-08-01', canal: 'email' }, ...x });
cas('Énergie : résiliation à tout moment (A3-energie), médiateur national de l\'énergie', () => {
  const b = diagnostiquer(resil({ secteur: 'energie' }), J);
  assert.ok(b.fondements.includes('A3-energie')); assert.ok(b.mediateur.includes('énergie')); });
cas('Assurance habitation de plus d\'un an : loi Hamon', () => {
  const b = diagnostiquer(resil({ secteur: 'assurance', type_assurance: 'habitation', date_debut_contrat: '2024-05-01' }), J);
  assert.ok(b.fondements.includes('A3-assurance-hamon')); assert.ok(b.mediateur.includes('Assurance')); });
cas('Assurance auto de moins d\'un an : pas de Hamon, point faible', () => {
  const b = diagnostiquer(resil({ secteur: 'assurance', type_assurance: 'auto', date_debut_contrat: '2026-03-01' }), J);
  assert.ok(!b.fondements.includes('A3-assurance-hamon')); assert.ok(b.points_faibles.some(p => p.includes('moins d\'un an'))); });
cas('Assurance : limite exacte d\'un an, Hamon ouvert', () => {
  assert.ok(diagnostiquer(resil({ secteur: 'assurance', type_assurance: 'auto', date_debut_contrat: '2025-10-03' }), J).fondements.includes('A3-assurance-hamon')); });
cas('Assurance emprunteur : résiliation à tout moment, quelle que soit l\'ancienneté', () => {
  assert.ok(diagnostiquer(resil({ secteur: 'assurance', type_assurance: 'emprunteur', date_debut_contrat: '2026-09-01' }), J).fondements.includes('A3-assurance-emprunteur')); });
cas('Assurance sans date de début : point faible', () => {
  assert.ok(diagnostiquer(resil({ secteur: 'assurance', type_assurance: 'auto' }), J).points_faibles.some(p => p.includes('date de début'))); });
cas('Assurance : reconduction sans information → A3b-assurance', () => {
  const b = diagnostiquer(base({ type_litige: 'resiliation_refusee', secteur: 'assurance', type_assurance: 'autre', resiliation: { reconduction_sans_information: true } }), J);
  assert.ok(b.fondements.includes('A3b-assurance')); assert.ok(!b.fondements.includes('A3b')); });
cas('Télécoms de plus de 12 mois : frais plafonnés (A3-telecom)', () => {
  assert.ok(diagnostiquer(resil({ secteur: 'telecom', date_debut_contrat: '2025-01-15' }), J).fondements.includes('A3-telecom')); });
cas('Télécoms de moins de 12 mois : point faible sur les mensualités restantes', () => {
  const b = diagnostiquer(resil({ secteur: 'telecom', date_debut_contrat: '2026-02-01' }), J);
  assert.ok(!b.fondements.includes('A3-telecom')); assert.ok(b.points_faibles.some(p => p.includes('mensualités'))); });
cas('Secteur général : médiateur de la consommation de l\'entreprise', () => {
  assert.ok(diagnostiquer(base(), J).mediateur.includes('désigné par l\'entreprise')); });

console.log('\nCohérence');
cas('Chaque bilan dans le périmètre contient des justifications et aucun pourcentage', () => {
  const b = diagnostiquer(base(), J);
  assert.ok(b.justifications.length >= 2); assert.ok(!JSON.stringify(b).includes('%')); });
cas('Date de débit dans le futur ignorée', () => {
  assert.equal(diagnostiquer(base({ debits: [{ date: '2026-12-01', montant: 50 }, { date: '2026-09-01', montant: 10 }] }), J).montant_total, 10); });

console.log(`\n${ok} réussi(s), ${ko} échec(s) – règles version ${REGLES.version}\n`);
process.exit(ko ? 1 : 0);
