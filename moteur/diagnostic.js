// =====================================================================
// Reprendr. v2 – Moteur du diagnostic (prélèvements et abonnements)
// Module autonome : fonctionne dans le navigateur et dans les fonctions
// serveur (Deno). Aucune dépendance.
//
// Principe : des règles écrites, pas de score. Chaque conclusion est
// accompagnée de sa justification. Toutes les valeurs juridiques sont
// regroupées dans REGLES, à faire valider par l'avocat.
// =====================================================================

export const REGLES = {
  version: '2026-10-v2',
  // Voie bancaire
  banque_non_autorise_mois: 13,     // opération non autorisée (C. mon. fin.)
  banque_sepa_autorise_jours: 56,   // prélèvement SEPA autorisé : 8 semaines
  // Rétractation (contrats à distance)
  retractation_jours: 14,
  retractation_prolongation_mois: 12, // si l'information n'a pas été fournie
  // Prescription (à valider : 5 ans selon nous)
  prescription_ans: 5,
  // Parcours
  delai_reclamation_jours: 15,      // délai laissé à l'entreprise
  seuil_mise_en_demeure_directe_jours: 30, // réclamation sans réponse depuis plus longtemps
  delai_mise_en_demeure_jours: 15,
  mediation_max_mois: 12,           // saisine dans l'année suivant la réclamation écrite
  // Périmètre
  seuil_orientation_avocat: 5000,
  secteurs_hors_perimetre: ['banque'],
  // Résiliation sectorielle (à valider)
  assurance_hamon_mois: 12,          // résiliation à tout moment après un an (assurances concernées)
  assurance_hamon_types: ['auto', 'habitation', 'affinitaire', 'sante'],
  telecom_engagement_mois: 12,       // au-delà, frais plafonnés au quart des mensualités restantes
  // Alertes d'urgence
  alerte_banque_jours: 21,
  alerte_retractation_jours: 7,
  // Prix TTC par étape
  prix: { reclamation: 11.90, relance: 9.90, mise_en_demeure: 19.90, mediation: 9.90 },
};

// Libellés lisibles des secteurs
const MEDIATEURS = {
  energie: 'le Médiateur national de l\'énergie',
  telecom: 'le Médiateur des communications électroniques',
  assurance: 'La Médiation de l\'Assurance',
};
const SECTEURS = { assurance: 'd\'assurance', telecom: 'de téléphonie et d\'internet', energie: 'd\'électricité et de gaz', banque: 'bancaires' };

// ---------- Outils de dates (format 'AAAA-MM-JJ', calcul en UTC) ----------
const versDate = (s) => { const [a, m, j] = s.split('-').map(Number); return new Date(Date.UTC(a, m - 1, j)); };
const versTexte = (d) => d.toISOString().slice(0, 10);
const ajouterJours = (s, n) => { const d = versDate(s); d.setUTCDate(d.getUTCDate() + n); return versTexte(d); };
const ajouterMois = (s, n) => {
  const d = versDate(s); const jour = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(jour, dernier)); return versTexte(d);
};
const joursEntre = (a, b) => Math.round((versDate(b) - versDate(a)) / 86400000);
const dateFr = (s) => { const [a, m, j] = s.split('-'); return `${j}/${m}/${a}`; };
const euros = (n) => n.toFixed(2).replace('.', ',') + ' €';
const arrondi = (n) => Math.round(n * 100) / 100;

// ---------- Moteur ----------
/**
 * @param {object} r  Réponses du diagnostic (voir docs/DIAGNOSTIC.md)
 * @param {string} aujourdhui  Date du jour 'AAAA-MM-JJ' (paramètre pour les tests)
 */
