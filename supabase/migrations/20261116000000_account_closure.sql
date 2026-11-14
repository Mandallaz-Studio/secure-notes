-- Secure Notes — phase 7 : fermeture d'un compte.
--
-- « Recréer le coffre » (phrase perdue mais appareil encore connecté) donne
-- un nouveau compte ; l'ancien est ensuite vidé et fermé par l'app.
--
-- Un compte fermé n'est pas supprimé de auth.users : il reste, vide, comme
-- pierre tombale. Sinon, un autre appareil resté sur l'ancien coffre le
-- recréerait à sa prochaine connexion (l'app crée le compte quand il n'existe
-- pas) et y renverrait toutes ses notes. Fermé, le compte accepte encore la
-- connexion mais plus aucune écriture, et l'app sait l'annoncer.
--
-- L'app supprime d'abord les blocs du bucket (Storage ne laisse pas une
-- fonction SQL supprimer ses objets), puis appelle close_account(), qui
-- refuse tant qu'il en reste.

alter table public.profiles
  add column closed_at timestamptz;

-- Le compte de l'appelant accepte-t-il encore des écritures ?
create function public.account_open()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid() and p.closed_at is not null
  );
$$;

revoke all on function public.account_open() from public, anon;
grant execute on function public.account_open() to authenticated;

-- Plus aucune écriture sur un compte fermé.

alter policy "items: ajout de ses éléments" on public.items
  with check (user_id = (select auth.uid()) and (select public.account_open()));

alter policy "items: modification de ses éléments" on public.items
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.account_open()));

alter policy "attachments: ajout de ses fichiers" on public.attachments
  with check (user_id = (select auth.uid()) and (select public.account_open()));

alter policy "shared_notes: ajout de ses partages" on public.shared_notes
  with check (user_id = (select auth.uid()) and (select public.account_open()));

-- Dépôt d'un bloc : même règle, ajoutée à la fonction qu'utilise déjà la
-- politique du bucket (aucune politique de storage.objects n'est modifiée).
create or replace function public.attachment_chunk_allowed(object_name text)
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
  if not public.account_open() then
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

-- Vide et ferme le compte de l'appelant. Sans effet sur un compte déjà fermé
-- et vide : l'app peut la rappeler après une interruption.
create function public.close_account()
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if exists (
    select 1 from storage.objects o
     where o.bucket_id = 'attachments' and o.name like uid::text || '/%'
  ) then
    raise exception 'attachments_remaining';
  end if;
  -- Fermer d'abord : plus rien ne peut être ajouté pendant le ménage.
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  update public.profiles set closed_at = coalesce(closed_at, now()) where user_id = uid;
  delete from public.shared_notes where user_id = uid;
  delete from public.attachments where user_id = uid;
  delete from public.items where user_id = uid;
  update public.profiles set storage_used_bytes = 0 where user_id = uid;
end;
$$;

revoke all on function public.close_account() from public, anon;
grant execute on function public.close_account() to authenticated;

-- L'app lit closed_at avec le reste du profil.
-- (La politique de lecture de profiles et le droit select existent déjà.)
