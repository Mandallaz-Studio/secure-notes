-- Secure Notes — envoi d'un lien de partage par QR code.
--
-- Un navigateur (extension) ou une autre app affiche un QR code ; le téléphone
-- qui le scanne y dépose un lien de partage, chiffré, que l'afficheur relève.
-- Cette table n'est qu'une boîte aux lettres de quelques minutes :
--
-- - L'identifiant d'un dépôt est dérivé d'un secret de 256 bits qui n'existe
--   que dans le QR code : personne d'autre ne peut le deviner, ni le relever.
-- - Le contenu est chiffré deux fois (clé tirée du secret, puis clé publique
--   éphémère de l'afficheur, elle aussi dans le QR code) : le serveur ne peut
--   pas le lire, ni le remplacer sans que l'afficheur s'en aperçoive.
-- - Seul un compte connecté (celui qui partage, synchronisation active) peut
--   déposer, une seule fois par identifiant, et au plus 20 dépôts en attente :
--   aucune écriture anonyme.
-- - La relève est publique, par identifiant uniquement, et supprime la ligne.
--   Une ligne de plus de 5 minutes n'est plus servie, et elle est effacée au
--   dépôt suivant.

create table public.handoffs (
  -- Empreinte du secret, en base64 « URL » (256 bits).
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Message chiffré, en base64.
  payload text not null,
  created_at timestamptz not null default now(),
  constraint handoffs_shape
    check (id ~ '^[A-Za-z0-9_-]{43}$' and length(payload) between 1 and 4096)
);

create index handoffs_by_user on public.handoffs (user_id);
create index handoffs_by_age on public.handoffs (created_at);

-- Ménage et plafond, avant chaque dépôt.
create function public.handoffs_admit()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  delete from public.handoffs where created_at < now() - interval '5 minutes';
  if (select count(*) from public.handoffs where user_id = new.user_id) >= 20 then
    raise exception 'handoff_limit';
  end if;
  -- L'heure de dépôt est celle du serveur.
  new.created_at := now();
  return new;
end;
$$;

revoke all on function public.handoffs_admit() from public, anon, authenticated;

create trigger handoffs_admit
  before insert on public.handoffs
  for each row execute function public.handoffs_admit();

-- Le compte peut seulement déposer : ni lecture, ni modification, ni
-- suppression (une ligne sert une fois, puis disparaît à la relève).

alter table public.handoffs enable row level security;

create policy "handoffs: dépôt"
  on public.handoffs for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.account_open()));

revoke all on public.handoffs from anon, authenticated;
grant insert on public.handoffs to authenticated;

-- Relève, sans compte, par identifiant : renvoie le message et le supprime.
create function public.take_handoff(handoff_id text)
  returns text
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  delete from public.handoffs
   where id = handoff_id and created_at >= now() - interval '5 minutes'
  returning payload;
$$;

revoke all on function public.take_handoff(text) from public;
grant execute on function public.take_handoff(text) to anon, authenticated;
