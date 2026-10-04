-- =====================================================================
-- Reprendr. v2 – Schéma de la phase A
-- À exécuter une seule fois dans Supabase : SQL Editor > New query > Run
-- Ne touche pas à l'ancienne table "dossiers" (liste d'attente actuelle).
-- Principe de sécurité : les utilisateurs LISENT leurs propres données ;
-- toutes les ÉCRITURES passent par les fonctions serveur (service_role),
-- qui garantissent l'enchaînement correct des étapes.
-- =====================================================================

-- ---------- Types énumérés ----------
create type categorie_litige as enum ('prelevements_abonnements');
create type type_litige as enum ('souscription_cachee', 'service_non_commande', 'resiliation_refusee', 'frais_non_autorises');
create type moyen_paiement as enum ('prelevement_sepa', 'carte', 'autre', 'inconnu');
create type autorisation_paiement as enum ('aucune', 'piegee', 'donnee', 'inconnue');
create type etat_litige as enum (
  'diagnostic',            -- diagnostic terminé, parcours pas encore lancé
  'en_cours',              -- une étape est active (voir table etapes)
  'sans_nouvelles',        -- l'utilisateur ne répond plus aux échéances
  'hors_perimetre',        -- orienté vers un avocat / une association
  'clos'                   -- issue connue ou abandon
);
create type issue_litige as enum ('gain_total', 'gain_partiel', 'refus', 'sans_reponse', 'abandon', 'inconnue');
create type type_etape as enum ('reclamation', 'relance', 'mise_en_demeure', 'mediation', 'banque');
create type statut_etape as enum ('a_valider', 'validee', 'envoyee', 'en_attente', 'terminee', 'annulee');
create type reponse_entreprise as enum ('satisfait', 'partiel', 'refus', 'evasive', 'pas_de_reponse');
create type canal_notification as enum ('email', 'sms');
create type statut_envoi as enum ('prepare', 'depose', 'distribue', 'retourne', 'erreur');
create type statut_paiement as enum ('en_attente', 'paye', 'rembourse', 'echoue');

