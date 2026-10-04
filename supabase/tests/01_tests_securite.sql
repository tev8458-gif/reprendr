-- Tests de sécurité du schéma (environnement de test local)
\set ON_ERROR_STOP 0
insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111','alice@test.fr'),
 ('22222222-2222-2222-2222-222222222222','bob@test.fr');
select 'profils créés automatiquement : ' || count(*) from public.profils;

set role service_role;
insert into public.litiges (id, user_id, type_litige, entreprise_nom, montant_reclame) values
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','souscription_cachee','Société X',51.96),
 ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','resiliation_refusee','Société Y',120);
insert into public.etapes (litige_id, type, statut, echeance) values ('aaaaaaaa-0000-0000-0000-000000000001','reclamation','en_attente', current_date + 15);
insert into public.jetons_reponse (jeton, etape_id, expire_le) select 'secret', id, now() + interval '30 days' from public.etapes limit 1;
reset role;

-- Alice connectée
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'TEST 1 – Alice voit ' || count(*) || ' litige(s) (attendu : 1)' from public.litiges;
select 'TEST 2 – Alice voit ' || count(*) || ' étape(s) (attendu : 1)' from public.etapes;
\echo 'TEST 3 – Alice tente de créer un litige (attendu : refus)'
insert into public.litiges (user_id, type_litige, entreprise_nom) values ('11111111-1111-1111-1111-111111111111','souscription_cachee','Z');
\echo 'TEST 4 – Alice tente de lire les jetons (attendu : refus)'
select * from public.jetons_reponse;
\echo 'TEST 5 – Alice tente de lire les indicateurs (attendu : refus)'
select * from public.v_indicateurs_mensuels;
\echo 'TEST 6 – Alice tente de modifier l issue de son litige (attendu : refus)'
update public.litiges set issue = 'gain_total';
update public.profils set prenom = 'Alice';
select 'TEST 7 – Alice modifie son profil : ' || coalesce(prenom,'(échec)') from public.profils;
reset role;

-- Bob connecté
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'TEST 8 – Bob voit ' || count(*) || ' litige(s), aucun d Alice : ' || bool_and(entreprise_nom <> 'Société X') from public.litiges;
update public.profils set prenom = 'Pirate' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select 'TEST 9 – le profil d Alice n a pas été modifié par Bob : ' || prenom from public.profils where id = '11111111-1111-1111-1111-111111111111';

-- Visiteur anonyme
set role anon;
\echo 'TEST 10 – visiteur anonyme lit les litiges (attendu : refus)'
select count(*) from public.litiges;
reset role;

-- Contrainte : une seule étape active par type
set role service_role;
\echo 'TEST 11 – deuxième réclamation active sur le même litige (attendu : refus)'
insert into public.etapes (litige_id, type) values ('aaaaaaaa-0000-0000-0000-000000000001','reclamation');
select 'TEST 12 – référence générée : ' || reference from public.litiges limit 1;
reset role;
