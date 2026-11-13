import { Storage } from 'expo-sqlite/kv-store';

/**
 * Préférences non sensibles (thème, options d'affichage…), stockées en clair.
 * Ne jamais y mettre de clé ni de contenu de note : voir `vault/key-store`.
 */

export function getPref(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string): void {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Préférence non critique : la valeur reste en mémoire pour la session.
  }
}

export function removePref(key: string): void {
  try {
    Storage.removeItemSync(key);
  } catch {
    // Idem.
  }
}
