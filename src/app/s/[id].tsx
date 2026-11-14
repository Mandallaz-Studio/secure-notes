import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Logo } from '@/components/logo';
import { Notice } from '@/components/notice';
import { RichView } from '@/components/rich-view';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cryptoReady } from '@/crypto/aead';
import {
  isShareId,
  openShare,
  parseShareFragment,
  type ShareInstance,
  type SharedNote,
} from '@/share/codec';
import { defaultInstance, hostOf, isDefaultInstance, sameInstanceUrl } from '@/share/config';
import { loadSyncConfig } from '@/sync/config';
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
  /** Avant de contacter le serveur du lien : `external` s'il n'est pas celui de l'app. */
  | { phase: 'confirm'; host: string; external: boolean }
  | { phase: 'declined' }
  | { phase: 'error'; message: string }
  /** `externalHost` : serveur du lien, s'il n'est pas celui de l'app. */
  | { phase: 'ready'; note: SharedNote; externalHost: string | null };

type Target = {
  id: string;
  key: Uint8Array;
  instance: ShareInstance;
  host: string;
  external: boolean;
};

const INVALID = 'Ce lien est incomplet ou invalide. Vérifiez qu’il a été copié en entier.';

/**
 * Faut-il demander avant de contacter le serveur du lien ?
 *
 * N'importe qui peut fabriquer un lien vers le site de lecture qui désigne son
 * propre serveur : le contenu s'afficherait alors sous le nom de l'app, et ce
 * serveur apprendrait l'adresse IP du lecteur. Un serveur autre que celui de
 * l'app est donc toujours annoncé avant d'être contacté. Dans l'app, qui
 * n'émet aucune requête sans la synchronisation, on demande aussi pour le
 * serveur de l'app, sauf si c'est l'instance où l'utilisateur synchronise déjà.
 */
function needsConfirmation(target: Target): boolean {
  if (target.external) return true;
  if (Platform.OS === 'web') return false;
  const sync = loadSyncConfig();
  return !(sync.enabled && sameInstanceUrl(sync.url, target.instance.url));
}

function resolve(id: unknown, fragment: string): Target | null {
  const parsed = parseShareFragment(fragment);
  if (!isShareId(id) || !parsed) return null;
  const instance = parsed.instance ?? defaultInstance();
  if (!instance) {
    parsed.key.fill(0);
    return null;
  }
  return {
    id,
    key: parsed.key,
    instance,
    host: hostOf(instance.url),
    external: !isDefaultInstance(instance.url),
  };
}

async function load(target: Target): Promise<State> {
  let ciphertext: string | null;
  try {
    ciphertext = await fetchSharedNote(target.instance, target.id);
  } catch (cause) {
    target.key.fill(0);
    return {
      phase: 'error',
      message: cause instanceof SyncError ? cause.message : 'La note n’a pas pu être chargée.',
    };
  }
  if (ciphertext === null) {
    target.key.fill(0);
    return {
      phase: 'error',
      message: 'Ce lien n’existe plus : son auteur l’a révoqué, ou il n’a jamais existé.',
    };
  }
  try {
    const note = openShare(target.id, ciphertext, target.key);
    return { phase: 'ready', note, externalHost: target.external ? target.host : null };
  } catch {
    return { phase: 'error', message: INVALID };
  } finally {
    target.key.fill(0);
  }
}

export default function SharedNoteScreen() {
  const params = useLocalSearchParams<{ id: string; '#'?: string }>();
  const id = params.id;
  const fragment =
    params['#'] ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hash : '');
  const theme = useTheme();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const pending = useRef<Target | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      await cryptoReady();
      const target = resolve(id, fragment);
      if (!alive.current) {
        target?.key.fill(0);
        return;
      }
      if (!target) {
        setState({ phase: 'error', message: INVALID });
      } else if (needsConfirmation(target)) {
        pending.current = target;
        setState({ phase: 'confirm', host: target.host, external: target.external });
      } else {
        const next = await load(target);
        if (alive.current) setState(next);
      }
    })();
    return () => {
      alive.current = false;
      pending.current?.key.fill(0);
      pending.current = null;
    };
  }, [id, fragment]);

  const accept = async () => {
    const target = pending.current;
    pending.current = null;
    if (!target) return;
    setState({ phase: 'loading' });
    const next = await load(target);
    if (alive.current) setState(next);
  };

  const decline = () => {
    pending.current?.key.fill(0);
    pending.current = null;
    setState({ phase: 'declined' });
  };

  return (
    <Screen
      footer={
        state.phase === 'confirm' ? (
          <View style={styles.actions}>
            <Button
              label={state.external ? 'Ouvrir quand même' : 'Ouvrir'}
              variant="primary"
              onPress={accept}
            />
            <Button label="Annuler" onPress={decline} />
          </View>
        ) : undefined
      }>
      <Stack.Screen options={{ title: 'Note partagée' }} />
      {state.phase === 'loading' && (
        <ThemedText themeColor="inkMuted">Déchiffrement…</ThemedText>
      )}
      {state.phase === 'confirm' &&
        (state.external ? (
          <Notice tone="warning" title="Serveur inconnu">
            {`Cette note est hébergée sur ${state.host}, qui n’est pas le serveur de Secure Notes. Rien ne garantit qui l’a écrite : méfiez-vous de toute demande d’argent, de mot de passe ou de coordonnées. L’ouvrir révèle aussi votre adresse IP à ce serveur.`}
          </Notice>
        ) : (
          <Notice tone="info" title="Contacter le serveur ?">
            {`Pour afficher cette note, l’app doit la télécharger depuis ${state.host}. Ce serveur verra votre adresse IP, mais jamais le contenu de la note.`}
          </Notice>
        ))}
      {state.phase === 'declined' && (
        <Notice tone="info" title="Lien non ouvert">
          Aucun serveur n’a été contacté.
        </Notice>
      )}
      {state.phase === 'error' && (
        <Notice tone="danger" title="Note indisponible">
          {state.message}
        </Notice>
      )}
      {state.phase === 'ready' && (
        <>
          {state.externalHost !== null && (
            <Notice tone="warning" title={`Hébergée sur ${state.externalHost}`}>
              Ce serveur n’est pas celui de Secure Notes, et rien ne garantit qui a écrit cette
              note. Méfiez-vous de toute demande d’argent, de mot de passe ou de coordonnées.
            </Notice>
          )}
          {state.note.title !== '' && (
            <ThemedText type="title" accessibilityRole="header">
              {state.note.title}
            </ThemedText>
          )}
          <RichView doc={state.note.doc} />
          <View style={[styles.footer, { borderColor: theme.border }]}>
            {state.externalHost === null && <Logo size={24} />}
            <ThemedText type="caption" themeColor="inkSubtle" style={styles.flex}>
              {state.externalHost === null
                ? `Copie partagée le ${new Date(state.note.sharedAt).toLocaleDateString('fr-FR')} avec Secure Notes. Elle a été déchiffrée sur cet appareil : le serveur ne peut pas la lire.`
                : `Copie datée du ${new Date(state.note.sharedAt).toLocaleDateString('fr-FR')}, servie par ${state.externalHost}.`}
            </ThemedText>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: Spacing.two },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
