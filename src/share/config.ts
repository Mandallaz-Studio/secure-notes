import type { ShareInstance } from '@/share/codec';

/**
 * Adresse du site de lecture des liens partagés (`https://notes.exemple.fr`),
 * fixée à la compilation par `EXPO_PUBLIC_SHARE_BASE_URL`. Tant qu'elle n'est
 * pas définie, les liens utilisent le schéma de l'app et ne s'ouvrent que sur
 * un appareil où elle est installée.
 */
export const SHARE_SITE = (process.env.EXPO_PUBLIC_SHARE_BASE_URL ?? '').trim();

export const SHARE_LINK_BASE = SHARE_SITE === '' ? 'securenotes://' : SHARE_SITE;

/** Instance que la page de lecture utilise quand le lien n'en précise pas. */
export function defaultInstance(): ShareInstance | null {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  return url !== '' && anonKey !== '' ? { url, anonKey } : null;
}

/** Instance à écrire dans le lien : `null` si c'est celle par défaut. */
export function instanceForLink(current: ShareInstance): ShareInstance | null {
  const known = defaultInstance();
  return known && known.url === current.url && known.anonKey === current.anonKey
    ? null
    : { url: current.url, anonKey: current.anonKey };
}
