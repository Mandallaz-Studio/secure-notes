-- Secure Notes — phase 5 : fichiers joints et images.
--
-- Un fichier est chiffré sur l'appareil, par blocs de 256 Kio. Le serveur ne
-- voit que des identifiants, des tailles et des blocs chiffrés ; les noms et
-- types de fichiers sont dans les notes, elles-mêmes chiffrées.
--
-- Les blocs chiffrés sont des objets du bucket Storage privé « attachments »,
-- sous le chemin <compte>/<fichier>/<rang du bloc> : ils n'occupent pas la base
-- Postgres. La table `attachments` ne garde qu'une ligne par fichier (clé
-- chiffrée, nombre de blocs, taille).
--
-- Quota : profiles.storage_quota_bytes (50 Mo par défaut), modifiable par
-- compte depuis le serveur, par exemple :
--   update public.profiles set storage_quota_bytes = 209715200 where user_id = '…';
--
-- Il est appliqué deux fois :
--   1. à la déclaration du fichier (ligne `attachments`) : sa taille annoncée
--      est réservée, ou la déclaration est refusée (`storage_quota_exceeded`) ;
--   2. au dépôt de chaque bloc : refusé si la place réellement occupée dans le
--      bucket atteint déjà le quota. Un client modifié qui annoncerait de
--      fausses tailles ne dépasse donc le quota que d'un bloc au plus.
--
-- À savoir : supprimer un compte (auth.users) supprime ses lignes, pas ses
-- objets Storage ; vider son dossier du bucket depuis le tableau de bord.

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
  -- Taille totale des blocs chiffrés, en octets (262 184 par bloc plein :
  -- 256 Kio, plus 40 octets de nonce et de sceau).
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint attachments_shape check (
    length(wrapped_key) <= 200
    and chunk_count between 1 and 4096
    and size_bytes > (chunk_count - 1) * 262184::bigint
    and size_bytes <= chunk_count * 262184::bigint
  )
);

create function public.attachments_account()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (user_id) values (new.user_id) on conflict do nothing;
    -- La ligne du profil est verrouillée par cette mise à jour : deux
    -- déclarations simultanées ne peuvent pas dépasser le quota à elles deux.
    update public.profiles
       set storage_used_bytes = storage_used_bytes + new.size_bytes
     where user_id = new.user_id
       and storage_used_bytes + new.size_bytes <= storage_quota_bytes;
    if not found then
      raise exception 'storage_quota_exceeded';
    end if;
    return new;
  end if;
  update public.profiles
     set storage_used_bytes = greatest(0, storage_used_bytes - old.size_bytes)
   where user_id = old.user_id;
  return old;
end;
$$;

revoke all on function public.attachments_account() from public, anon, authenticated;

create trigger attachments_count
  after insert on public.attachments
  for each row execute function public.attachments_account();

create trigger attachments_uncount
  after delete on public.attachments
  for each row execute function public.attachments_account();

-- Droits : chacun ne lit, n'ajoute et ne supprime que ses fichiers. Pas de
-- modification : un fichier ne change jamais.

alter table public.attachments enable row level security;

create policy "attachments: lecture de ses fichiers"
  on public.attachments for select to authenticated
  using (user_id = (select auth.uid()));

create policy "attachments: ajout de ses fichiers"
  on public.attachments for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "attachments: suppression de ses fichiers"
  on public.attachments for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.attachments from anon, authenticated;
grant select, insert, delete on public.attachments to authenticated;

-- ---------------------------------------------------------------------------
-- Blocs chiffrés : bucket Storage privé, un objet par bloc.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 262184)
on conflict (id) do update set public = false, file_size_limit = 262184;

-- Le bloc <compte>/<fichier>/<rang> peut-il être déposé par l'appelant ?
create function public.attachment_chunk_allowed(object_name text)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  parts text[] := string_to_array(object_name, '/');
  stored bigint;
begin
  if uid is null
     or array_length(parts, 1) is distinct from 3
     or parts[1] <> uid::text
     or parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or parts[3] !~ '^(0|[1-9][0-9]{0,3})$' then
    return false;
  end if;
  -- Le fichier doit avoir été déclaré, et le rang exister.
  if not exists (
    select 1 from public.attachments a
     where a.user_id = uid and a.id = parts[2]::uuid and parts[3]::integer < a.chunk_count
  ) then
    return false;
  end if;
  -- Place réellement occupée par le compte dans le bucket.
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into stored
    from storage.objects o
   where o.bucket_id = 'attachments' and o.name like uid::text || '/%';
  return stored < (select p.storage_quota_bytes from public.profiles p where p.user_id = uid);
end;
$$;

revoke all on function public.attachment_chunk_allowed(text) from public, anon;
grant execute on function public.attachment_chunk_allowed(text) to authenticated;

-- Pas de politique de modification : un bloc déposé ne peut pas être remplacé.

create policy "secure-notes: lecture de ses blocs"
  on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "secure-notes: ajout de ses blocs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.attachment_chunk_allowed(name));

create policy "secure-notes: suppression de ses blocs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
