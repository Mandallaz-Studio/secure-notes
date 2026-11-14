import { useRouter } from 'expo-router';
import {
  CloudOff,
  Download,
  EyeOff,
  FlaskConical,
  Fingerprint,
  KeyRound,
  Link as LinkIcon,
  Lock,
  LockKeyhole,
  Monitor,
  Moon,
  PenLine,
  RefreshCw,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { ListGroup, ListItem, ListRow } from '@/components/list-group';
import { Notice } from '@/components/notice';
import { ProgressBar } from '@/components/progress-bar';
import { RetirementNotice } from '@/components/retirement-notice';
import { appPrivacySupported, getHideInRecents, setHideInRecents } from '@/security/app-privacy';
import { SegmentedControl, type SegmentedOption } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, NotePalette, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, newImageCache, toStoredImages } from '@/notes/blobs';
import { buildFullExport, fullExportFileName } from '@/notes/full-export';
import { markdownFilesSupported, pickTextFile, shareFile } from '@/notes/markdown-files';
import { createNote, withBody, withTitle } from '@/notes/model';
import { useNotes } from '@/notes/notes-context';
import { submitNote } from '@/notes/pending-notes';
import { contentOfDoc, type RichNode } from '@/notes/rich-text';
import { fileToNote, ImportError } from '@/notes/text-import';
import type { Note } from '@/notes/types';
import { isZip, zipToNotes } from '@/notes/zip-import';
import { useSync } from '@/sync/sync-context';
import { useThemePreference, type ThemePreference } from '@/theme/theme-preference';
import { useVault } from '@/vault/vault-context';

