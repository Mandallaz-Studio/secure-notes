/** Préférences non sensibles ; voir `prefs.ts`. */

export function getPref(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée, rendu statique) : sans gravité.
  }
}

export function removePref(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Idem.
  }
}
