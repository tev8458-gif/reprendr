# Reprendr. v2 – installation

## Étape 1 – Base de données (fait le 3 octobre 2026)
Supabase > SQL Editor > New query > coller `supabase/migrations/001_schema_phase_a.sql` > Run.
Ne jamais exécuter les fichiers du dossier `supabase/tests/` sur Supabase.

## Étape 2 – Envoi des emails par Resend (obligatoire pour les codes de connexion)
Le service d'email intégré de Supabase n'envoie qu'aux membres de l'équipe et en très petite quantité.
1. Resend > Domains : vérifier que reprendr.fr est bien validé.
2. Resend > API Keys : créer une clé (droit « Sending access »), la copier.
3. Supabase > Authentication > Emails > SMTP Settings : activer « Enable Custom SMTP » et saisir :
   - Sender email : `ne-pas-repondre@reprendr.fr` – Sender name : `Reprendr.`
   - Host : `smtp.resend.com` – Port : `465` – Username : `resend` – Password : la clé API Resend
4. Enregistrer.

## Étape 3 – Email contenant le code à 6 chiffres
Supabase > Authentication > Emails > Templates > « Magic Link » :
- Subject : `Votre code de connexion Reprendr.`
- Body (remplacer tout le contenu) :
```
<h2>Votre code de connexion</h2>
<p>Saisissez ce code sur Reprendr. pour accéder à votre dossier :</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Ce code expire dans une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
```
Faire de même pour le modèle « Confirm signup » (même texte), utilisé lors de la toute première connexion.
Puis Authentication > Sign In / Providers > Email : régler « Email OTP Length » sur 6 (la page accepte aussi 8 par sécurité).

## Étape 4 – Fonction serveur « creer-litige »
Supabase > Edge Functions > Deploy a new function > Via Editor :
- Nom : `creer-litige`
- Remplacer tout le contenu de l'éditeur par celui de `supabase/functions/creer-litige/index.ts`
- Deploy. Puis Settings : DÉSACTIVER « Verify JWT with legacy secret » et enregistrer.
  La fonction vérifie elle-même l'identité de l'utilisateur ; l'option de Supabase n'apporte pas de protection supplémentaire et rejetterait les jetons signés avec les nouvelles clés.
Ne pas copier `source.js` : `index.ts` est la version complète, générée par `node outils/construire-fonctions.mjs`.

## Tests (sur un ordinateur avec Node.js, depuis la racine du dépôt)
- `node moteur/diagnostic.test.mjs` – 35 cas du diagnostic
- `node supabase/tests/creer-litige.test.mjs` – 9 tests de la fonction

## Étape 5 – Hébergement provisoire (Cloudflare Pages)
Projet relié au dépôt privé reprendr-v2, sans commande de construction, publication de la racine.
Adresse provisoire non indexée (robots.txt et balises noindex). Chaque commit sur GitHub met le site à jour automatiquement.
