import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { RichView } from '@/components/rich-view';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { cryptoReady } from '@/crypto/aead';
import { isShareId, openShare, parseShareFragment, type SharedNote } from '@/share/codec';
import { defaultInstance } from '@/share/config';
import { fetchSharedNote, SyncError } from '@/sync/supabase';

/**
 * Lecture d'une note partagée : `/s/<id>#<clé>`. Seule route de l'app servie
 * sur le web ; dans l'app, elle s'ouvre même coffre verrouillé ou absent.
 *
 * La clé reste dans le fragment de l'adresse : elle n'est envoyée nulle part,
 * la copie chiffrée est déchiffrée ici.
 */

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; note: SharedNote };

const INVALID = 'Ce lien est incomplet ou invalide. Vérifiez qu’il a été copié en entier.';

async function load(id: unknown, fragment: string): Promise<State> {
  await cryptoReady();
  const parsed = parseShareFragment(fragment);
  if (!isShareId(id) || !parsed) return { phase: 'error', message: INVALID };
  const instance = parsed.instance ?? defaultInstance();
  if (!instance) return { phase: 'error', message: INVALID };
  let ciphertext: string | null;
  try {
    ciphertext = await fetchSharedNote(instance, id);
  } catch (cause) {
    return {
      phase: 'error',
      message: cause instanceof SyncError ? cause.message : 'La note n’a pas pu être chargée.',
    };
  }
  if (ciphertext === null) {
    return {
      phase: 'error',
      message: 'Ce lien n’existe plus : son auteur l’a révoqué, ou il n’a jamais existé.',
    };
  }
  try {
    return { phase: 'ready', note: openShare(id, ciphertext, parsed.key) };
  } catch {
    return { phase: 'error', message: INVALID };
  } finally {
    parsed.key.fill(0);
  }
}

export default function SharedNoteScreen() {
  const params = useLocalSearchParams<{ id: string; '#'?: string }>();
  const id = params.id;
  const fragment =
    params['#'] ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hash : '');
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void load(id, fragment).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [id, fragment]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Note partagée' }} />
      {state.phase === 'loading' && (
        <ThemedText themeColor="textSecondary">Déchiffrement…</ThemedText>
      )}
      {state.phase === 'error' && <ThemedText themeColor="danger">{state.message}</ThemedText>}
      {state.phase === 'ready' && (
        <>
          {state.note.title !== '' && (
            <ThemedText type="title" accessibilityRole="header">
              {state.note.title}
            </ThemedText>
          )}
          <RichView doc={state.note.doc} />
          <ThemedText type="small" themeColor="textSecondary">
            Copie partagée le {new Date(state.note.sharedAt).toLocaleDateString('fr-FR')} avec
            Secure Notes. Elle a été déchiffrée sur cet appareil : le serveur ne peut pas la lire.
          </ThemedText>
        </>
      )}
    </Screen>
  );
}
