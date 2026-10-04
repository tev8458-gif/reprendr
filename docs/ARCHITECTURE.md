# Reprendr. v2 – Architecture (phase A)

Document de référence technique. À tenir à jour à chaque évolution.

## Principes
- Un seul type de litige au lancement : prélèvements et abonnements.
- Le site (GitHub Pages) est statique. Toute la logique sensible est côté serveur (fonctions Supabase).
- Les utilisateurs **lisent** leurs propres données. Toutes les **écritures** passent par les fonctions serveur, qui garantissent l'enchaînement des étapes.
- Aucune donnée bancaire complète n'est stockée (pas d'IBAN complet, pas de relevé).
- Chaque document garde la version du modèle utilisée (traçabilité pour l'avocat et les partenaires).

## Fichiers
| Chemin | Rôle |
|---|---|
| diagnostic.html, assets/diagnostic-page.js | Page du diagnostic : questionnaire en 5 étapes, bilan, création du compte par code email, création du dossier |
| assets/style.css | Feuille de style commune (police Atkinson Hyperlegible, couleurs de la marque) |
| index.html, robots.txt | Version de test : redirection vers le diagnostic, aucune indexation |
| assets/config.js | URL et clé publique Supabase (jamais la clé service_role) |
| moteur/diagnostic.js | Moteur de règles, source unique (navigateur et serveur) |
| supabase/functions/creer-litige/source.js | Code de la fonction ; index.ts est généré par outils/construire-fonctions.mjs |

## Parcours de création d'un dossier
1. Le visiteur répond au questionnaire ; le bilan est calculé dans son navigateur, sans rien enregistrer.
2. S'il crée son dossier : prénom, nom, email, acceptation des CGU ; il reçoit un code à 6 chiffres (Supabase Auth, emails via Resend).
3. Une fois connecté, la page appelle la fonction `creer-litige` (option Supabase « Verify JWT » désactivée : la fonction contrôle elle-même le jeton via auth.getUser et répond 401 sinon), qui revalide les données, recalcule le bilan côté serveur et enregistre profil, litige, débits et journal.

## Base de données (migration 001)
| Table | Rôle |
|---|---|
| profils | Identité et adresse de l'utilisateur (créé automatiquement à l'inscription) |
| litiges | Un dossier : entreprise, type de litige, faits, montants, état, issue, satisfaction |
| debits | Débits contestés (calcul des délais bancaires de 8 semaines / 13 mois) |
| etapes | Historique du parcours : réclamation, relance, mise en demeure, médiation, banque |
| documents | Courriers générés, version du modèle, date de validation |
| envois | Recommandés : prestataire, suivi, dépôt, distribution, accusé de réception |
| paiements | Un paiement Stripe par étape payante |
| notifications | Emails et SMS envoyés, clics |
| jetons_reponse | Liens de réponse en un clic (réservés au serveur) |
| journal | Trace de chaque changement d'état |
| v_indicateurs_mensuels | Vue des indicateurs de performance (réservée au serveur) |

## États d'un litige
`diagnostic` → `en_cours` (une étape active dans `etapes`) → `clos`
États particuliers : `sans_nouvelles` (l'utilisateur ne répond plus), `hors_perimetre` (orienté vers un avocat ou une association).

## Règles à respecter pour toute nouvelle table
1. Activer la Row Level Security.
2. Révoquer les droits par défaut d'`anon` et `authenticated` (Supabase les accorde automatiquement).
3. N'accorder que la lecture, filtrée par `auth.uid()`, si l'utilisateur doit voir les données.
4. Ajouter un test dans `supabase/tests/`.

## Tests
`supabase/tests/00_stub_supabase.sql` simule l'environnement Supabase (ne jamais l'exécuter sur Supabase).
`supabase/tests/01_tests_securite.sql` vérifie l'isolation des données : 12 tests, tous réussis le 3 octobre 2026.
`supabase/tests/creer-litige.test.mjs` vérifie la fonction creer-litige : 9 tests, tous réussis le 3 octobre 2026.
`moteur/diagnostic.test.mjs` vérifie les règles du diagnostic : 35 cas types, tous réussis le 3 octobre 2026.
