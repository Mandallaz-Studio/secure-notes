import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import { ThemePreferenceProvider, useThemePreference } from '@/theme/theme-preference';

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <Navigation />
    </ThemePreferenceProvider>
  );
}

function Navigation() {
  const { scheme } = useThemePreference();
  const colors = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: colors.tint,
          background: colors.background,
          card: colors.background,
          text: colors.text,
          border: colors.border,
        },
      }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="index" options={{ title: 'Notes' }} />
        <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
        <Stack.Screen name="dev/crypto" options={{ title: 'Essai chiffrement' }} />
        <Stack.Screen name="dev/editor" options={{ title: 'Essai éditeur' }} />
      </Stack>
    </ThemeProvider>
  );
}