-- ---------- Utilitaire : mise à jour automatique de updated_at ----------
create or replace function public.maj_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ---------- Profils (1 par compte) ----------
create table public.profils (
  id            uuid primary key references auth.users(id) on delete cascade,
  prenom        text,
  nom           text,
  adresse       text,
  code_postal   text,
  ville         text,
  telephone     text,                       -- facultatif (alertes SMS, phase C)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profils_maj before update on public.profils for each row execute function public.maj_updated_at();

-- Création automatique du profil à l'inscription
create or replace function public.creer_profil() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.profils (id) values (new.id) on conflict do nothing; return new; end; $$;
create trigger auth_creer_profil after insert on auth.users for each row execute function public.creer_profil();

-- ---------- Litiges ----------
create table public.litiges (
  id                          uuid primary key default gen_random_uuid(),
  reference                   text unique not null default ('RPR-' || to_char(now(), 'YYYY') || '-' || upper(substr(md5(random()::text), 1, 6))),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  categorie                   categorie_litige not null default 'prelevements_abonnements',
  type_litige                 type_litige not null,
  moyen_paiement              moyen_paiement not null default 'inconnu',
  autorisation                autorisation_paiement not null default 'inconnue',
  -- Entreprise visée
  entreprise_nom              text not null,
  entreprise_siren            text,
  entreprise_adresse_reclamation text,
  entreprise_adresse_siege    text,
  adresse_confirmee_le        timestamptz,  -- case cochée par l'utilisateur
  numero_client               text,
  nom_offre                   text,
  -- Faits
  circonstances               text,
  date_souscription           date,
  deja_reclame_par_ecrit      boolean not null default false,
  date_reclamation_utilisateur date,
  -- Montants
  montant_reclame             numeric(10,2),
  montant_obtenu              numeric(10,2),
  -- Parcours et issue
  point_entree                type_etape,
  etat                        etat_litige not null default 'diagnostic',
  issue                       issue_litige,
  etape_resolution            type_etape,
  date_cloture                timestamptz,
  -- Satisfaction (indicateurs)
  satisfaction                smallint check (satisfaction between 1 and 5),
  commentaire                 text,
  accord_temoignage           boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index litiges_user_idx on public.litiges(user_id);
create index litiges_etat_idx on public.litiges(etat);
create trigger litiges_maj before update on public.litiges for each row execute function public.maj_updated_at();

-- ---------- Débits contestés (sert aux calculs de délais bancaires) ----------
create table public.debits (
  id          uuid primary key default gen_random_uuid(),
  litige_id   uuid not null references public.litiges(id) on delete cascade,
  date_debit  date not null,
  montant     numeric(10,2) not null check (montant > 0),
  created_at  timestamptz not null default now()
);
create index debits_litige_idx on public.debits(litige_id);

-- ---------- Étapes du parcours ----------
create table public.etapes (
  id             uuid primary key default gen_random_uuid(),
  litige_id      uuid not null references public.litiges(id) on delete cascade,
  type           type_etape not null,
  statut         statut_etape not null default 'a_valider',
  date_debut     timestamptz not null default now(),
  echeance       date,                       -- fin du délai laissé à l'entreprise
  reponse        reponse_entreprise,
  date_reponse   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index etapes_litige_idx on public.etapes(litige_id);
create index etapes_echeance_idx on public.etapes(echeance) where statut = 'en_attente';
-- Une seule étape active à la fois par type et par litige
create unique index etapes_une_active on public.etapes(litige_id, type) where statut not in ('terminee', 'annulee');
create trigger etapes_maj before update on public.etapes for each row execute function public.maj_updated_at();

-- ---------- Documents générés ----------
create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  litige_id        uuid not null references public.litiges(id) on delete cascade,
  etape_id         uuid references public.etapes(id) on delete set null,
  modele_code      text not null,            -- ex. 'A1', 'B', 'C2'
  modele_version   text not null,            -- ex. '2026-10-v1' (traçabilité avocat)
  chemin_stockage  text,                     -- fichier PDF dans Supabase Storage
  valide_le        timestamptz,              -- validation par l'utilisateur
  created_at       timestamptz not null default now()
);
create index documents_litige_idx on public.documents(litige_id);

-- ---------- Envois en recommandé ----------
create table public.envois (
  id                     uuid primary key default gen_random_uuid(),
  litige_id              uuid not null references public.litiges(id) on delete cascade,
  etape_id               uuid references public.etapes(id) on delete set null,
  document_id            uuid references public.documents(id) on delete set null,
  prestataire            text not null default 'merci_facteur',
  reference_prestataire  text,
  recommande_ar          boolean not null default false,
  statut                 statut_envoi not null default 'prepare',
  numero_suivi           text,
  date_depot             timestamptz,
  date_distribution      timestamptz,
  cout                   numeric(10,2),
  chemin_accuse          text,               -- AR numérisé (mise en demeure)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index envois_litige_idx on public.envois(litige_id);
create trigger envois_maj before update on public.envois for each row execute function public.maj_updated_at();

-- ---------- Paiements (un par étape payante) ----------
create table public.paiements (
  id                 uuid primary key default gen_random_uuid(),
  litige_id          uuid not null references public.litiges(id) on delete cascade,
  etape_type         type_etape not null,
  montant            numeric(10,2) not null,
  stripe_session_id  text unique,
  statut             statut_paiement not null default 'en_attente',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index paiements_litige_idx on public.paiements(litige_id);
create trigger paiements_maj before update on public.paiements for each row execute function public.maj_updated_at();

-- ---------- Notifications envoyées ----------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  litige_id   uuid not null references public.litiges(id) on delete cascade,
  etape_id    uuid references public.etapes(id) on delete set null,
  canal       canal_notification not null,
  type        text not null,                 -- ex. 'echeance_reclamation', 'relance_silence'
  envoye_le   timestamptz not null default now(),
  clique_le   timestamptz
);
create index notifications_litige_idx on public.notifications(litige_id);

-- ---------- Jetons de réponse en un clic (jamais lisibles par les utilisateurs) ----------
create table public.jetons_reponse (
  jeton       text primary key,              -- valeur aléatoire longue, générée côté serveur
  etape_id    uuid not null references public.etapes(id) on delete cascade,
  expire_le   timestamptz not null,
  utilise_le  timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- Journal (traçabilité de chaque changement d'état) ----------
create table public.journal (
  id          bigint generated always as identity primary key,
  litige_id   uuid not null references public.litiges(id) on delete cascade,
  evenement   text not null,                 -- ex. 'etape_creee', 'reponse_recue', 'envoi_depose'
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index journal_litige_idx on public.journal(litige_id);

-- =====================================================================
-- Sécurité (Row Level Security)
-- =====================================================================
alter table public.profils        enable row level security;
alter table public.litiges        enable row level security;
alter table public.debits         enable row level security;
alter table public.etapes         enable row level security;
alter table public.documents      enable row level security;
alter table public.envois         enable row level security;
alter table public.paiements      enable row level security;
alter table public.notifications  enable row level security;
alter table public.jetons_reponse enable row level security;
alter table public.journal        enable row level security;

-- Aucun accès anonyme ; lecture seule pour les utilisateurs connectés sur LEURS données
revoke all on public.profils, public.litiges, public.debits, public.etapes, public.documents,
  public.envois, public.paiements, public.notifications, public.jetons_reponse, public.journal
  from anon, authenticated;

grant select, update on public.profils to authenticated;
grant select on public.litiges, public.debits, public.etapes, public.documents,
  public.envois, public.paiements to authenticated;
-- notifications, jetons_reponse et journal : réservés aux fonctions serveur

create policy "profil : lecture du sien"      on public.profils for select to authenticated using (id = auth.uid());
create policy "profil : modification du sien" on public.profils for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "litiges : lecture des siens"   on public.litiges for select to authenticated using (user_id = auth.uid());
create policy "debits : lecture des siens"    on public.debits for select to authenticated
  using (exists (select 1 from public.litiges l where l.id = litige_id and l.user_id = auth.uid()));
create policy "etapes : lecture des siennes"  on public.etapes for select to authenticated
  using (exists (select 1 from public.litiges l where l.id = litige_id and l.user_id = auth.uid()));
create policy "documents : lecture des siens" on public.documents for select to authenticated
  using (exists (select 1 from public.litiges l where l.id = litige_id and l.user_id = auth.uid()));
create policy "envois : lecture des siens"    on public.envois for select to authenticated
  using (exists (select 1 from public.litiges l where l.id = litige_id and l.user_id = auth.uid()));
create policy "paiements : lecture des siens" on public.paiements for select to authenticated
  using (exists (select 1 from public.litiges l where l.id = litige_id and l.user_id = auth.uid()));

-- Accès complet pour les fonctions serveur
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- =====================================================================
-- Indicateurs (lecture réservée aux fonctions serveur / tableau de bord)
-- =====================================================================
create view public.v_indicateurs_mensuels with (security_invoker = true) as
select
  date_trunc('month', l.created_at)::date                                   as mois,
  l.type_litige,
  count(*)                                                                  as litiges,
  count(*) filter (where l.issue is not null and l.issue <> 'inconnue')     as issues_connues,
  count(*) filter (where l.issue in ('gain_total', 'gain_partiel'))         as succes,
  round(100.0 * count(*) filter (where l.issue in ('gain_total', 'gain_partiel'))
        / nullif(count(*) filter (where l.issue is not null and l.issue <> 'inconnue'), 0), 1) as taux_succes_pct,
  round(100.0 * count(*) filter (where l.issue is not null and l.issue <> 'inconnue') / count(*), 1) as taux_issue_connue_pct,
  sum(l.montant_obtenu)                                                     as montant_obtenu_total,
  round(100.0 * sum(l.montant_obtenu) / nullif(sum(l.montant_reclame) filter (where l.issue is not null), 0), 1) as taux_recuperation_pct
from public.litiges l
group by 1, 2;
revoke all on public.v_indicateurs_mensuels from anon, authenticated;
grant select on public.v_indicateurs_mensuels to service_role;
