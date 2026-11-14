import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
} from '@expo-google-fonts/ibm-plex-mono';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_400Regular_Italic,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_600SemiBold_Italic,
} from '@expo-google-fonts/ibm-plex-sans';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { Colors, FontFiles, Type } from '@/constants/theme';
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
  // En cas d'échec de chargement, l'app s'affiche avec les polices du système.
  const [fontsLoaded, fontError] = useFonts({
    [FontFiles.sans400]: IBMPlexSans_400Regular,
    [FontFiles.sans400Italic]: IBMPlexSans_400Regular_Italic,
    [FontFiles.sans500]: IBMPlexSans_500Medium,
    [FontFiles.sans600]: IBMPlexSans_600SemiBold,
    [FontFiles.sans600Italic]: IBMPlexSans_600SemiBold_Italic,
    [FontFiles.mono400]: IBMPlexMono_400Regular,
    [FontFiles.mono500]: IBMPlexMono_500Medium,
  });
  const colors = Colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          primary: colors.accent,
          background: colors.canvas,
          card: colors.canvas,
          text: colors.ink,
          border: colors.border,
          notification: colors.danger,
        },
      }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {/* Tant que l'état du coffre est inconnu, rien n'est affiché. */}
      {status !== 'loading' && (fontsLoaded || fontError) && (
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            headerTintColor: colors.accent,
            headerStyle: { backgroundColor: colors.canvas },
            headerTitleStyle: { ...Type.headline, color: colors.ink },
            headerLargeTitleStyle: { ...Type.display, color: colors.ink },
            contentStyle: { backgroundColor: colors.canvas },
          }}>
          {/* Les écrans de l'app n'existent que coffre déverrouillé. */}
          <Stack.Protected guard={!READER_ONLY && status === 'unlocked'}>
            <Stack.Screen name="index" options={{ title: 'Notes', headerShown: false }} />
            <Stack.Screen name="note/[id]" options={{ title: '' }} />
            <Stack.Screen name="categories" options={{ title: 'Catégories' }} />
            <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
            <Stack.Screen name="recreate" options={{ title: 'Recréer le coffre' }} />
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
