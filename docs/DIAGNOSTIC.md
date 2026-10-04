# Moteur du diagnostic – règles et données

Fichier : `moteur/diagnostic.js` – Tests : `node moteur/diagnostic.test.mjs` (46 cas, tous réussis le 4 octobre 2026 – règles version 2026-10-v2).
Principe : des règles écrites, sans score ni pourcentage. Chaque conclusion est justifiée.

## Valeurs juridiques (objet REGLES, à valider par l'avocat)
| Paramètre | Valeur | Signification |
|---|---|---|
| banque_non_autorise_mois | 13 | Délai pour contester une opération non autorisée auprès de la banque |
| banque_sepa_autorise_jours | 56 | Remboursement sans justification d'un prélèvement SEPA autorisé (8 semaines) |
| retractation_jours | 14 | Délai de rétractation d'un contrat conclu à distance |
| retractation_prolongation_mois | 12 | Prolongation si l'information sur la rétractation n'a pas été fournie |
| prescription_ans | 5 | Délai au-delà duquel un débit n'est plus retenu (à confirmer) |
| delai_reclamation_jours | 15 | Délai laissé à l'entreprise après la réclamation |
| seuil_mise_en_demeure_directe_jours | 30 | Au-delà, une réclamation sans réponse mène directement à la mise en demeure |
| delai_mise_en_demeure_jours | 15 | Délai laissé à l'entreprise après la mise en demeure |
| mediation_max_mois | 12 | Saisine du médiateur dans l'année suivant la réclamation écrite |
| seuil_orientation_avocat | 5 000 € | Au-delà, orientation vers un avocat |
| secteurs_hors_perimetre | banque | Fiche dédiée prévue ultérieurement |
| assurance_hamon_mois | 12 | Résiliation d'assurance à tout moment après un an (loi Hamon) |
| assurance_hamon_types | auto, habitation, affinitaire, santé | Assurances concernées par la loi Hamon |
| telecom_engagement_mois | 12 | Au-delà, frais de résiliation plafonnés au quart des mensualités restantes |

## Règles appliquées, dans l'ordre
1. **Débits** : ceux de plus de 5 ans sont écartés ; les dates futures sont ignorées.
2. **Périmètre** : hors périmètre si secteur bancaire, aucun débit, tous les débits prescrits, montant supérieur à 5 000 €, ou résiliation jamais demandée (il faut d'abord la demander).
3. **Voie bancaire** :
   - prélèvement ou carte **sans aucune autorisation** → modèle C1, débits de moins de 13 mois ;
   - prélèvement SEPA avec autorisation **donnée, piégée ou incertaine** → modèle C2, débits de moins de 8 semaines (choix prudent pour la case piégée, à valider) ;
   - carte avec autorisation donnée → pas de remboursement bancaire, conseil de blocage des paiements futurs ;
   - alerte si l'échéance bancaire est à moins de 21 jours.
4. **Fondements** : A1 (souscription cachée, + rétractation si le délai est ouvert), A2 (service non commandé), A3a (résiliation demandée, + mention « en ligne »), A3b (reconduction sans information ; A3b-assurance pour l'assurance), A4 (frais non autorisés).
   Paragraphes sectoriels de résiliation : A3-energie (toujours) ; A3-assurance-hamon (auto, habitation, affinitaire, santé, contrat de plus d'un an) ; A3-assurance-emprunteur (toujours) ; A3-telecom (contrat de plus de 12 mois). En deçà, point faible expliquant les limites.
   Médiateur indiqué : Médiateur national de l'énergie, Médiateur des communications électroniques, La Médiation de l'Assurance, sinon médiateur désigné par l'entreprise.
5. **Point d'entrée** :
   - mise en demeure déjà envoyée → médiation (après 15 jours) ;
   - réclamation écrite refusée → mise en demeure ;
   - réclamation de moins de 15 jours → attente ;
   - réclamation sans réponse depuis plus de 30 jours (hors réponse partielle) → mise en demeure ;
   - sinon réclamation sans réponse satisfaisante → relance ;
   - aucune réclamation écrite (ou seulement des échanges oraux) → réclamation.
6. **Formule et prix maximal** : complète 51,60 € ; mise en demeure et médiation 29,80 € (relance en option à 9,90 €) ; médiation 9,90 €.
7. **Pièces, points faibles, alertes et conseils** selon la situation.

## Données d'entrée
```
type_litige            souscription_cachee | service_non_commande | resiliation_refusee | frais_non_autorises
secteur                general | assurance | telecom | energie | banque | autre
moyen_paiement         prelevement_sepa | carte | autre | inconnu
autorisation           aucune | piegee | donnee | inconnue
debits                 [{ date: 'AAAA-MM-JJ', montant: nombre }]
contrat_en_ligne       booléen
date_souscription      'AAAA-MM-JJ' (facultatif)
information_retractation oui | non | ne_sait_pas
date_debut_contrat     'AAAA-MM-JJ' (assurance et télécoms, résiliation)
type_assurance         auto | habitation | affinitaire | sante | emprunteur | autre
prelevements_en_cours  booléen
resiliation            { date_demande, canal: email|courrier|formulaire|telephone, reconduction_sans_information }
demarches              { contact_oral, reclamation_ecrite, date_reclamation, reponse: aucune|refus|evasive|partielle,
                         ecrit_trace, mise_en_demeure_envoyee, date_mise_en_demeure }
```
