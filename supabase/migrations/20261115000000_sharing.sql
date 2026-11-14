-- Secure Notes — phase 6 : partage d'une note par lien.
--
-- Partager une note, c'est en déposer une copie rechiffrée avec une clé propre
-- à ce partage. Cette clé n'existe que dans le fragment du lien (après « # »),
-- que les navigateurs n'envoient jamais : le serveur ne peut pas lire la copie.
--
-- La copie est lisible sans compte, mais seulement par qui connaît son
-- identifiant (aléatoire, 122 bits) : la lecture passe par la fonction
-- get_shared_note, la table elle-même n'est pas ouverte au public et ne peut
-- donc pas être parcourue.
--
-- Révoquer un lien, c'est supprimer la ligne : l'effet est immédiat.
--
-- Les copies sont en base, pas dans le bucket Storage : un objet lisible sans
-- compte y serait soit mis en cache (révocation différée), soit énumérable.
-- Leur taille compte dans le quota du compte (profiles.storage_used_bytes).

create table public.shared_notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Copie de la note, chiffrée par la clé du lien, en base64.
  ciphertext text not null,
  -- Ce qu'il faut au propriétaire pour retrouver et recopier le lien (note
  -- d'origine, clé du lien), chiffré par la clé d'enveloppe du compte.
  meta text not null,
  size_bytes bigint generated always as (octet_length(ciphertext)) stored,
  created_at timestamptz not null default now(),
  constraint shared_notes_shape
    check (length(ciphertext) between 1 and 8000000 and length(meta) <= 2000)
);

create index shared_notes_by_user on public.shared_notes (user_id, created_at desc);

-- Même comptabilité que les fichiers joints : la taille est réservée sur le
-- quota à la création, rendue à la suppression.
create trigger shared_notes_count
  after insert on public.shared_notes
  for each row execute function public.attachments_account();

create trigger shared_notes_uncount
  after delete on public.shared_notes
  for each row execute function public.attachments_account();

-- Droits du propriétaire : lire, créer et supprimer ses partages. Pas de
-- modification : un lien désigne toujours la même copie.

alter table public.shared_notes enable row level security;

create policy "shared_notes: lecture de ses partages"
  on public.shared_notes for select to authenticated
  using (user_id = (select auth.uid()));

create policy "shared_notes: ajout de ses partages"
  on public.shared_notes for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "shared_notes: suppression de ses partages"
  on public.shared_notes for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.shared_notes from anon, authenticated;
grant select, insert, delete on public.shared_notes to authenticated;

-- Lecture publique, par identifiant uniquement.
create function public.get_shared_note(share_id uuid)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select ciphertext from public.shared_notes where id = share_id;
$$;

revoke all on function public.get_shared_note(uuid) from public;
grant execute on function public.get_shared_note(uuid) to anon, authenticated;
