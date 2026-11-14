-- Secure Notes — phase 7 (revue de sécurité) : les notes comptent dans le quota.
--
-- Jusqu'ici, seuls les fichiers et les copies partagées comptaient : un compte
-- pouvait déposer un nombre illimité de notes (4 Mo chacune au plus). Comme
-- l'inscription est ouverte à qui connaît la clé publique de l'instance, c'était
-- un moyen de remplir la base.
--
-- Désormais, la taille chiffrée de chaque note ou catégorie compte aussi dans
-- profiles.storage_used_bytes. Une écriture qui agrandit un élément est refusée
-- (`storage_quota_exceeded`) si elle dépasse le quota ; une écriture qui le
-- réduit (une suppression, par exemple) passe toujours.

create function public.items_account()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  delta bigint := octet_length(new.ciphertext) + octet_length(new.wrapped_key);
begin
  if tg_op = 'UPDATE' then
    delta := delta - octet_length(old.ciphertext) - octet_length(old.wrapped_key);
  else
    insert into public.profiles (user_id) values (new.user_id) on conflict do nothing;
  end if;
  if delta > 0 then
    update public.profiles
       set storage_used_bytes = storage_used_bytes + delta
     where user_id = new.user_id
       and storage_used_bytes + delta <= storage_quota_bytes;
    if not found then
      raise exception 'storage_quota_exceeded';
    end if;
  elsif delta < 0 then
    update public.profiles
       set storage_used_bytes = greatest(0, storage_used_bytes + delta)
     where user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.items_account() from public, anon, authenticated;

create trigger items_count
  after insert or update on public.items
  for each row execute function public.items_account();

-- Les éléments déjà déposés.
update public.profiles p
   set storage_used_bytes = p.storage_used_bytes + coalesce((
     select sum(octet_length(i.ciphertext) + octet_length(i.wrapped_key))
       from public.items i
      where i.user_id = p.user_id
   ), 0);
