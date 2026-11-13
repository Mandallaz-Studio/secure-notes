import { getPref, setPref } from '@/storage/prefs';
import type { SyncInstance } from '@/sync/supabase';

/**
 * Réglages de synchronisation de cet appareil. Rien de secret : la clé « anon »
 * d'une instance Supabase est publique par nature.
 *
 * La synchronisation est désactivée par défaut : sans elle, l'app n'émet
 * aucune requête réseau.
 */
export type SyncConfig = SyncInstance & { enabled: boolean };

const PREF_ENABLED = 'sync.enabled';
const PREF_URL = 'sync.url';
const PREF_ANON_KEY = 'sync.anon-key';

export function loadSyncConfig(): SyncConfig {
  return {
    enabled: getPref(PREF_ENABLED) === '1',
    // Instance proposée par défaut, fixée à la compilation (peut être absente).
    url: getPref(PREF_URL) ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    anonKey: getPref(PREF_ANON_KEY) ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
}

export function saveSyncConfig(config: SyncConfig): void {
  setPref(PREF_ENABLED, config.enabled ? '1' : '0');
  setPref(PREF_URL, config.url);
  setPref(PREF_ANON_KEY, config.anonKey);
}
