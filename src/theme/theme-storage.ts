import { Storage } from 'expo-sqlite/kv-store';

const KEY = 'theme-preference';

export function loadStoredTheme(): string | null {
  try {
    return Storage.getItemSync(KEY);
  } catch {
    return null;
  }
}

export function storeTheme(value: string): void {
  try {
    Storage.setItemSync(KEY, value);
  } catch {
    // Préférence non critique : on garde la valeur en mémoire pour la session.
  }
}
