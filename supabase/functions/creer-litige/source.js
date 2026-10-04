// @ts-nocheck
// =====================================================================
// Fonction serveur « creer-litige »
// Appelée par la page du diagnostic une fois l'utilisateur connecté.
// 1. Vérifie l'identité de l'utilisateur (jeton de connexion).
// 2. Valide strictement les réponses reçues.
// 3. Recalcule le diagnostic côté serveur (on ne fait jamais confiance au navigateur).
// 4. Enregistre le profil, le litige, les débits et une trace dans le journal.
// Le moteur du diagnostic est inséré automatiquement par outils/construire-fonctions.mjs.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

/*__MOTEUR__*/

const ORIGINES_AUTORISEES = ['https://reprendr.fr', 'https://www.reprendr.fr', 'http://localhost:8000'];
const MAX_LITIGES_OUVERTS = 10;
const MAX_DEBITS = 60;

function entetesCors(origine) {
  const autorisee = ORIGINES_AUTORISEES.includes(origine) || /^https:\/\/[a-z0-9-]+\.(pages\.dev|netlify\.app)$/.test(origine || '');
  return {
    'Access-Control-Allow-Origin': autorisee ? origine : ORIGINES_AUTORISEES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const reponse = (corps, statut, cors) => new Response(JSON.stringify(corps), { status: statut, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- Validation stricte des entrées ----------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const choix = (v, liste, defaut) => (liste.includes(v) ? v : defaut);
const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v) => (typeof v === 'string' && DATE.test(v) && !isNaN(Date.parse(v)) ? v : null);
const bool = (v) => v === true;

function nettoyer(b) {
  const r = b?.reponses || {};
  const d = r.demarches || {};
  const res = r.resiliation || {};
  const debits = (Array.isArray(r.debits) ? r.debits : []).slice(0, MAX_DEBITS)
    .map(x => ({ date: date(x?.date), montant: Math.round(Number(x?.montant) * 100) / 100 }))
    .filter(x => x.date && Number.isFinite(x.montant) && x.montant > 0 && x.montant < 100000);
  return {
    profil: { prenom: texte(b?.profil?.prenom, 80), nom: texte(b?.profil?.nom, 80) },
    entreprise_nom: texte(r.entreprise_nom, 160),
    circonstances: texte(r.circonstances, 3000),
    reponses: {
      type_litige: choix(r.type_litige, ['souscription_cachee', 'service_non_commande', 'resiliation_refusee', 'frais_non_autorises'], null),
      secteur: choix(r.secteur, ['general', 'assurance', 'telecom', 'energie', 'banque', 'autre'], 'general'),
      moyen_paiement: choix(r.moyen_paiement, ['prelevement_sepa', 'carte', 'autre', 'inconnu'], 'inconnu'),
      autorisation: choix(r.autorisation, ['aucune', 'piegee', 'donnee', 'inconnue'], 'inconnue'),
      debits,
      contrat_en_ligne: bool(r.contrat_en_ligne),
      date_souscription: date(r.date_souscription),
      information_retractation: choix(r.information_retractation, ['oui', 'non', 'ne_sait_pas'], 'ne_sait_pas'),
      date_debut_contrat: date(r.date_debut_contrat),
      type_assurance: choix(r.type_assurance, ['auto', 'habitation', 'affinitaire', 'sante', 'emprunteur', 'autre'], null),
      prelevements_en_cours: bool(r.prelevements_en_cours),
      resiliation: {
        date_demande: date(res.date_demande),
        canal: choix(res.canal, ['email', 'courrier', 'formulaire', 'telephone'], null),
        reconduction_sans_information: bool(res.reconduction_sans_information),
      },
      demarches: {
        contact_oral: bool(d.contact_oral),
        reclamation_ecrite: bool(d.reclamation_ecrite),
        date_reclamation: date(d.date_reclamation),
        reponse: choix(d.reponse, ['aucune', 'refus', 'evasive', 'partielle'], 'aucune'),
        ecrit_trace: d.ecrit_trace === false ? false : true,
        mise_en_demeure_envoyee: bool(d.mise_en_demeure_envoyee),
        date_mise_en_demeure: date(d.date_mise_en_demeure),
      },
    },
  };
}

const aujourdhuiParis = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const versEtape = (p) => ({ attente_reclamation: 'relance', attente_mise_en_demeure: 'mediation' }[p] || p);

Deno.serve(async (req) => {
  const cors = entetesCors(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reponse({ erreur: 'Méthode non autorisée.' }, 405, cors);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    // 1. Identité
    const jeton = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: errAuth } = await admin.auth.getUser(jeton);
    if (errAuth || !auth?.user) return reponse({ erreur: 'Connexion requise. Reconnectez-vous puis réessayez.' }, 401, cors);
    const userId = auth.user.id;

    // 2. Validation
    let corps;
    try { corps = await req.json(); } catch { return reponse({ erreur: 'Requête illisible.' }, 400, cors); }
    const e = nettoyer(corps);
    if (!e.reponses.type_litige) return reponse({ erreur: 'Le type de litige est manquant.' }, 400, cors);
    if (!e.entreprise_nom) return reponse({ erreur: 'Le nom de l\'entreprise est manquant.' }, 400, cors);

    // Limite anti-abus
    const { count } = await admin.from('litiges').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('etat', 'in', '(clos,hors_perimetre)');
    if ((count || 0) >= MAX_LITIGES_OUVERTS) return reponse({ erreur: `Vous avez déjà ${MAX_LITIGES_OUVERTS} dossiers en cours.` }, 429, cors);

    // 3. Diagnostic recalculé côté serveur
    const aujourdhui = aujourdhuiParis();
    const bilan = diagnostiquer(e.reponses, aujourdhui);
    if (!bilan.dans_le_perimetre) return reponse({ erreur: 'Ce dossier sort du périmètre de Reprendr.', bilan }, 422, cors);

    // 4. Enregistrement
    if (e.profil.prenom || e.profil.nom) {
      await admin.from('profils').update({ prenom: e.profil.prenom || null, nom: e.profil.nom || null }).eq('id', userId);
    }
    const r = e.reponses;
    const { data: litige, error: errLitige } = await admin.from('litiges').insert({
      user_id: userId,
      type_litige: r.type_litige,
      moyen_paiement: r.moyen_paiement,
      autorisation: r.autorisation,
      entreprise_nom: e.entreprise_nom,
      circonstances: e.circonstances || null,
      date_souscription: r.date_souscription,
      deja_reclame_par_ecrit: r.demarches.reclamation_ecrite,
      date_reclamation_utilisateur: r.demarches.date_reclamation,
      montant_reclame: bilan.montant_total,
      point_entree: versEtape(bilan.point_entree),
      etat: 'diagnostic',
    }).select('id, reference').single();
    if (errLitige) throw errLitige;

    if (bilan.debits_retenus.length) {
      const { error: errDebits } = await admin.from('debits').insert(
        bilan.debits_retenus.map(d => ({ litige_id: litige.id, date_debit: d.date, montant: d.montant })));
      if (errDebits) throw errDebits;
    }
    await admin.from('journal').insert({ litige_id: litige.id, evenement: 'litige_cree',
      details: { version_regles: bilan.version_regles, point_entree: bilan.point_entree, formule: bilan.formule,
        voie_bancaire: bilan.voie_bancaire.modele, fondements: bilan.fondements, reponses: r } });

    return reponse({ litige_id: litige.id, reference: litige.reference, bilan }, 201, cors);
  } catch (err) {
    console.error('creer-litige', err);
    return reponse({ erreur: 'Une erreur technique empêche la création du dossier. Réessayez dans quelques minutes.' }, 500, cors);
  }
});
