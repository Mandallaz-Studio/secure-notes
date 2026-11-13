import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import { ThemePreferenceProvider, useThemePreference } from '@/theme/theme-preference';
import { useVault, VaultProvider } from '@/vault/vault-context';

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <VaultProvider>
        <Navigation />
      </VaultProvider>
    </ThemePreferenceProvider>
  );
}

function Navigation() {
  const { scheme } = useThemePreference();
  const { status } = useVault();
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
      {/* Tant que l'état du coffre est inconnu, rien n'est affiché. */}
      {status !== 'loading' && (
        <Stack
          screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
          {/* Les écrans de l'app n'existent que coffre déverrouillé. */}
          <Stack.Protected guard={status === 'unlocked'}>
            <Stack.Screen name="index" options={{ title: 'Notes' }} />
            <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
            <Stack.Screen name="dev/crypto" options={{ title: 'Essai chiffrement' }} />
            <Stack.Screen name="dev/editor" options={{ title: 'Essai éditeur' }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'empty'}>
            <Stack.Screen
              name="onboarding/index"
              options={{ title: 'Accueil', headerShown: false }}
            />
            <Stack.Screen name="onboarding/create" options={{ title: 'Nouveau coffre' }} />
            <Stack.Screen name="onboarding/restore" options={{ title: 'Restauration' }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'locked'}>
            <Stack.Screen name="lock" options={{ headerShown: false }} />
          </Stack.Protected>
        </Stack>
      )}
    </ThemeProvider>
  );
}
