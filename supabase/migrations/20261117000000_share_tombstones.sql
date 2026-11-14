-- Secure Notes — revue de sécurité (SN-01) : un lien révoqué ne peut plus être repris.
--
-- L'identifiant d'un partage est choisi par l'app, et la seule preuve qu'une
-- copie est authentique est la clé du lien, que connaissent tous ses
-- destinataires. Tant que la ligne existe, la clé primaire empêche quiconque
-- d'écrire sous cet identifiant. Mais révoquer un lien supprimait la ligne et
-- libérait l'identifiant : n'importe quel destinataire pouvait alors, avec un
-- compte quelconque (l'inscription est ouverte), déposer sous cet identifiant
-- une fausse note chiffrée avec la clé du lien, que les autres destinataires
-- voyaient comme authentique.
--
-- Désormais un identifiant ne sert qu'une fois : sa suppression (révocation,
-- note mise à la corbeille, close_account(), suppression du compte) le note
-- dans revoked_shares, et un partage ne peut plus être créé sous un
-- identifiant noté. get_shared_note() ne change pas : il ne trouve plus la
-- ligne et répond null (« lien révoqué »).
--
-- Le transfert des liens lors de « Recréer le coffre » ne passe donc plus par
-- une suppression suivie d'une recréation (fenêtre pendant laquelle un
-- destinataire pouvait prendre l'identifiant) : transfer_share() change le
-- propriétaire de la ligne en une seule transaction, avec l'accord préalable
-- du nouveau compte (accept_shares_from).
--
-- Les identifiants révoqués avant cette migration ne sont pas connus : ils
-- restent réutilisables.

create table public.revoked_shares (
  id uuid primary key,
  revoked_at timestamptz not null default now()
);

-- Aucun accès direct : seules les fonctions ci-dessous y touchent.
alter table public.revoked_shares enable row level security;
revoke all on public.revoked_shares from anon, authenticated;

create function public.shared_notes_bury()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.revoked_shares (id) values (old.id) on conflict do nothing;
  return old;
end;
$$;

revoke all on function public.shared_notes_bury() from public, anon, authenticated;

create trigger shared_notes_bury
  after delete on public.shared_notes
  for each row execute function public.shared_notes_bury();

create function public.shared_notes_fresh_id()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.revoked_shares r where r.id = new.id) then
    raise exception 'share_id_revoked';
  end if;
  return new;
end;
$$;

revoke all on function public.shared_notes_fresh_id() from public, anon, authenticated;

create trigger shared_notes_fresh_id
  before insert on public.shared_notes
  for each row execute function public.shared_notes_fresh_id();

-- ---------------------------------------------------------------------------
-- Transfert des liens d'un ancien compte à son successeur (« Recréer le coffre »).
-- ---------------------------------------------------------------------------

-- Le successeur accepte de recevoir les liens de l'ancien compte. Sans cet
-- accord, un compte pourrait déposer ses partages (et leur poids sur le quota)
-- chez n'importe quel autre.
create table public.share_handovers (
  predecessor uuid not null references auth.users (id) on delete cascade,
  successor uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (predecessor, successor)
);

alter table public.share_handovers enable row level security;
revoke all on public.share_handovers from anon, authenticated;

create function public.accept_shares_from(predecessor uuid)
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
  if predecessor = uid then
    raise exception 'invalid_predecessor';
  end if;
  insert into public.share_handovers (predecessor, successor)
    values (predecessor, uid)
    on conflict do nothing;
end;
$$;

revoke all on function public.accept_shares_from(uuid) from public, anon;
grant execute on function public.accept_shares_from(uuid) to authenticated;

-- Passe le partage `share_id` de l'appelant au compte `successor`, avec ses
-- nouvelles métadonnées (chiffrées par la clé d'enveloppe du successeur). Le
-- lien ne cesse jamais d'exister : personne ne peut prendre son identifiant.
-- @returns true si le partage appartient désormais au successeur (y compris
--   par un transfert précédent), false si l'appelant ne l'a plus.
create function public.transfer_share(share_id uuid, successor uuid, new_meta text)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  moved bigint;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if new_meta is null or length(new_meta) > 2000 then
    raise exception 'invalid_meta';
  end if;
  if not exists (
    select 1 from public.share_handovers h
     where h.predecessor = uid and h.successor = transfer_share.successor
  ) then
    raise exception 'handover_not_accepted';
  end if;
  -- Reprise après une interruption : déjà fait.
  if exists (
    select 1 from public.shared_notes s
     where s.id = share_id and s.user_id = transfer_share.successor
  ) then
    return true;
  end if;
  if exists (
    select 1 from public.profiles p
     where p.user_id = transfer_share.successor and p.closed_at is not null
  ) then
    raise exception 'account_closed';
  end if;

  select s.size_bytes into moved
    from public.shared_notes s
   where s.id = share_id and s.user_id = uid
     for update;
  if not found then
    return false;
  end if;

  -- Le poids de la copie passe d'un quota à l'autre.
  insert into public.profiles (user_id) values (transfer_share.successor) on conflict do nothing;
  update public.profiles
     set storage_used_bytes = storage_used_bytes + moved
   where user_id = transfer_share.successor
     and storage_used_bytes + moved <= storage_quota_bytes;
  if not found then
    raise exception 'storage_quota_exceeded';
  end if;
  update public.profiles
     set storage_used_bytes = greatest(0, storage_used_bytes - moved)
   where user_id = uid;

  update public.shared_notes
     set user_id = transfer_share.successor, meta = new_meta
   where id = share_id;
  return true;
end;
$$;

revoke all on function public.transfer_share(uuid, uuid, text) from public, anon;
grant execute on function public.transfer_share(uuid, uuid, text) to authenticated;
