-- Secure Notes — phase 4 : synchronisation.
--
-- Le serveur ne stocke que des blobs chiffrés sur l'appareil. Il ne voit que
-- des identifiants, des dates et des tailles. Une suppression définitive est
-- elle aussi un blob chiffré : le serveur ne peut ni la reconnaître ni en
-- fabriquer une.
--
-- Réglage requis sur l'instance : Authentication → Sign In / Providers → Email
-- → désactiver « Confirm email » (les comptes utilisent une adresse synthétique
-- dérivée de la phrase de récupération, aucun e-mail n'est jamais envoyé).

-- ---------------------------------------------------------------------------
-- Profils : un par compte, créé à l'inscription. Le quota sert en phase 5.
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  storage_quota_bytes bigint not null default 52428800,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Lecture seule pour l'utilisateur : le quota ne se modifie que côté serveur.
create policy "profiles: lecture de son profil"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Éléments synchronisés (notes et catégories, indistinctement).
-- ---------------------------------------------------------------------------

create sequence public.items_seq as bigint;

create table public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  -- Numéro de modification attribué par le serveur : curseur de téléchargement
  -- et contrôle de concurrence (une mise à jour précise le numéro qu'elle remplace).
  seq bigint not null,
  -- Contenu chiffré (XChaCha20-Poly1305), en base64.
  ciphertext text not null,
  -- Clé propre à l'élément, chiffrée par la clé d'enveloppe du compte, en base64.
  wrapped_key text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint items_size check (length(ciphertext) <= 4000000 and length(wrapped_key) <= 200)
);

create index items_by_seq on public.items (user_id, seq);

create function public.items_stamp()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  -- Les écritures d'un même compte sont mises en file : ses numéros sont ainsi
  -- validés dans l'ordre, et un appareil qui télécharge « après le numéro N »
  -- ne peut pas manquer une écriture validée en retard.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.seq := nextval('public.items_seq');
  new.updated_at := now();
  return new;
end;
$$;

create trigger items_stamp
  before insert or update on public.items
  for each row execute function public.items_stamp();

alter table public.items enable row level security;

create policy "items: lecture de ses éléments"
  on public.items for select to authenticated
  using (user_id = (select auth.uid()));

create policy "items: ajout de ses éléments"
  on public.items for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "items: modification de ses éléments"
  on public.items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Pas de suppression de ligne : une suppression est une mise à jour comme une autre.
revoke all on public.items from anon, authenticated;
grant select, insert, update on public.items to authenticated;
revoke all on sequence public.items_seq from anon, authenticated;
grant usage on sequence public.items_seq to authenticated;
