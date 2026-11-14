import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { NotesProvider } from '@/notes/notes-context';
import { SyncProvider } from '@/sync/sync-context';
import { ThemePreferenceProvider, useThemePreference } from '@/theme/theme-preference';
import { useVault, VaultProvider } from '@/vault/vault-context';

/**
 * Sur le web, l'app ne sert qu'à lire les notes partagées : un navigateur n'a
 * pas de stockage sécurisé où garder un coffre.
 */
const READER_ONLY = Platform.OS === 'web';

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <VaultProvider>
        <NotesProvider>
          <SyncProvider>
            <Navigation />
          </SyncProvider>
        </NotesProvider>
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
          <Stack.Protected guard={!READER_ONLY && status === 'unlocked'}>
            <Stack.Screen name="index" options={{ title: 'Notes' }} />
            <Stack.Screen name="note/[id]" options={{ title: '' }} />
            <Stack.Screen name="categories" options={{ title: 'Catégories' }} />
            <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
            <Stack.Screen name="share/[noteId]" options={{ title: 'Partage par lien' }} />
            <Stack.Screen name="dev/crypto" options={{ title: 'Essai chiffrement' }} />
            <Stack.Screen name="dev/editor" options={{ title: 'Essai éditeur' }} />
          </Stack.Protected>
          <Stack.Protected guard={!READER_ONLY && status === 'empty'}>
            <Stack.Screen
              name="onboarding/index"
              options={{ title: 'Accueil', headerShown: false }}
            />
            <Stack.Screen name="onboarding/create" options={{ title: 'Nouveau coffre' }} />
            <Stack.Screen name="onboarding/restore" options={{ title: 'Restauration' }} />
          </Stack.Protected>
          <Stack.Protected guard={!READER_ONLY && status === 'locked'}>
            <Stack.Screen name="lock" options={{ headerShown: false }} />
          </Stack.Protected>
          {/* Lecture d'une note partagée : ouverte à tous, quel que soit l'état du coffre. */}
          <Stack.Screen name="s/[id]" options={{ title: 'Note partagée' }} />
        </Stack>
      )}
    </ThemeProvider>
  );
}
