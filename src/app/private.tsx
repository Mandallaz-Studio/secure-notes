import * as LocalAuthentication from 'expo-local-authentication';
import { Stack, useFocusEffect } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { NotesBrowser } from '@/components/notes-browser';
import { Notice } from '@/components/notice';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

/**
 * Dossier privé : notes absentes de la liste et de la recherche ordinaires.
 *
 * Son ouverture demande le déverrouillage de l'appareil (empreinte, visage ou
 * code). Il se referme dès que l'app passe en arrière-plan. Ses notes sont
 * chiffrées comme les autres : le dossier les masque, il ne les chiffre pas
 * à part.
 */

type Access =
  | 'checking'
  | 'open'
  /** L'appareil n'a aucun verrouillage : le dossier est seulement masqué. */
  | 'unprotected'
  | 'locked';

/** Erreurs qui signifient que l'appareil n'a pas de verrouillage utilisable. */
const NO_LOCK: LocalAuthentication.LocalAuthenticationError[] = [
  'not_enrolled',
  'not_available',
  'passcode_not_set',
];

export default function PrivateFolderScreen() {
  const [access, setAccessState] = useState<Access>('checking');
  /** Copie de `access`, lisible depuis les écouteurs. */
  const current = useRef<Access>('checking');
  const setAccess = (next: Access) => {
    current.current = next;
    setAccessState(next);
  };
  const [failure, setFailure] = useState<string | null>(null);
  const authenticating = useRef(false);
  const focused = useRef(false);

  const unlock = useCallback(async () => {
    if (authenticating.current) return;
    authenticating.current = true;
    setFailure(null);
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        setAccess('unprotected');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Ouvrir le dossier privé',
        cancelLabel: 'Annuler',
      });
      if (result.success) {
        setAccess('open');
      } else if (NO_LOCK.includes(result.error)) {
        setAccess('unprotected');
      } else {
        setAccess('locked');
        if (result.error === 'lockout') {
          setFailure('Trop de tentatives : réessayez dans un moment.');
        } else if (result.error !== 'user_cancel' && result.error !== 'system_cancel') {
          setFailure('Le déverrouillage a échoué.');
        }
      }
    } catch (cause) {
      setAccess('locked');
      setFailure(`Le déverrouillage est indisponible : ${String(cause)}`);
    } finally {
      authenticating.current = false;
    }
  }, []);

  // Demande le déverrouillage à l'arrivée sur l'écran, et au retour sur
  // l'écran s'il s'est refermé entre-temps.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (current.current === 'checking' || current.current === 'locked') void unlock();
      return () => {
        focused.current = false;
      };
    }, [unlock]),
  );

  // Refermé dès que l'app quitte le premier plan ; rouvert à son retour si
  // l'écran est visible.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (authenticating.current) return;
      if (state === 'background') {
        if (current.current === 'open') setAccess('locked');
      } else if (state === 'active' && focused.current && current.current === 'locked') {
        void unlock();
      }
    });
    return () => subscription.remove();
  }, [unlock]);

  if (access === 'open' || access === 'unprotected') {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Dossier privé' }} />
        <NotesBrowser
          hidden
          header={
            access === 'unprotected' ? (
              <View style={styles.notice}>
                <Notice tone="warning" title="Dossier seulement masqué">
                  Cet appareil n’a ni code, ni empreinte, ni visage enregistré : le dossier
                  privé s’ouvre sans vérification. Ajoutez un verrouillage d’écran dans les
                  réglages d’Android pour le protéger.
                </Notice>
              </View>
            ) : undefined
          }
        />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Dossier privé' }} />
      <View style={styles.locked}>
        <EmptyState
          icon={Lock}
          title="Dossier privé verrouillé"
          message="Déverrouillez avec l’empreinte, le visage ou le code de l’appareil."
        />
        {failure && <Notice tone="danger">{failure}</Notice>}
        {access === 'locked' && (
          <Button label="Déverrouiller" icon={Lock} variant="primary" onPress={() => void unlock()} />
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  notice: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  locked: {
    width: '100%',
    maxWidth: MaxContentWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
});
