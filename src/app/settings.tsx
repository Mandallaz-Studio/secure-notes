import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { NotePalette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, newImageCache, toStoredImages } from '@/notes/blobs';
import { markdownFilesSupported, pickTextFile } from '@/notes/markdown-files';
import { createNote, withBody, withTitle } from '@/notes/model';
import { useNotes } from '@/notes/notes-context';
import { submitNote } from '@/notes/pending-notes';
import { contentOfDoc } from '@/notes/rich-text';
import { fileToNote, ImportError } from '@/notes/text-import';
import { useSync } from '@/sync/sync-context';
import { useThemePreference, type ThemePreference } from '@/theme/theme-preference';
import { useVault } from '@/vault/vault-context';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { preference, scheme, setPreference } = useThemePreference();
  const palette = NotePalette[scheme];

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic">
      <View style={styles.section}>
        <ThemedText type="subtitle">Thème</ThemedText>
        <View style={styles.row}>
          {THEME_OPTIONS.map((option) => (
            <View key={option.value} style={styles.flex}>
              <Button
                label={option.label}
                selected={preference === option.value}
                onPress={() => setPreference(option.value)}
              />
            </View>
          ))}
        </View>
      </View>

      {markdownFilesSupported && <ImportSection />}

      <SyncSection />

      <StorageSection />

      <VaultSection />

      <View style={styles.section}>
        <ThemedText type="subtitle">Couleurs des notes</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          Les mêmes jetons donnent des teintes différentes selon le thème.
        </ThemedText>
        <View style={styles.wrap}>
          {Object.entries(palette.text).map(([name, color]) => (
            <ThemedText key={name} style={{ color, fontWeight: 600 }}>
              {name}
            </ThemedText>
          ))}
        </View>
        <View style={styles.wrap}>
          {Object.entries(palette.highlight).map(([name, color]) => (
            <ThemedText key={name} style={[styles.highlight, { backgroundColor: color }]}>
              {name}
            </ThemedText>
          ))}
        </View>
      </View>

      {__DEV__ && (
        <View style={styles.section}>
          <ThemedText type="subtitle">Essais techniques</ThemedText>
          <Link href="/dev/crypto" asChild>
            <Button label="Chiffrement (libsodium)" />
          </Link>
          <Link href="/dev/editor" asChild>
            <Button label="Éditeur (TenTap)" />
          </Link>
        </View>
      )}
    </ScrollView>
  );
}

function VaultSection() {
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);

  const toggleBiometric = async () => {
    setError(null);
    try {
      await vault.setBiometricEnabled(!vault.biometricEnabled);
    } catch {
      setError("La protection n'a pas pu être modifiée (authentification annulée ?).");
    }
  };

  const destroy = async () => {
    const confirmed = await confirmDestructive({
      title: 'Supprimer le coffre de cet appareil ?',
      message:
        'Vous devrez saisir vos 24 mots pour retrouver vos notes. Sans eux, elles seront définitivement perdues.',
      confirmLabel: 'Supprimer',
    });
    if (confirmed) {
      await vault.destroy();
    }
  };

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Coffre</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        Identifiant du compte : {vault.accountId?.slice(0, 8)}…
      </ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        La phrase de récupération n&apos;est pas conservée et ne peut plus être affichée.
      </ThemedText>
      {vault.biometricAvailable ? (
        <>
          <Button
            label={
              vault.biometricEnabled
                ? 'Désactiver le verrouillage biométrique'
                : 'Activer le verrouillage biométrique'
            }
            onPress={toggleBiometric}
          />
          {vault.biometricEnabled && <Button label="Verrouiller maintenant" onPress={vault.lock} />}
        </>
      ) : (
        <ThemedText themeColor="textSecondary" type="small">
          Verrouillage biométrique indisponible : aucune empreinte ni visage enregistré sur cet
          appareil.
        </ThemedText>
      )}
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
      <Button label="Supprimer le coffre de cet appareil" variant="danger" onPress={destroy} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.five },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  flex: { flex: 1 },
  highlight: { paddingHorizontal: Spacing.two, borderRadius: 4 },
  gauge: { height: 8, borderRadius: 4, overflow: 'hidden' },
  gaugeFill: { height: 8, borderRadius: 4 },
});

function ImportSection() {
  const router = useRouter();
  const { store } = useNotes();
  const [error, setError] = useState<string | null>(null);

  const importFile = async () => {
    if (!store) return;
    setError(null);
    try {
      const picked = await pickTextFile();
      if (!picked) return;
      const { title, doc } = fileToNote(picked.name, picked.bytes);
      const now = Date.now();
      // Les images du fichier deviennent des blobs, comme celles ajoutées dans l'éditeur.
      const stored = await toStoredImages(doc, store, newImageCache());
      const note = withBody(withTitle(createNote(now), title, now), contentOfDoc(stored), now);
      // Si le coffre s'est verrouillé pendant le choix du fichier, la note est
      // enregistrée au prochain déverrouillage et cet écran n'existe plus.
      if (await submitNote(note)) {
        router.push({ pathname: '/note/[id]', params: { id: note.id } });
      }
    } catch (cause) {
      setError(
        cause instanceof ImportError
          ? cause.message
          : `Le fichier n'a pas pu être importé : ${String(cause)}`,
      );
    }
  };

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Import</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        Crée une note à partir d&apos;un fichier texte : Markdown (.md), texte brut (.txt), RTF, ou
        tout autre format texte (CSV, JSON, code…). La mise en forme Markdown est conservée.
      </ThemedText>
      <Button label="Importer un fichier" disabled={!store} onPress={importFile} />
      {error && (
        <ThemedText themeColor="danger" type="small">
          {error}
        </ThemedText>
      )}
    </View>
  );
}

