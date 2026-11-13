const KEY = 'theme-preference';

export function loadStoredTheme(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeTheme(value: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    // Stockage indisponible (navigation privée, rendu statique) : sans gravité.
  }
}