export function diagnostiquer(r, aujourdhui) {
  const bilan = {
    version_regles: REGLES.version,
    date: aujourdhui,
    dans_le_perimetre: true,
    orientation: null,
    montant_total: 0,
    debits_retenus: [],
    debits_prescrits: [],
    voie_bancaire: { ouverte: false, modele: null, debits: [], montant: 0, date_limite: null },
    retractation: { applicable: false, ouverte: false, prolongee: false, date_limite: null },
    secteur: r.secteur || 'general',
    mediateur: MEDIATEURS[r.secteur] || 'le médiateur de la consommation désigné par l\'entreprise',
    point_entree: null,
    formule: null,
    prix_maximum: 0,
    options: [],
    fondements: [],
    pieces: [],
    points_faibles: [],
    alertes: [],
    conseils: [],
    justifications: [],
  };
  const justifier = (conclusion, parce_que) => bilan.justifications.push({ conclusion, parce_que });
  const horsPerimetre = (orientation, parce_que) => {
    bilan.dans_le_perimetre = false; bilan.orientation = orientation;
    justifier('Ce dossier sort du périmètre de Reprendr.', parce_que);
  };

  // ---- 1. Débits et prescription ----
  const debits = (r.debits || []).filter(d => d && d.date && d.montant > 0 && d.date <= aujourdhui);
  for (const d of debits) {
    const limite = ajouterMois(d.date, REGLES.prescription_ans * 12);
    (aujourdhui <= limite ? bilan.debits_retenus : bilan.debits_prescrits).push(d);
  }
  bilan.montant_total = arrondi(bilan.debits_retenus.reduce((s, d) => s + d.montant, 0));
  if (bilan.debits_prescrits.length) {
    justifier(`${bilan.debits_prescrits.length} débit(s) ne sont pas retenus`,
      `ils datent de plus de ${REGLES.prescription_ans} ans, délai au-delà duquel l'action est en principe prescrite`);
  }

  // ---- 2. Périmètre ----
  if (REGLES.secteurs_hors_perimetre.includes(r.secteur)) {
    bilan.secteur = r.secteur;
    horsPerimetre('mediateur_sectoriel',
      `les contrats ${SECTEURS[r.secteur]} obéissent à des règles spécifiques que Reprendr. ne couvre pas encore`);
  }
  if (debits.length === 0 && r.type_litige !== 'resiliation_refusee') {
    horsPerimetre('aucun_debit', 'aucun débit contesté n\'a été indiqué');
  } else if (debits.length > 0 && bilan.debits_retenus.length === 0) {
    horsPerimetre('prescription', `tous les débits indiqués datent de plus de ${REGLES.prescription_ans} ans`);
  }
  if (bilan.montant_total > REGLES.seuil_orientation_avocat) {
    horsPerimetre('avocat', `le montant en jeu (${euros(bilan.montant_total)}) dépasse ${euros(REGLES.seuil_orientation_avocat)} ; à ce niveau, l'avis d'un avocat est recommandé`);
  }
  if (r.type_litige === 'resiliation_refusee' && !r.resiliation?.date_demande && !r.resiliation?.reconduction_sans_information) {
    horsPerimetre('resilier_d_abord', 'vous n\'avez pas encore demandé la résiliation : il faut d\'abord la demander ; le litige naît si l\'entreprise refuse ou continue de prélever');
  }
  if (!bilan.dans_le_perimetre) return bilan;

  // ---- 3. Voie bancaire ----
  const sepa = r.moyen_paiement === 'prelevement_sepa';
  const carte = r.moyen_paiement === 'carte';
  if ((sepa || carte) && r.autorisation === 'aucune') {
    const eligibles = bilan.debits_retenus.filter(d => aujourdhui <= ajouterMois(d.date, REGLES.banque_non_autorise_mois));
    if (eligibles.length) {
      const plusAncien = eligibles.reduce((a, b) => (a.date < b.date ? a : b));
      Object.assign(bilan.voie_bancaire, { ouverte: true, modele: 'C1', debits: eligibles,
        montant: arrondi(eligibles.reduce((s, d) => s + d.montant, 0)),
        date_limite: ajouterMois(plusAncien.date, REGLES.banque_non_autorise_mois) });
      justifier('Votre banque doit vous rembourser ces opérations',
        `vous indiquez n'avoir jamais autorisé ces paiements et ${eligibles.length} débit(s) datent de moins de ${REGLES.banque_non_autorise_mois} mois`);
    }
  } else if (sepa && ['piegee', 'donnee', 'inconnue'].includes(r.autorisation)) {
    const eligibles = bilan.debits_retenus.filter(d => joursEntre(d.date, aujourdhui) <= REGLES.banque_sepa_autorise_jours);
    if (eligibles.length) {
      const plusAncien = eligibles.reduce((a, b) => (a.date < b.date ? a : b));
      Object.assign(bilan.voie_bancaire, { ouverte: true, modele: 'C2', debits: eligibles,
        montant: arrondi(eligibles.reduce((s, d) => s + d.montant, 0)),
        date_limite: ajouterJours(plusAncien.date, REGLES.banque_sepa_autorise_jours) });
      justifier('Vous pouvez demander à votre banque le remboursement de certains prélèvements',
        `pour un prélèvement SEPA, le remboursement est possible sans justification pendant 8 semaines, et ${eligibles.length} débit(s) sont dans ce délai`);
    }
    if (r.autorisation === 'inconnue') bilan.points_faibles.push('Vous ne savez pas si vous avez donné une autorisation : vérifiez vos emails de confirmation et vos relevés.');
  } else if (carte) {
    bilan.conseils.push('Pour un paiement par carte que vous aviez accepté, la banque n\'est pas tenue de rembourser. Vous pouvez en revanche lui demander de bloquer les paiements futurs à ce commerçant.');
  }
  if (bilan.voie_bancaire.ouverte) {
    const reste = joursEntre(aujourdhui, bilan.voie_bancaire.date_limite);
    if (reste <= REGLES.alerte_banque_jours) bilan.alertes.push(`Urgent : il vous reste ${reste} jour(s) pour agir auprès de votre banque (avant le ${dateFr(bilan.voie_bancaire.date_limite)}).`);
  }
  if (r.prelevements_en_cours) {
    bilan.conseils.push(sepa ? 'Les prélèvements continuent : révoquez le mandat auprès de votre banque pour les bloquer.'
      : 'Les paiements continuent : demandez à votre banque de bloquer les paiements futurs à ce commerçant.');
  }

  // ---- 4. Fondements ----
  if (r.type_litige === 'souscription_cachee') {
    bilan.fondements.push('A1');
    justifier('Le courrier invoque l\'absence de consentement au paiement', 'vous indiquez avoir souscrit cet abonnement sans le savoir lors d\'une commande en ligne');
    if (r.contrat_en_ligne && r.date_souscription) {
      bilan.retractation.applicable = true;
      const prolongee = r.information_retractation === 'non';
      const debut = prolongee ? ajouterMois(r.date_souscription, REGLES.retractation_prolongation_mois) : r.date_souscription;
      const limite = ajouterJours(debut, REGLES.retractation_jours);
      Object.assign(bilan.retractation, { prolongee, date_limite: limite, ouverte: aujourdhui <= limite });
      if (bilan.retractation.ouverte) {
        bilan.fondements.push('A1-retractation');
        justifier('Le courrier exerce aussi votre droit de rétractation',
          prolongee ? 'l\'information sur ce droit ne vous a pas été fournie, ce qui prolonge le délai de 12 mois' : `vous êtes encore dans le délai de ${REGLES.retractation_jours} jours`);
        const reste = joursEntre(aujourdhui, limite);
        if (reste <= REGLES.alerte_retractation_jours) bilan.alertes.push(`Urgent : votre délai de rétractation expire le ${dateFr(limite)}. Envoyez votre réclamation sans attendre.`);
      }
    } else if (!r.date_souscription) {
      bilan.points_faibles.push('La date de souscription est inconnue : elle permettrait de vérifier si le droit de rétractation est encore ouvert.');
    }
  } else if (r.type_litige === 'service_non_commande') {
    bilan.fondements.push('A2');
    justifier('Le courrier invoque l\'interdiction de facturer un service non commandé', 'vous indiquez n\'avoir jamais commandé ce service');
  } else if (r.type_litige === 'resiliation_refusee') {
    bilan.fondements.push('A3');
    if (r.resiliation?.date_demande) {
      bilan.fondements.push('A3a');
      justifier('Le courrier rappelle votre demande de résiliation', `vous avez demandé la résiliation le ${dateFr(r.resiliation.date_demande)}`);
      if (r.contrat_en_ligne) bilan.fondements.push('A3a-en-ligne');
      if (r.resiliation.canal === 'telephone') bilan.points_faibles.push('Votre demande de résiliation a été faite par téléphone : aucune trace écrite ne la prouve.');
    }
    if (r.resiliation?.reconduction_sans_information) {
      bilan.fondements.push(r.secteur === 'assurance' ? 'A3b-assurance' : 'A3b');
      justifier('Le courrier invoque l\'absence d\'information sur la reconduction', 'vous indiquez que votre contrat a été reconduit sans que l\'entreprise vous ait prévenu');
    }
    // Règles sectorielles de résiliation
    const debut = r.date_debut_contrat;
    const anciennete = (mois) => debut && aujourdhui >= ajouterMois(debut, mois);
    if (r.secteur === 'energie') {
      bilan.fondements.push('A3-energie');
      justifier('Le courrier rappelle que vous pouvez résilier à tout moment et sans frais', 'pour un contrat d\'électricité ou de gaz, le particulier peut résilier ou changer de fournisseur à tout moment, sans frais');
    } else if (r.secteur === 'assurance') {
      if (r.type_assurance === 'emprunteur') {
        bilan.fondements.push('A3-assurance-emprunteur');
        justifier('Le courrier rappelle que l\'assurance emprunteur se résilie à tout moment', 'depuis la loi Lemoine, l\'assurance de prêt immobilier peut être résiliée à tout moment, sous réserve d\'une garantie équivalente acceptée par la banque');
      } else if (REGLES.assurance_hamon_types.includes(r.type_assurance) && anciennete(REGLES.assurance_hamon_mois)) {
        bilan.fondements.push('A3-assurance-hamon');
        justifier('Le courrier invoque la résiliation à tout moment (loi Hamon)', 'votre contrat a plus d\'un an et fait partie des assurances que l\'on peut résilier à tout moment, sans frais ; la résiliation prend effet un mois après sa réception');
      } else if (!debut) {
        bilan.points_faibles.push('La date de début du contrat est inconnue : elle détermine si vous pouvez résilier à tout moment (après un an de contrat).');
      } else if (!REGLES.assurance_hamon_types.includes(r.type_assurance)) {
        bilan.points_faibles.push('Ce type d\'assurance ne relève pas de la résiliation à tout moment : la résiliation se fait en principe à l\'échéance annuelle.');
      } else {
        bilan.points_faibles.push('Votre contrat a moins d\'un an : la résiliation à tout moment ne sera possible qu\'après sa première année, sauf à l\'échéance ou en cas de reconduction sans information.');
      }
    } else if (r.secteur === 'telecom') {
      if (anciennete(REGLES.telecom_engagement_mois)) {
        bilan.fondements.push('A3-telecom');
        justifier('Le courrier rappelle le plafonnement des frais de résiliation', 'votre contrat a plus de douze mois : les sommes exigibles sont limitées au quart des mensualités restantes de l\'engagement');
      } else if (!debut) {
        bilan.points_faibles.push('La date de début du contrat est inconnue : elle détermine les frais que l\'opérateur peut réclamer en cas de résiliation.');
      } else {
        bilan.points_faibles.push('Votre contrat a moins de douze mois : l\'opérateur peut en principe réclamer les mensualités restantes jusqu\'à la fin de la première année.');
      }
    }
  } else if (r.type_litige === 'frais_non_autorises') {
    bilan.fondements.push('A4');
    justifier('Le courrier invoque l\'absence de consentement exprès aux frais', 'vous indiquez n\'avoir jamais accepté ces frais ou options');
  }

  // ---- 5. Point d'entrée ----
  const d = r.demarches || {};
  const P = REGLES.prix;
  if (d.mise_en_demeure_envoyee && d.date_mise_en_demeure) {
    const ecoule = joursEntre(d.date_mise_en_demeure, aujourdhui);
    bilan.point_entree = ecoule >= REGLES.delai_mise_en_demeure_jours ? 'mediation' : 'attente_mise_en_demeure';
    justifier('Prochaine étape : la médiation', `vous avez déjà envoyé une mise en demeure le ${dateFr(d.date_mise_en_demeure)}` +
      (ecoule < REGLES.delai_mise_en_demeure_jours ? `, il faut attendre la fin du délai laissé à l'entreprise (${dateFr(ajouterJours(d.date_mise_en_demeure, REGLES.delai_mise_en_demeure_jours))})` : ''));
  } else if (d.reclamation_ecrite && d.date_reclamation) {
    const ecoule = joursEntre(d.date_reclamation, aujourdhui);
    if (d.reponse === 'refus') {
      bilan.point_entree = 'mise_en_demeure';
      justifier('Prochaine étape : la mise en demeure', 'l\'entreprise a refusé votre réclamation écrite');
    } else if (ecoule < REGLES.delai_reclamation_jours) {
      bilan.point_entree = 'attente_reclamation';
      justifier('Il faut d\'abord laisser à l\'entreprise le temps de répondre',
        `votre réclamation date du ${dateFr(d.date_reclamation)} ; le délai de ${REGLES.delai_reclamation_jours} jours expire le ${dateFr(ajouterJours(d.date_reclamation, REGLES.delai_reclamation_jours))}`);
    } else if (ecoule > REGLES.seuil_mise_en_demeure_directe_jours && d.reponse !== 'partielle') {
      bilan.point_entree = 'mise_en_demeure';
      justifier('Prochaine étape : la mise en demeure', `votre réclamation écrite est restée sans réponse satisfaisante depuis plus de ${REGLES.seuil_mise_en_demeure_directe_jours} jours`);
    } else {
      bilan.point_entree = 'relance';
      justifier('Prochaine étape : la relance', 'votre réclamation écrite n\'a pas reçu de réponse satisfaisante');
    }
    if (aujourdhui > ajouterMois(d.date_reclamation, REGLES.mediation_max_mois)) {
      bilan.points_faibles.push('Votre réclamation date de plus d\'un an : la saisine du médiateur pourrait ne plus être possible sur cette base.');
    }
    if (d.ecrit_trace === false) bilan.points_faibles.push('Vous n\'avez pas conservé de copie de votre réclamation : retrouvez-la si possible.');
  } else {
    bilan.point_entree = 'reclamation';
    justifier('Première étape : la réclamation écrite',
      d.contact_oral ? 'vos échanges par téléphone ou par chat ne laissent pas de trace écrite et ne valent pas réclamation' : 'aucune réclamation écrite n\'a encore été envoyée');
  }

  // ---- 6. Formule et prix ----
  switch (bilan.point_entree) {
    case 'reclamation':
      bilan.formule = 'complete'; bilan.prix_maximum = arrondi(P.reclamation + P.relance + P.mise_en_demeure + P.mediation); break;
    case 'attente_reclamation': case 'relance':
      bilan.formule = 'mise_en_demeure_et_mediation'; bilan.prix_maximum = arrondi(P.mise_en_demeure + P.mediation);
      bilan.options.push({ code: 'relance', prix: P.relance, conseillee: bilan.point_entree === 'relance' }); break;
    case 'mise_en_demeure':
      bilan.formule = 'mise_en_demeure_et_mediation'; bilan.prix_maximum = arrondi(P.mise_en_demeure + P.mediation); break;
    default:
      bilan.formule = 'mediation'; bilan.prix_maximum = P.mediation;
  }

  // ---- 7. Pièces à réunir ----
  bilan.pieces.push('Relevés bancaires montrant les débits contestés (vous pouvez masquer les autres opérations)');
  if (r.type_litige === 'souscription_cachee') bilan.pieces.push('Confirmation de commande ou captures d\'écran du site au moment de l\'achat');
  if (r.type_litige === 'resiliation_refusee') bilan.pieces.push('Preuve de votre demande de résiliation (email, capture, courrier)');
  if (r.type_litige === 'frais_non_autorises') bilan.pieces.push('Contrat ou conditions générales indiquant le prix convenu');
  if (d.reclamation_ecrite) bilan.pieces.push('Copie de votre réclamation écrite et de la réponse éventuelle');

  return bilan;
}
