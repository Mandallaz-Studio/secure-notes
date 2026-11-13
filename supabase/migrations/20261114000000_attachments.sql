-- Secure Notes — phase 5 : fichiers joints et images.
--
-- Un fichier est chiffré sur l'appareil, par blocs de 256 Kio. Le serveur ne
-- voit que des identifiants, des tailles et des blocs chiffrés ; les noms et
-- types de fichiers sont dans les notes, elles-mêmes chiffrées.
--
-- Les blocs sont stockés en base plutôt que dans un bucket Storage : le quota
-- est ainsi vérifié dans la transaction même qui écrit le bloc, sans dépendre
-- des métadonnées de Storage (inconnues au moment où ses politiques s'appliquent).
--
-- Quota : profiles.storage_quota_bytes (50 Mo par défaut), modifiable par
-- compte depuis le serveur, par exemple :
--   update public.profiles set storage_quota_bytes = 209715200 where user_id = '…';

alter table public.profiles
  add column storage_used_bytes bigint not null default 0;

-- ---------------------------------------------------------------------------
-- Fichiers : un par image ou pièce jointe.
-- ---------------------------------------------------------------------------

create table public.attachments (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  -- Clé propre au fichier, chiffrée par la clé d'enveloppe du compte, en base64.
  wrapped_key text not null,
  chunk_count integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint attachments_shape
    check (length(wrapped_key) <= 200 and chunk_count between 1 and 4096)
);

create table public.attachment_chunks (
  user_id uuid not null default auth.uid(),
  attachment_id uuid not null,
  idx integer not null,
  -- Bloc chiffré (XChaCha20-Poly1305), en base64.
  data text not null,
  primary key (user_id, attachment_id, idx),
  foreign key (user_id, attachment_id)
    references public.attachments (user_id, id) on delete cascade,
  constraint attachment_chunks_shape check (idx >= 0 and length(data) <= 400000)
);

-- ---------------------------------------------------------------------------
-- Quota : chaque bloc écrit est compté, chaque bloc supprimé est décompté.
-- ---------------------------------------------------------------------------

create function public.attachment_chunks_account()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  bytes bigint;
begin
  if tg_op = 'INSERT' then
    if new.idx >= (select chunk_count from public.attachments
                    where user_id = new.user_id and id = new.attachment_id) then
      raise exception 'attachment_chunk_out_of_range';
    end if;
    -- Taille du bloc chiffré, déduite de sa forme en base64.
    bytes := (length(new.data)::bigint * 3) / 4;
    insert into public.profiles (user_id) values (new.user_id) on conflict do nothing;
    -- La ligne du profil est verrouillée par cette mise à jour : deux envois
    -- simultanés ne peuvent pas dépasser le quota à eux deux.
    update public.profiles
       set storage_used_bytes = storage_used_bytes + bytes
     where user_id = new.user_id
       and storage_used_bytes + bytes <= storage_quota_bytes;
    if not found then
      raise exception 'storage_quota_exceeded';
    end if;
    return new;
  end if;
  update public.profiles
     set storage_used_bytes = greatest(0, storage_used_bytes - (length(old.data)::bigint * 3) / 4)
   where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.attachment_chunks_account() from public, anon, authenticated;

create trigger attachment_chunks_count
  after insert on public.attachment_chunks
  for each row execute function public.attachment_chunks_account();

create trigger attachment_chunks_uncount
  after delete on public.attachment_chunks
  for each row execute function public.attachment_chunks_account();

-- ---------------------------------------------------------------------------
-- Droits : chacun ne lit, n'ajoute et ne supprime que ses fichiers. Pas de
-- modification : un fichier ne change jamais.
-- ---------------------------------------------------------------------------

alter table public.attachments enable row level security;
alter table public.attachment_chunks enable row level security;

create policy "attachments: lecture de ses fichiers"
  on public.attachments for select to authenticated
  using (user_id = (select auth.uid()));

create policy "attachments: ajout de ses fichiers"
  on public.attachments for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "attachments: suppression de ses fichiers"
  on public.attachments for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "attachment_chunks: lecture de ses blocs"
  on public.attachment_chunks for select to authenticated
  using (user_id = (select auth.uid()));

create policy "attachment_chunks: ajout de ses blocs"
  on public.attachment_chunks for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "attachment_chunks: suppression de ses blocs"
  on public.attachment_chunks for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.attachments from anon, authenticated;
grant select, insert, delete on public.attachments to authenticated;
revoke all on public.attachment_chunks from anon, authenticated;
grant select, insert, delete on public.attachment_chunks to authenticated;