const THEME_OPTIONS: SegmentedOption<ThemePreference>[] = [
  { value: 'system', label: 'Auto', icon: Monitor },
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { preference, scheme, setPreference } = useThemePreference();
  const palette = NotePalette[scheme];

  return (
    <ScrollView
      style={{ backgroundColor: theme.canvas }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <ListGroup title="Apparence">
          <ListItem>
            <SegmentedControl options={THEME_OPTIONS} value={preference} onChange={setPreference} />
          </ListItem>
        </ListGroup>

        <VaultSection />

        <ListGroup
          title="Dossier privé"
          footer="Ses notes n’apparaissent ni dans la liste ni dans la recherche. Son ouverture demande l’empreinte, le visage ou le code de l’appareil.">
          <ListRow
            icon={LockKeyhole}
            label="Ouvrir le dossier privé"
            chevron
            onPress={() => router.push('/private')}
          />
        </ListGroup>

        <SyncSection />

        <StorageSection />

        <ListGroup
          title="Partage"
          footer="Les liens créés depuis une note restent actifs jusqu’à leur révocation, ou jusqu’à la mise à la corbeille de la note.">
          <ListRow
            icon={LinkIcon}
            label="Liens de partage"
            chevron
            onPress={() =>
              router.push({ pathname: '/share/[noteId]', params: { noteId: 'all' } })
            }
          />
        </ListGroup>

        {markdownFilesSupported && <ImportSection />}

        {markdownFilesSupported && <ExportSection />}

        <ListGroup
          title="Couleurs des notes"
          footer="Les mêmes jetons donnent des teintes différentes selon le thème.">
          <ListItem>
            <View style={styles.wrap}>
              {Object.entries(palette.text).map(([name, color]) => (
                <ThemedText key={name} type="label" style={{ color }}>
                  {name}
                </ThemedText>
              ))}
            </View>
            <View style={styles.wrap}>
              {Object.entries(palette.highlight).map(([name, color]) => (
                <ThemedText key={name} type="label" style={[styles.highlight, { backgroundColor: color }]}>
                  {name}
                </ThemedText>
              ))}
            </View>
          </ListItem>
        </ListGroup>

        {__DEV__ && (
          <ListGroup title="Essais techniques">
            <ListRow
              icon={FlaskConical}
              label="Chiffrement (libsodium)"
              chevron
              onPress={() => router.push('/dev/crypto')}
            />
            <ListRow
              icon={PenLine}
              label="Éditeur (TenTap)"
              chevron
              onPress={() => router.push('/dev/editor')}
            />
          </ListGroup>
        )}

        <DestroySection />
      </View>
    </ScrollView>
  );
}

function VaultSection() {
  const theme = useTheme();
  const router = useRouter();
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);
  const [hideInRecents, setHideState] = useState(getHideInRecents);

  const toggleBiometric = async () => {
    setError(null);
    try {
      await vault.setBiometricEnabled(!vault.biometricEnabled);
    } catch {
      setError("La protection n'a pas pu être modifiée (authentification annulée ?).");
    }
  };

  const toggleDeviceLock = async () => {
    setError(null);
    try {
      if (!(await vault.setDeviceLockEnabled(!vault.deviceLockEnabled))) {
        setError('Verrouillage inchangé : authentification annulée.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleHideInRecents = async () => {
    setError(null);
    try {
      await setHideInRecents(!hideInRecents);
      setHideState(!hideInRecents);
    } catch {
      setError('Le masquage n’a pas pu être modifié.');
    }
  };

  const switchProps = (label: string, value: boolean, onToggle: () => Promise<void>) => ({
    accessibilityLabel: label,
    value,
    onValueChange: () => void onToggle(),
    trackColor: { true: theme.accent, false: theme.surfaceSunken },
    thumbColor: value ? theme.onAccent : theme.surface,
    ios_backgroundColor: theme.surfaceSunken,
  });

  return (
    <>
      <ListGroup
        title="Coffre"
        footer={`Compte ${vault.accountId?.slice(0, 8)}… · La phrase de récupération n’est pas conservée et ne peut plus être affichée.`}>
        {vault.biometricAvailable ? (
          <ListRow
            icon={Fingerprint}
            label="Verrouillage biométrique"
            trailing={
              <Switch
                {...switchProps('Verrouillage biométrique', vault.biometricEnabled, toggleBiometric)}
              />
            }
          />
        ) : (
          <ListRow
            icon={Fingerprint}
            label="Verrouillage biométrique"
            detail="Indisponible : aucune empreinte ni visage enregistré sur cet appareil."
          />
        )}
        {!vault.biometricEnabled &&
          (vault.deviceLockAvailable || vault.deviceLockEnabled ? (
            <ListRow
              icon={LockKeyhole}
              label="Verrouillage par code"
              detail="Code, schéma, empreinte ou visage de l’appareil, au démarrage et après 30 s en arrière-plan."
              trailing={
                <Switch
                  {...switchProps('Verrouillage par code', vault.deviceLockEnabled, toggleDeviceLock)}
                />
              }
            />
          ) : (
            <ListRow
              icon={LockKeyhole}
              label="Verrouillage par code"
              detail="Indisponible : aucun verrouillage d’écran sur cet appareil."
            />
          ))}
        {vault.lockable && (
          <ListRow icon={Lock} label="Verrouiller maintenant" tone="accent" onPress={vault.lock} />
        )}
        {appPrivacySupported && (
          <ListRow
            icon={EyeOff}
            label="Masquer dans les apps récentes"
            detail="Aperçu masqué dans le sélecteur d’apps ; captures et enregistrements d’écran bloqués."
            trailing={
              <Switch
                {...switchProps('Masquer dans les apps récentes', hideInRecents, toggleHideInRecents)}
              />
            }
          />
        )}
        <ListRow
          icon={KeyRound}
          label="Recréer le coffre"
          detail="Phrase perdue, ou vue par quelqu’un d’autre ? Nouvelle phrase, mêmes notes."
          chevron
          onPress={() => router.push('/recreate')}
        />
      </ListGroup>
      {error && <Notice tone="danger">{error}</Notice>}
      <RetirementNotice />
    </>
  );
}

function DestroySection() {
  const vault = useVault();

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
    <ListGroup>
      <ListRow icon={Trash2} label="Supprimer le coffre de cet appareil" tone="danger" onPress={destroy} />
    </ListGroup>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, paddingBottom: Spacing.six, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.four },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  highlight: { paddingHorizontal: Spacing.two, borderRadius: Radius.sm, overflow: 'hidden' },
});

function ImportSection() {
  const router = useRouter();
  const { store } = useNotes();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    text: string;
    tone: 'success' | 'warning' | 'danger';
  } | null>(null);

  const importFile = async () => {
    if (!store) return;
    setReport(null);
    try {
      const picked = await pickTextFile();
      if (!picked) return;
      setBusy(true);
      const zip = isZip(picked.bytes) ? zipToNotes(picked.bytes) : null;
      const parsed = zip ? zip.notes : [fileToNote(picked.name, picked.bytes)];
      const now = Date.now();
      // Les images des fichiers deviennent des blobs, comme celles ajoutées dans l'éditeur.
      const cache = newImageCache();
      const toNote = async ({ title, doc }: { title: string; doc: RichNode }, index: number) => {
        const stored = await toStoredImages(doc, store, cache);
        // Une milliseconde d'écart : la liste garde l'ordre de l'archive.
        const at = now - index;
        return withBody(withTitle(createNote(at), title, at), contentOfDoc(stored), at);
      };
      const notes: Note[] = [];
      for (const [index, item] of parsed.entries()) notes.push(await toNote(item, index));
      // Si le coffre s'est verrouillé pendant le choix du fichier, les notes sont
      // enregistrées au prochain déverrouillage et cet écran n'existe plus.
      let saved = true;
      for (const note of notes) saved = (await submitNote(note)) && saved;
      if (!saved) return;
      if (!zip) {
        router.push({ pathname: '/note/[id]', params: { id: notes[0].id } });
        return;
      }
      const skipped = zip.skipped;
      setReport({
        text:
          `${notes.length} note(s) importée(s) depuis l’archive.` +
          (skipped.length > 0
            ? ` ${skipped.length} fichier(s) ignoré(s) : ${skipped
                .slice(0, 5)
                .map((file) => `${file.path} (${file.reason})`)
                .join(', ')}${skipped.length > 5 ? '…' : ''}.`
            : ''),
        tone: skipped.length > 0 ? 'warning' : 'success',
      });
    } catch (cause) {
      setReport({
        text:
          cause instanceof ImportError
            ? cause.message
            : `Le fichier n'a pas pu être importé : ${String(cause)}`,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ListGroup
        title="Import"
        footer="Markdown (.md), texte brut (.txt), RTF, ou tout autre format texte (CSV, JSON, code…), seul ou dans une archive zip. La mise en forme Markdown est conservée.">
        <ListRow
          icon={Upload}
          label={busy ? 'Import en cours…' : 'Importer un fichier'}
          detail="Crée une note par fichier texte, ou une par fichier texte de l’archive zip."
          tone="accent"
          disabled={!store || busy}
          onPress={importFile}
        />
      </ListGroup>
      {report && <Notice tone={report.tone}>{report.text}</Notice>}
    </>
  );
}

/** Export de tout le coffre, en clair, dans une archive zip. */
function ExportSection() {
  const { store } = useNotes();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ text: string; danger: boolean } | null>(null);

  const exportAll = async () => {
    if (!store) return;
    const confirmed = await confirmDestructive({
      title: 'Exporter toutes les notes en clair ?',
      message:
        "L'archive contient toutes vos notes, images et fichiers joints, non chiffrés : quiconque y accède peut les lire. Enregistrez-la en lieu sûr.",
      confirmLabel: 'Exporter',
    });
    if (!confirmed) return;
    setReport(null);
    setBusy(true);
    try {
      const now = Date.now();
      const result = await buildFullExport(store, now);
      await shareFile(fullExportFileName(now), result.zip, 'application/zip', 'public.zip-archive');
      setReport({
        text:
          `${result.notes} note(s) et ${result.files} fichier(s) exportés.` +
          (result.missing > 0
            ? ` ${result.missing} image(s) ou fichier(s) manquent : ils ne sont pas encore téléchargés sur cet appareil.`
            : ''),
        danger: result.missing > 0,
      });
    } catch (cause) {
      setReport({ text: `L'export a échoué : ${String(cause)}`, danger: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ListGroup
        title="Export"
        footer="Une archive zip avec toutes les notes (Markdown, rangées par catégorie), leurs images et fichiers joints, et un fichier JSON qui conserve toute la mise en forme.">
        <ListRow
          icon={Download}
          label={busy ? 'Préparation de l’archive…' : 'Exporter toutes les notes'}
          tone="accent"
          disabled={!store || busy}
          onPress={exportAll}
        />
      </ListGroup>
      {report && (
        <Notice tone={report.danger ? 'warning' : 'success'}>{report.text}</Notice>
      )}
    </>
  );
}

/** Place occupée par les images et les fichiers joints. */
function StorageSection() {
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
    <>
      <ListGroup title="Stockage">
        <ListRow
          label="Sur cet appareil"
          detail="Images et fichiers joints"
          value={localBytes === null ? '…' : formatBytes(localBytes)}
        />
        {usage && (
          <ListItem>
            <ProgressBar
              label="Sur le serveur"
              ratio={ratio}
              valueLabel={`${formatBytes(usage.usedBytes)} sur ${formatBytes(usage.quotaBytes)}`}
            />
          </ListItem>
        )}
        {config.enabled && !usage && status.lastSyncAt !== null && !status.blobError && (
          <ListRow label="Sur le serveur" value="Inconnu" detail="Instance pas à jour." />
        )}
      </ListGroup>
      {config.enabled && status.overQuota > 0 && (
        <Notice tone="warning" title="Quota atteint">
          {status.overQuota} image(s) ou fichier(s) restent sur cet appareil sans être
          synchronisés. Supprimez des fichiers joints ou faites augmenter le quota du compte.
        </Notice>
      )}
      {config.enabled && status.blobError && (
        <Notice tone="danger" title="Images et fichiers joints non synchronisés">
          {status.blobError}
        </Notice>
      )}
    </>
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
      <ListGroup
        title="Synchronisation"
        footer="Une fois activée, vos notes sont chiffrées ici avant d’être envoyées ; le serveur ne peut pas les lire.">
        <ListRow
          icon={CloudOff}
          label="Désactivée"
          detail="Aucune donnée ne quitte cet appareil."
        />
        <ListItem>
          <TextField
            label="Adresse de l'instance Supabase"
            placeholder="https://exemple.supabase.co"
            hint="Tous vos appareils doivent utiliser exactement la même adresse."
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextField
            label="Clé publique de l'instance"
            placeholder="Clé publique (anon)"
            value={anonKey}
            onChangeText={setAnonKey}
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
          />
          <Button
            label={busy ? 'Connexion…' : 'Activer la synchronisation'}
            variant="primary"
            disabled={busy || url.trim() === '' || anonKey.trim() === ''}
            onPress={activate}
          />
        </ListItem>
      </ListGroup>
    );
  }

  return (
    <>
      <ListGroup title="Synchronisation">
        <ListRow label="Instance" value={config.url.replace(/^https?:\/\//, '')} />
        <ListRow
          label="État"
          value={
            status.state === 'syncing'
              ? 'En cours…'
              : status.lastSyncAt
                ? `À ${new Date(status.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                : 'Pas encore synchronisé'
          }
        />
        <ListRow
          icon={RefreshCw}
          label="Synchroniser maintenant"
          tone="accent"
          disabled={status.state === 'syncing' || status.state === 'off'}
          onPress={syncNow}
        />
        <ListRow icon={CloudOff} label="Désactiver la synchronisation" onPress={deactivate} />
      </ListGroup>
      {status.conflicts > 0 && (
        <Notice tone="info" title={`${status.conflicts} conflit(s)`}>
          Note(s) modifiée(s) sur deux appareils : l&apos;autre version est conservée dans une
          « copie de conflit ».
        </Notice>
      )}
      {status.state === 'error' && (
        <Notice tone="danger" title="Synchronisation en échec">
          {status.error}
        </Notice>
      )}
    </>
  );
}
