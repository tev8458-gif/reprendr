// Reprendr. v2 – page du diagnostic
// Questionnaire en 5 étapes → bilan calculé par le moteur → création du compte (code reçu par email) → dossier.
import { diagnostiquer, REGLES } from '../moteur/diagnostic.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $vue = document.getElementById('vue');
const ETAPES = ['Votre situation', 'L\'entreprise et le contrat', 'Le paiement', 'Les débits contestés', 'Vos démarches'];

// ---------- État ----------
const etat = {
  etape: 0,
  r: { type_litige: null, secteur: 'general', entreprise_nom: '', circonstances: '', contrat_en_ligne: null,
    date_souscription: '', information_retractation: 'ne_sait_pas',
    resiliation: { date_demande: '', canal: null, reconduction_sans_information: false },
    moyen_paiement: null, autorisation: null, prelevements_en_cours: null,
    debits: [{ date: '', montant: '' }],
    demarches: { contact_oral: false, reclamation_ecrite: null, date_reclamation: '', reponse: 'aucune', ecrit_trace: true,
      mise_en_demeure_envoyee: null, date_mise_en_demeure: '' } },
  bilan: null,
};
const aujourdhui = () => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ---------- Outils d'affichage ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = (n) => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const dateLongue = (s) => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const radio = (nom, valeur, titre, detail, coche) => `
  <label class="option"><input type="radio" name="${nom}" value="${valeur}" ${coche ? 'checked' : ''}>
  <span><strong>${titre}</strong>${detail ? `<small>${detail}</small>` : ''}</span></label>`;
const ouiNon = (nom, valeur) => `<div class="choix choix-ligne">${radio(nom, 'oui', 'Oui', '', valeur === true)}${radio(nom, 'non', 'Non', '', valeur === false)}</div>`;
const val = (nom) => document.querySelector(`[name="${nom}"]:checked`)?.value ?? null;
const champ = (id) => document.getElementById(id);
function progression(visible) {
  champ('progression').classList.toggle('cache', !visible);
  if (!visible) return;
  champ('progression-texte').textContent = `Étape ${etat.etape + 1} sur ${ETAPES.length} : ${ETAPES[etat.etape].toLowerCase()}`;
  champ('progression-jauge').style.width = `${((etat.etape + 1) / ETAPES.length) * 100}%`;
}
const actions = (suivant = 'Continuer') => `
  <div class="actions">
    ${etat.etape > 0 ? '<button type="button" class="btn-second btn" id="precedent">Retour</button>' : '<span></span>'}
    <button type="button" class="btn" id="suivant">${suivant}</button>
  </div><p class="erreur-champ" id="erreur" role="alert"></p>`;

// ---------- Étapes du questionnaire ----------
const vues = [
  // 1. Situation
  () => `
    <h1>Faisons le point sur votre situation</h1>
    <p class="chapeau">Quelques questions pour connaître vos droits, vos délais et la bonne démarche. Gratuit, sans engagement.</p>
    <fieldset><legend>Que s'est-il passé ?</legend><div class="choix">
      ${radio('type_litige', 'souscription_cachee', 'Un abonnement souscrit sans le savoir', 'Par exemple lors d\'un achat en ligne, d\'un essai gratuit ou d\'une case cochée', etat.r.type_litige === 'souscription_cachee')}
      ${radio('type_litige', 'service_non_commande', 'Un service que je n\'ai jamais commandé', 'Une entreprise me prélève alors que je n\'ai aucun contrat avec elle', etat.r.type_litige === 'service_non_commande')}
      ${radio('type_litige', 'resiliation_refusee', 'Une résiliation refusée ou ignorée', 'J\'ai demandé à résilier mais les prélèvements continuent, ou mon contrat a été reconduit sans prévenir', etat.r.type_litige === 'resiliation_refusee')}
      ${radio('type_litige', 'frais_non_autorises', 'Des frais que je n\'ai pas acceptés', 'Options, frais supplémentaires ou hausse non consentie', etat.r.type_litige === 'frais_non_autorises')}
    </div></fieldset>
    <div class="champ"><label class="etiquette" for="secteur">De quel type de service s'agit-il ?</label>
      <select id="secteur">
        ${[['general', 'Abonnement en ligne, application, streaming, presse, salle de sport…'], ['telecom', 'Téléphone ou internet'], ['energie', 'Électricité ou gaz'],
          ['assurance', 'Assurance'], ['banque', 'Banque ou crédit'], ['autre', 'Autre']].map(([v, t]) => `<option value="${v}" ${etat.r.secteur === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
    ${actions()}`,
  // 2. Entreprise et contrat
  () => {
    const t = etat.r.type_litige;
    return `
    <h2>L'entreprise et le contrat</h2>
    <div class="champ"><label class="etiquette" for="entreprise">Nom de l'entreprise</label>
      <input type="text" id="entreprise" maxlength="160" autocomplete="organization" value="${esc(etat.r.entreprise_nom)}">
      <span class="aide">Tel qu'il apparaît sur votre relevé ou sur le site de l'entreprise.</span></div>
    <fieldset><legend>Le contrat a-t-il été conclu en ligne ?<span class="aide">Sur un site internet ou une application.</span></legend>${ouiNon('contrat_en_ligne', etat.r.contrat_en_ligne)}</fieldset>
    ${t === 'souscription_cachee' ? `
      <div class="champ"><label class="etiquette" for="date_souscription">Date de la souscription<span class="aide">Facultatif, mais utile pour vérifier votre droit de rétractation. Souvent la date de votre achat.</span></label>
        <input type="date" id="date_souscription" max="${aujourdhui()}" value="${esc(etat.r.date_souscription)}"></div>
      <fieldset><legend>Avez-vous été informé de votre droit de rétractation ?</legend><div class="choix choix-ligne">
        ${radio('information_retractation', 'oui', 'Oui', '', etat.r.information_retractation === 'oui')}
        ${radio('information_retractation', 'non', 'Non', '', etat.r.information_retractation === 'non')}
        ${radio('information_retractation', 'ne_sait_pas', 'Je ne sais pas', '', etat.r.information_retractation === 'ne_sait_pas')}</div></fieldset>` : ''}
    ${t === 'resiliation_refusee' ? `
      <div class="champ"><label class="etiquette" for="date_demande">Date de votre demande de résiliation<span class="aide">Laissez vide si vous ne l'avez pas encore demandée.</span></label>
        <input type="date" id="date_demande" max="${aujourdhui()}" value="${esc(etat.r.resiliation.date_demande)}"></div>
      <fieldset><legend>Comment l'avez-vous demandée ?</legend><div class="choix choix-ligne">
        ${[['email', 'Par email'], ['formulaire', 'Sur leur site'], ['courrier', 'Par courrier'], ['telephone', 'Par téléphone']].map(([v, l]) => radio('canal', v, l, '', etat.r.resiliation.canal === v)).join('')}</div></fieldset>
      <div class="champ"><label class="case"><input type="checkbox" id="reconduction" ${etat.r.resiliation.reconduction_sans_information ? 'checked' : ''}>
        <span>Mon contrat a été reconduit automatiquement sans que l'entreprise m'en ait prévenu par écrit</span></label></div>` : ''}
    <div class="champ"><label class="etiquette" for="circonstances">Racontez brièvement ce qui s'est passé<span class="aide">Facultatif. Ce texte pourra figurer dans vos courriers ; vous pourrez le relire avant tout envoi.</span></label>
      <textarea id="circonstances" maxlength="3000">${esc(etat.r.circonstances)}</textarea></div>
    ${actions()}`;
  },
  // 3. Paiement
  () => `
    <h2>Le paiement</h2>
    <fieldset><legend>Comment êtes-vous débité ?</legend><div class="choix">
      ${radio('moyen_paiement', 'prelevement_sepa', 'Par prélèvement sur mon compte', 'La ligne du relevé indique « prélèvement » ou « PRLV SEPA »', etat.r.moyen_paiement === 'prelevement_sepa')}
      ${radio('moyen_paiement', 'carte', 'Par carte bancaire', 'La ligne indique « CB » ou « paiement carte »', etat.r.moyen_paiement === 'carte')}
      ${radio('moyen_paiement', 'autre', 'Autre moyen', 'Virement, PayPal, facture opérateur…', etat.r.moyen_paiement === 'autre')}
      ${radio('moyen_paiement', 'inconnu', 'Je ne sais pas', '', etat.r.moyen_paiement === 'inconnu')}
    </div></fieldset>
    <fieldset><legend>Aviez-vous donné votre accord à ces paiements ?</legend><div class="choix">
      ${radio('autorisation', 'aucune', 'Jamais', 'Je n\'ai signé aucun mandat et validé aucun paiement pour cette entreprise', etat.r.autorisation === 'aucune')}
      ${radio('autorisation', 'piegee', 'Sans le savoir', 'Une case cochée, un essai gratuit devenu payant, une option glissée dans une commande', etat.r.autorisation === 'piegee')}
      ${radio('autorisation', 'donnee', 'Oui', 'J\'avais accepté au départ, mais le problème est survenu ensuite', etat.r.autorisation === 'donnee')}
      ${radio('autorisation', 'inconnue', 'Je ne sais pas', '', etat.r.autorisation === 'inconnue')}
    </div></fieldset>
    <p class="mention">Répondez avec exactitude : la démarche auprès de votre banque dépend de cette réponse, et une déclaration inexacte engagerait votre responsabilité.</p>
    <fieldset><legend>Les prélèvements continuent-ils ?</legend>${ouiNon('en_cours', etat.r.prelevements_en_cours)}</fieldset>
    ${actions()}`,
  // 4. Débits
  () => `
    <h2>Les débits contestés</h2>
    <p>Indiquez chaque débit que vous contestez, avec sa date et son montant, tels qu'ils figurent sur vos relevés.</p>
    <div class="debits" id="debits">
      ${etat.r.debits.map((d, i) => `
        <div class="debit">
          <input type="date" aria-label="Date du débit ${i + 1}" data-i="${i}" data-k="date" max="${aujourdhui()}" value="${esc(d.date)}">
          <input type="number" aria-label="Montant du débit ${i + 1} en euros" data-i="${i}" data-k="montant" min="0.01" step="0.01" inputmode="decimal" placeholder="Montant €" value="${esc(d.montant)}">
          <button type="button" class="btn-second btn" data-suppr="${i}" aria-label="Supprimer le débit ${i + 1}" ${etat.r.debits.length === 1 ? 'disabled' : ''}>×</button>
        </div>`).join('')}
    </div>
    <button type="button" class="btn-second btn" id="ajouter">Ajouter un débit</button>
    <p class="total" id="total"></p>
    ${actions()}`,
  // 5. Démarches
  () => {
    const d = etat.r.demarches;
    return `
    <h2>Vos démarches</h2>
    <fieldset><legend>Avez-vous déjà réclamé par écrit auprès de l'entreprise ?<span class="aide">Email, formulaire, courrier ou recommandé. Un appel ou un chat ne compte pas.</span></legend>${ouiNon('reclamation_ecrite', d.reclamation_ecrite)}</fieldset>
    <div id="bloc-reclamation" class="${d.reclamation_ecrite ? '' : 'cache'}">
      <div class="champ"><label class="etiquette" for="date_reclamation">Date de votre réclamation écrite</label>
        <input type="date" id="date_reclamation" max="${aujourdhui()}" value="${esc(d.date_reclamation)}"></div>
      <fieldset><legend>Qu'a répondu l'entreprise ?</legend><div class="choix">
        ${radio('reponse', 'aucune', 'Rien', '', d.reponse === 'aucune')}
        ${radio('reponse', 'evasive', 'Une réponse évasive', 'Sans répondre vraiment à ma demande', d.reponse === 'evasive')}
        ${radio('reponse', 'partielle', 'Une réponse partielle', 'Un geste ou un remboursement incomplet', d.reponse === 'partielle')}
        ${radio('reponse', 'refus', 'Un refus', '', d.reponse === 'refus')}</div></fieldset>
      <div class="champ"><label class="case"><input type="checkbox" id="ecrit_trace" ${d.ecrit_trace ? 'checked' : ''}><span>J'ai conservé une copie de ma réclamation</span></label></div>
      <fieldset><legend>Avez-vous déjà envoyé une mise en demeure ?</legend>${ouiNon('mise_en_demeure', d.mise_en_demeure_envoyee)}</fieldset>
      <div id="bloc-mdm" class="champ ${d.mise_en_demeure_envoyee ? '' : 'cache'}"><label class="etiquette" for="date_mdm">Date de la mise en demeure</label>
        <input type="date" id="date_mdm" max="${aujourdhui()}" value="${esc(d.date_mise_en_demeure)}"></div>
    </div>
    <div id="bloc-oral" class="champ ${d.reclamation_ecrite === false ? '' : 'cache'}"><label class="case"><input type="checkbox" id="contact_oral" ${d.contact_oral ? 'checked' : ''}>
      <span>J'ai contacté l'entreprise par téléphone ou par chat</span></label></div>
    ${actions('Voir mon bilan')}`;
  },
];

// ---------- Lecture et validation de chaque étape ----------
function lireEtape() {
  const r = etat.r;
  switch (etat.etape) {
    case 0:
      r.type_litige = val('type_litige'); r.secteur = champ('secteur').value;
      return r.type_litige ? null : 'Choisissez la situation qui correspond le mieux à la vôtre.';
    case 1: {
      r.entreprise_nom = champ('entreprise').value.trim();
      const enLigne = val('contrat_en_ligne'); r.contrat_en_ligne = enLigne === null ? null : enLigne === 'oui';
      r.circonstances = champ('circonstances').value.trim();
      if (r.type_litige === 'souscription_cachee') { r.date_souscription = champ('date_souscription').value; r.information_retractation = val('information_retractation') || 'ne_sait_pas'; }
      if (r.type_litige === 'resiliation_refusee') {
        r.resiliation = { date_demande: champ('date_demande').value, canal: val('canal'), reconduction_sans_information: champ('reconduction').checked };
        if (r.resiliation.date_demande && !r.resiliation.canal) return 'Indiquez comment vous avez demandé la résiliation.';
      }
      if (!r.entreprise_nom) return 'Indiquez le nom de l\'entreprise.';
      if (r.contrat_en_ligne === null) return 'Indiquez si le contrat a été conclu en ligne.';
      return null;
    }
    case 2:
      r.moyen_paiement = val('moyen_paiement'); r.autorisation = val('autorisation');
      r.prelevements_en_cours = val('en_cours') === null ? null : val('en_cours') === 'oui';
      if (!r.moyen_paiement) return 'Indiquez comment vous êtes débité.';
      if (!r.autorisation) return 'Indiquez si vous aviez donné votre accord.';
      if (r.prelevements_en_cours === null) return 'Indiquez si les prélèvements continuent.';
      return null;
    case 3: {
      const valides = r.debits.filter(d => d.date && Number(d.montant) > 0);
      if (!valides.length && r.type_litige !== 'resiliation_refusee') return 'Indiquez au moins un débit, avec sa date et son montant.';
      if (r.debits.some(d => (d.date && !(Number(d.montant) > 0)) || (!d.date && d.montant))) return 'Chaque débit doit avoir une date et un montant.';
      return null;
    }
    case 4: {
      const d = r.demarches; const ecrit = val('reclamation_ecrite');
      d.reclamation_ecrite = ecrit === null ? null : ecrit === 'oui';
      if (d.reclamation_ecrite === null) return 'Indiquez si vous avez déjà réclamé par écrit.';
      if (d.reclamation_ecrite) {
        d.date_reclamation = champ('date_reclamation').value; d.reponse = val('reponse') || 'aucune'; d.ecrit_trace = champ('ecrit_trace').checked;
        const mdm = val('mise_en_demeure'); d.mise_en_demeure_envoyee = mdm === 'oui';
        d.date_mise_en_demeure = d.mise_en_demeure_envoyee ? champ('date_mdm').value : '';
        if (!d.date_reclamation) return 'Indiquez la date de votre réclamation écrite.';
        if (mdm === null) return 'Indiquez si vous avez déjà envoyé une mise en demeure.';
        if (d.mise_en_demeure_envoyee && !d.date_mise_en_demeure) return 'Indiquez la date de la mise en demeure.';
      } else { d.contact_oral = champ('contact_oral').checked; d.mise_en_demeure_envoyee = false; }
      return null;
    }
  }
  return null;
}

// Réponses au format attendu par le moteur
function reponsesMoteur() {
  const r = etat.r;
  return {
    type_litige: r.type_litige, secteur: r.secteur, entreprise_nom: r.entreprise_nom, circonstances: r.circonstances,
    moyen_paiement: r.moyen_paiement, autorisation: r.autorisation, prelevements_en_cours: r.prelevements_en_cours,
    contrat_en_ligne: r.contrat_en_ligne === true, date_souscription: r.date_souscription || null,
    information_retractation: r.information_retractation,
    debits: r.debits.filter(d => d.date && Number(d.montant) > 0).map(d => ({ date: d.date, montant: Math.round(Number(d.montant) * 100) / 100 })),
    resiliation: { ...r.resiliation, date_demande: r.resiliation.date_demande || null },
    demarches: { ...r.demarches, date_reclamation: r.demarches.date_reclamation || null, date_mise_en_demeure: r.demarches.date_mise_en_demeure || null },
  };
}

// ---------- Affichage d'une étape ----------
function afficherEtape() {
  progression(true);
  $vue.innerHTML = vues[etat.etape]();
  window.scrollTo({ top: 0 });
  champ('suivant').addEventListener('click', () => {
    const erreur = lireEtape();
    if (erreur) { champ('erreur').textContent = erreur; return; }
    if (etat.etape < vues.length - 1) { etat.etape++; afficherEtape(); } else afficherBilan();
  });
  champ('precedent')?.addEventListener('click', () => { lireEtape(); etat.etape--; afficherEtape(); });
  if (etat.etape === 3) brancherDebits();
  if (etat.etape === 4) brancherDemarches();
  $vue.querySelector('input, select, textarea')?.focus({ preventScroll: true });
}

function brancherDebits() {
  const majTotal = () => {
    const t = etat.r.debits.reduce((s, d) => s + (Number(d.montant) > 0 ? Number(d.montant) : 0), 0);
    champ('total').textContent = t > 0 ? `Total contesté : ${euros(t)}` : '';
  };
  champ('debits').addEventListener('input', (e) => {
    const i = e.target.dataset.i; if (i === undefined) return;
    etat.r.debits[i][e.target.dataset.k] = e.target.value; majTotal();
  });
  champ('debits').addEventListener('click', (e) => {
    const i = e.target.dataset.suppr; if (i === undefined) return;
    etat.r.debits.splice(Number(i), 1); afficherEtape();
  });
  champ('ajouter').addEventListener('click', () => {
    if (etat.r.debits.length >= 60) return;
    const dernier = etat.r.debits[etat.r.debits.length - 1];
    etat.r.debits.push({ date: '', montant: dernier?.montant || '' }); afficherEtape();
    champ('debits').querySelectorAll('input[type=date]')[etat.r.debits.length - 1]?.focus();
  });
  majTotal();
}

function brancherDemarches() {
  document.querySelectorAll('[name=reclamation_ecrite]').forEach(el => el.addEventListener('change', () => {
    champ('bloc-reclamation').classList.toggle('cache', val('reclamation_ecrite') !== 'oui');
    champ('bloc-oral').classList.toggle('cache', val('reclamation_ecrite') !== 'non');
  }));
  document.querySelectorAll('[name=mise_en_demeure]').forEach(el => el.addEventListener('change', () => {
    champ('bloc-mdm').classList.toggle('cache', val('mise_en_demeure') !== 'oui');
  }));
}

// ---------- Bilan ----------
const ORIENTATIONS = {
  mediateur_sectoriel: 'Ce type de contrat relève de règles particulières. Contactez le médiateur de ce secteur, dont les coordonnées figurent dans votre contrat ou sur vos factures, ou une association de consommateurs agréée.',
  avocat: 'Pour un montant de cette importance, l\'avis d\'un avocat est recommandé. Une association de consommateurs peut aussi vous orienter.',
  prescription: 'Les débits indiqués sont trop anciens pour être réclamés. Une association de consommateurs pourra confirmer cette analyse.',
  aucun_debit: 'Revenez au diagnostic et indiquez les débits que vous contestez.',
  resilier_d_abord: 'Demandez d\'abord la résiliation par écrit, de préférence par le moyen prévu au contrat. Si l\'entreprise refuse ou continue de prélever, revenez faire votre diagnostic.',
};
const ETAPE_TEXTE = {
  reclamation: ['Première étape : une réclamation écrite', 'Reprendr. prépare votre réclamation et l\'envoie en recommandé à l\'entreprise, après votre validation.'],
  attente_reclamation: ['Laissez à l\'entreprise le temps de répondre', 'Nous vous préviendrons à la fin du délai pour préparer la suite si elle ne répond pas.'],
  relance: ['Prochaine étape : une relance', 'Votre réclamation est restée sans réponse satisfaisante. Une relance précède la mise en demeure.'],
  mise_en_demeure: ['Prochaine étape : la mise en demeure', 'Reprendr. la prépare et l\'envoie en recommandé avec accusé de réception, après votre validation.'],
  attente_mise_en_demeure: ['Laissez courir le délai de votre mise en demeure', 'Si l\'entreprise ne répond pas, la prochaine étape sera la saisine du médiateur.'],
  mediation: ['Prochaine étape : la saisine du médiateur', 'Reprendr. prépare un dossier complet à déposer auprès du médiateur dont relève l\'entreprise.'],
};
const FORMULES = {
  complete: ['Formule complète', 'réclamation, relance, mise en demeure et dossier de médiation'],
  mise_en_demeure_et_mediation: ['Formule mise en demeure et médiation', 'mise en demeure en recommandé avec accusé de réception et dossier de médiation'],
  mediation: ['Formule médiation', 'dossier de saisine du médiateur'],
};

function afficherBilan() {
  progression(false);
  const b = diagnostiquer(reponsesMoteur(), aujourdhui());
  etat.bilan = b;
  const retour = '<div class="actions"><button type="button" class="btn-second btn" id="modifier">Modifier mes réponses</button></div>';

  if (!b.dans_le_perimetre) {
    $vue.innerHTML = `
      <h1>Reprendr. ne peut pas traiter ce dossier</h1>
      <p class="chapeau">${esc(b.justifications.at(-1)?.parce_que || '')}.</p>
      <p>${esc(ORIENTATIONS[b.orientation] || '')}</p>
      <p class="mention">Mieux vaut vous le dire maintenant que vous proposer une démarche inadaptée.</p>${retour}`;
    brancherRetour(); window.scrollTo({ top: 0 }); return;
  }

  const J = b.date;
  const dates = [{ d: J, t: 'Aujourd\'hui', c: 'auj' }];
  if (b.voie_bancaire.ouverte) dates.push({ d: b.voie_bancaire.date_limite, t: `Dernier jour pour demander le remboursement à votre banque (${euros(b.voie_bancaire.montant)})`, c: b.alertes.some(a => a.includes('banque')) ? 'urgent' : '' });
  if (b.retractation.ouverte) dates.push({ d: b.retractation.date_limite, t: 'Dernier jour pour exercer votre droit de rétractation', c: b.alertes.some(a => a.includes('rétractation')) ? 'urgent' : '' });
  dates.sort((x, y) => x.d.localeCompare(y.d));
  const [titreEtape, texteEtape] = ETAPE_TEXTE[b.point_entree];
  const [nomFormule, contenuFormule] = FORMULES[b.formule];
  const option = b.options.find(o => o.code === 'relance');

  $vue.innerHTML = `
    <h1>Votre bilan</h1>
    <p class="montant">Montant contesté : <strong>${euros(b.montant_total)}</strong></p>
    ${b.alertes.map(a => `<p class="alerte">${esc(a)}</p>`).join('')}

    <h3>Vos dates</h3>
    <ol class="dates">${dates.map(x => `<li class="${x.c}"><time datetime="${x.d}">${x.d === J ? 'Aujourd\'hui' : dateLongue(x.d)}</time><span>${x.d === J ? 'Votre diagnostic' : esc(x.t)}</span></li>`).join('')}</ol>
    ${dates.length === 1 ? '<p class="mention">Aucun délai bancaire ni de rétractation n\'est ouvert dans votre situation : la démarche passe par l\'entreprise.</p>' : ''}

    ${b.voie_bancaire.ouverte ? `<div class="bloc"><h3>Auprès de votre banque</h3>
      <p>${b.voie_bancaire.modele === 'C1'
        ? `Votre banque doit vous rembourser les opérations que vous n'avez jamais autorisées (${b.voie_bancaire.debits.length} débit(s), ${euros(b.voie_bancaire.montant)}).`
        : `Vous pouvez demander à votre banque le remboursement des prélèvements de moins de 8 semaines (${b.voie_bancaire.debits.length} débit(s), ${euros(b.voie_bancaire.montant)}), sans avoir à vous justifier.`}
      Reprendr. vous fournit la demande à transmettre ; c'est gratuit et cela se fait en parallèle.</p></div>` : ''}

    <div class="bloc"><h3>${esc(titreEtape)}</h3><p>${esc(texteEtape)}</p>
      <div class="encadre"><p><strong>${nomFormule}</strong> : ${contenuFormule}.</p>
        <p class="prix">${b.formule === 'mediation' ? euros(b.prix_maximum) : `${euros(b.prix_maximum)} au maximum`}</p>
        ${option ? `<p>Relance en recommandé : ${euros(option.prix)}, ${option.conseillee ? 'conseillée dans votre situation' : 'proposée si l\'entreprise ne répond pas'}.</p>` : ''}
        <p class="mention">Chaque étape se paie au moment où elle devient utile. Si l'entreprise règle votre litige avant, vous ne payez pas la suite.</p></div></div>

    ${b.conseils.length ? `<h3>À faire dès maintenant</h3><ul class="liste">${b.conseils.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${b.points_faibles.length ? `<h3>Points à renforcer</h3><ul class="liste">${b.points_faibles.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <h3>Pièces à réunir</h3><ul class="liste">${b.pieces.map(c => `<li>${esc(c)}</li>`).join('')}</ul>

    <details><summary>Pourquoi ce bilan</summary><ul class="justif">
      ${b.justifications.map(j => `<li><strong>${esc(j.conclusion)}</strong><span>parce que ${esc(j.parce_que)}.</span></li>`).join('')}</ul></details>

    <p class="mention">Ce bilan applique des règles juridiques aux réponses que vous avez données (version des règles : ${esc(REGLES.version)}). Il ne constitue pas une consultation juridique et ne garantit pas l'issue de votre litige, qui dépend notamment de la réponse de l'entreprise et de vos preuves.</p>

    <div class="actions"><button type="button" class="btn-second btn" id="modifier">Modifier mes réponses</button>
      <button type="button" class="btn" id="creer">Créer mon dossier</button></div>`;
  brancherRetour();
  champ('creer').addEventListener('click', afficherCompte);
  window.scrollTo({ top: 0 });
}
function brancherRetour() { champ('modifier').addEventListener('click', () => { etat.etape = 0; afficherEtape(); }); }

// ---------- Compte et création du dossier ----------
async function afficherCompte() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return creerDossier();
  $vue.innerHTML = `
    <h2>Créer votre dossier</h2>
    <p>Votre dossier sera accessible depuis votre espace, sans mot de passe : vous recevrez un code par email à chaque connexion.</p>
    <div class="champ"><label class="etiquette" for="prenom">Prénom</label><input type="text" id="prenom" autocomplete="given-name" maxlength="80"></div>
    <div class="champ"><label class="etiquette" for="nom">Nom</label><input type="text" id="nom" autocomplete="family-name" maxlength="80"></div>
    <div class="champ"><label class="etiquette" for="email">Adresse email</label><input type="email" id="email" autocomplete="email" maxlength="200"></div>
    <div class="champ"><label class="case"><input type="checkbox" id="accord"><span>J'accepte les <a href="/legal.html" target="_blank" rel="noopener">conditions générales</a> et la <a href="/legal.html#confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>.</span></label></div>
    <div class="actions"><button type="button" class="btn-second btn" id="retour-bilan">Revenir au bilan</button><button type="button" class="btn" id="envoyer-code">Recevoir mon code</button></div>
    <p class="erreur-champ" id="erreur" role="alert"></p>`;
  champ('retour-bilan').addEventListener('click', afficherBilan);
  champ('envoyer-code').addEventListener('click', async () => {
    const prenom = champ('prenom').value.trim(), nom = champ('nom').value.trim(), email = champ('email').value.trim().toLowerCase();
    if (!prenom || !nom) return (champ('erreur').textContent = 'Indiquez votre prénom et votre nom : ils figureront sur vos courriers.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (champ('erreur').textContent = 'Cette adresse email n\'est pas valide.');
    if (!champ('accord').checked) return (champ('erreur').textContent = 'Acceptez les conditions générales pour continuer.');
    etat.profil = { prenom, nom }; etat.email = email;
    champ('envoyer-code').disabled = true;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    champ('envoyer-code').disabled = false;
    if (error) return (champ('erreur').textContent = error.status === 429 ? 'Trop de demandes. Patientez une minute puis réessayez.' : 'L\'envoi du code a échoué. Vérifiez votre adresse puis réessayez.');
    afficherCode();
  });
}

function afficherCode() {
  $vue.innerHTML = `
    <h2>Saisissez votre code</h2>
    <p>Un code vient d'être envoyé à <strong>${esc(etat.email)}</strong>. Pensez à vérifier vos courriers indésirables.</p>
    <div class="champ"><label class="etiquette" for="code">Code reçu par email</label>
      <input type="text" id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]*"></div>
    <div class="actions"><button type="button" class="btn-lien" id="renvoyer">Renvoyer le code</button><button type="button" class="btn" id="valider">Valider</button></div>
    <p class="erreur-champ" id="erreur" role="alert"></p>`;
  champ('code').focus();
  champ('renvoyer').addEventListener('click', async () => {
    await supabase.auth.signInWithOtp({ email: etat.email, options: { shouldCreateUser: true } });
    champ('erreur').textContent = 'Un nouveau code vient d\'être envoyé.';
  });
  champ('valider').addEventListener('click', async () => {
    const token = champ('code').value.replace(/\D/g, '');
    if (token.length < 6 || token.length > 8) return (champ('erreur').textContent = 'Saisissez le code reçu par email, composé uniquement de chiffres.');
    champ('valider').disabled = true;
    const { error } = await supabase.auth.verifyOtp({ email: etat.email, token, type: 'email' });
    champ('valider').disabled = false;
    if (error) return (champ('erreur').textContent = 'Ce code est incorrect ou a expiré. Demandez-en un nouveau.');
    creerDossier();
  });
}

async function creerDossier() {
  $vue.innerHTML = '<h2>Création de votre dossier…</h2>';
  const { data, error } = await supabase.functions.invoke('creer-litige', { body: { profil: etat.profil || {}, reponses: reponsesMoteur() } });
  if (error) {
    let message = 'La création du dossier a échoué. Réessayez dans quelques minutes.';
    try { message = (await error.context.json()).erreur || message; } catch { /* réponse non lisible */ }
    $vue.innerHTML = `<h2>Le dossier n'a pas pu être créé</h2><p>${esc(message)}</p>
      <div class="actions"><button type="button" class="btn" id="reessayer">Réessayer</button></div>`;
    champ('reessayer').addEventListener('click', creerDossier); return;
  }
  $vue.innerHTML = `
    <h1 class="succes">Votre dossier est créé</h1>
    <p class="chapeau">Référence ${esc(data.reference)}. Gardez-la : elle figurera sur tous vos échanges avec Reprendr.</p>
    <p>La prochaine étape apparaîtra dans votre espace : vous y relirez votre courrier avant tout envoi.</p>
    <p class="mention">L'espace client est en cours de construction.</p>`;
}

afficherEtape();