/** Place occupée par les images et les fichiers joints. */
function StorageSection() {
  const theme = useTheme();
  const { store, revision } = useNotes();
  const { config, status } = useSync();
  const [localBytes, setLocalBytes] = useState<number | null>(null);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.listBlobs().then(
      (blobs) => {
        if (!cancelled) setLocalBytes(blobs.reduce((sum, blob) => sum + blob.size, 0));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [store, revision, status.lastSyncAt]);

  const usage = config.enabled ? status.usage : null;
  const ratio = usage && usage.quotaBytes > 0 ? Math.min(1, usage.usedBytes / usage.quotaBytes) : 0;

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Stockage</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        Images et fichiers joints sur cet appareil :{' '}
        {localBytes === null ? '…' : formatBytes(localBytes)}
      </ThemedText>
      {usage && (
        <>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
            style={[styles.gauge, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.gaugeFill,
                { width: `${ratio * 100}%`, backgroundColor: ratio > 0.9 ? theme.danger : theme.tint },
              ]}
            />
          </View>
          <ThemedText themeColor="textSecondary" type="small">
            Sur le serveur : {formatBytes(usage.usedBytes)} utilisés sur{' '}
            {formatBytes(usage.quotaBytes)}
          </ThemedText>
        </>
      )}
      {config.enabled && !usage && status.lastSyncAt !== null && !status.blobError && (
        <ThemedText themeColor="textSecondary" type="small">
          Espace utilisé sur le serveur : inconnu (instance pas à jour).
        </ThemedText>
      )}
      {config.enabled && status.overQuota > 0 && (
        <ThemedText themeColor="danger" type="small">
          Quota atteint : {status.overQuota} image(s) ou fichier(s) restent sur cet appareil sans
          être synchronisés. Supprimez des fichiers joints ou faites augmenter le quota du compte.
        </ThemedText>
      )}
      {config.enabled && status.blobError && (
        <ThemedText themeColor="danger" type="small">
          Images et fichiers joints non synchronisés : {status.blobError}
        </ThemedText>
      )}
    </View>
  );
}

function SyncSection() {
  const { config, status, enable, disable, syncNow } = useSync();
  const [url, setUrl] = useState(config.url);
  const [anonKey, setAnonKey] = useState(config.anonKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = async () => {
    setError(null);
    setBusy(true);
    try {
      await enable(url, anonKey);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    const confirmed = await confirmDestructive({
      title: 'Désactiver la synchronisation ?',
      message:
        'Vos notes restent sur cet appareil et sur le serveur, mais ne seront plus échangées.',
      confirmLabel: 'Désactiver',
    });
    if (confirmed) disable();
  };

  if (!config.enabled) {
    return (
      <View style={styles.section}>
        <ThemedText type="subtitle">Synchronisation</ThemedText>
        <ThemedText themeColor="textSecondary" type="small">
          Désactivée : aucune donnée ne quitte cet appareil. Une fois activée, vos notes sont
          chiffrées ici avant d&apos;être envoyées ; le serveur ne peut pas les lire.
        </ThemedText>
        <TextField
          accessibilityLabel="Adresse de l'instance Supabase"
          placeholder="https://exemple.supabase.co"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TextField
          accessibilityLabel="Clé publique de l'instance"
          placeholder="Clé publique (anon) de l'instance"
          value={anonKey}
          onChangeText={setAnonKey}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          label={busy ? 'Connexion…' : 'Activer la synchronisation'}
          disabled={busy || url.trim() === '' || anonKey.trim() === ''}
          onPress={activate}
        />
        {error && (
          <ThemedText themeColor="danger" type="small">
            {error}
          </ThemedText>
        )}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">Synchronisation</ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        Instance : {config.url}
      </ThemedText>
      <ThemedText themeColor="textSecondary" type="small">
        {status.state === 'syncing'
          ? 'Synchronisation en cours…'
          : status.lastSyncAt
            ? `Dernière synchronisation à ${new Date(status.lastSyncAt).toLocaleTimeString()}`
            : 'Pas encore synchronisé'}
      </ThemedText>
      {status.conflicts > 0 && (
        <ThemedText themeColor="textSecondary" type="small">
          {status.conflicts} note(s) modifiée(s) sur deux appareils : l&apos;autre version est
          conservée dans une « copie de conflit ».
        </ThemedText>
      )}
      {status.state === 'error' && (
        <ThemedText themeColor="danger" type="small">
          {status.error}
        </ThemedText>
      )}
      <Button
        label="Synchroniser maintenant"
        disabled={status.state === 'syncing' || status.state === 'off'}
        onPress={syncNow}
      />
      <Button label="Désactiver la synchronisation" onPress={deactivate} />
    </View>
  );
}
