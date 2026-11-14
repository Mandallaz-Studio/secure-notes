import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fromBase64, generateKey, toBase64 } from '@/crypto/aead';
import { newId } from '@/notes/model';
import { useNotes } from '@/notes/notes-context';
import {
  buildSharedNote,
  buildShareLink,
  openShareMeta,
  sealShare,
  sealShareMeta,
  ShareError,
} from '@/share/codec';
import { instanceForLink, SHARE_LINK_BASE, SHARE_SITE } from '@/share/config';
import { QuotaExceededError } from '@/sync/blobs';
import { useSync } from '@/sync/sync-context';
import { SyncError } from '@/sync/supabase';
import { useVault } from '@/vault/vault-context';

/**
 * Liens de partage d'une note (`/share/<id de la note>`), ou de toutes les
 * notes (`/share/all`, depuis les réglages) : création, copie, révocation.
 */

type ShareRow = { id: string; link: string; title: string; noteId: string; createdAt: number };

/** Longueur du titre gardé avec le lien, pour le reconnaître dans la liste. */
const TITLE_LENGTH = 80;

const describe = (cause: unknown) =>
  cause instanceof ShareError || cause instanceof SyncError
    ? cause.message
    : cause instanceof QuotaExceededError
      ? 'Quota de stockage atteint : libérez de la place ou révoquez d’anciens liens.'
      : `Opération impossible : ${String(cause)}`;

export default function ShareScreen() {
  const { noteId } = useLocalSearchParams<{ noteId: string }>();
  const all = noteId === 'all';
  const theme = useTheme();
  const { keys } = useVault();
  const { store } = useNotes();
  const { remote, config } = useSync();
  const [rows, setRows] = useState<ShareRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const wrapKey = keys?.wrapKey;
  const instance = instanceForLink(config);

  const linkOf = (id: string, key: Uint8Array) => buildShareLink(SHARE_LINK_BASE, id, key, instance);

  useEffect(() => {
    if (!remote || !wrapKey) return;
    let cancelled = false;
    remote.listShares().then(
      (shares) => {
        if (cancelled) return;
        const found: ShareRow[] = [];
        for (const share of shares) {
          // Une ligne illisible avec la clé du compte n'est pas un partage de ce coffre.
          const meta = openShareMeta(share.id, share.meta, wrapKey);
          if (!meta || (!all && meta.noteId !== noteId)) continue;
          found.push({
            id: share.id,
            link: buildShareLink(SHARE_LINK_BASE, share.id, fromBase64(meta.key), instance),
            title: meta.title,
            noteId: meta.noteId,
            createdAt: share.createdAt,
          });
        }
        setRows(found);
      },
      (cause) => {
        if (!cancelled) setError(describe(cause));
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `instance` est recalculé à chaque rendu
  }, [remote, wrapKey, noteId, all]);

  if (!remote || !wrapKey || !store) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Partage par lien' }} />
        <ThemedText themeColor="textSecondary">
          Le partage par lien dépose une copie chiffrée de la note sur le serveur : activez
          d’abord la synchronisation dans les réglages.
        </ThemedText>
      </Screen>
    );
  }

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const note = await store.getNote(noteId);
      if (!note) throw new ShareError('Cette note n’existe plus.');
      const id = newId();
      const key = generateKey();
      const now = Date.now();
      const ciphertext = sealShare(id, await buildSharedNote(note, store, now), key);
      const title = note.title.slice(0, TITLE_LENGTH);
      const meta = sealShareMeta(id, { noteId: note.id, key: toBase64(key), title }, wrapKey);
      await remote.createShare(id, ciphertext, meta);
      const row = { id, link: linkOf(id, key), title, noteId: note.id, createdAt: now };
      setRows((previous) => [row, ...(previous ?? [])]);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: ShareRow) => {
    const confirmed = await confirmDestructive({
      title: 'Révoquer ce lien ?',
      message: 'Il cessera de fonctionner pour tout le monde, immédiatement.',
      confirmLabel: 'Révoquer',
    });
    if (!confirmed) return;
    setError(null);
    try {
      await remote.deleteShare(row.id);
      setRows((previous) => (previous ?? []).filter((other) => other.id !== row.id));
    } catch (cause) {
      setError(describe(cause));
    }
  };

  const copy = async (row: ShareRow) => {
    await Clipboard.setStringAsync(row.link);
    setCopied(row.id);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: all ? 'Liens de partage' : 'Partage par lien' }} />
      <ThemedText themeColor="textSecondary">
        Un lien donne accès à une copie de la note telle qu’elle est au moment du partage, sans
        ses fichiers joints. Toute personne qui a le lien peut la lire ; la clé de déchiffrement
        est dans le lien lui-même et n’est jamais envoyée au serveur.
      </ThemedText>
      {SHARE_SITE === '' && (
        <ThemedText type="small" themeColor="textSecondary">
          Aucun site de lecture n’est configuré : les liens ne s’ouvrent que sur un appareil où
          Secure Notes est installée.
        </ThemedText>
      )}
      {!all && (
        <Button
          label={busy ? 'Création…' : 'Créer un lien'}
          variant="primary"
          disabled={busy}
          onPress={() => void create()}
        />
      )}
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      {rows === null && !error && <ThemedText themeColor="textSecondary">Chargement…</ThemedText>}
      {rows?.length === 0 && (
        <ThemedText themeColor="textSecondary">
          {all ? 'Aucun lien actif.' : 'Aucun lien actif pour cette note.'}
        </ThemedText>
      )}
      {rows?.map((row) => (
        <View key={row.id} style={[styles.row, { borderColor: theme.border }]}>
          {all && (
            <ThemedText type="subtitle" numberOfLines={1}>
              {row.title === '' ? 'Sans titre' : row.title}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            Créé le {new Date(row.createdAt).toLocaleString('fr-FR')}
          </ThemedText>
          <ThemedText type="code" numberOfLines={2} selectable>
            {row.link}
          </ThemedText>
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button
                label={copied === row.id ? 'Copié' : 'Copier'}
                onPress={() => void copy(row)}
              />
            </View>
            <View style={styles.flex}>
              <Button label="Envoyer" onPress={() => void Share.share({ message: row.link })} />
            </View>
            <View style={styles.flex}>
              <Button label="Révoquer" variant="danger" onPress={() => void revoke(row)} />
            </View>
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
