import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';

import type { ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadStoredTheme, storeTheme } from '@/theme/theme-storage';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeContextValue = {
  /** Choix de l'utilisateur. */
  preference: ThemePreference;
  /** Thème réellement appliqué. */
  scheme: ColorScheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function parsePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    parsePreference(loadStoredTheme()),
  );
  const systemScheme = useColorScheme();

  // Sur mobile, les éléments natifs (clavier, alertes, barres système) suivent
  // aussi le choix de l'utilisateur.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    }
  }, [preference]);

  const scheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    storeTheme(next);
  };

  return <ThemeContext value={{ preference, scheme, setPreference }}>{children}</ThemeContext>;
}

export function useThemePreference(): ThemeContextValue {
  const value = use(ThemeContext);
  if (!value) {
    throw new Error('useThemePreference doit être utilisé sous ThemePreferenceProvider');
  }
  return value;
}
