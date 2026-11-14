import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useNotes } from '@/notes/notes-context';
import type { NoteStore } from '@/notes/types';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from '@/sync/config';
import {
  synchronizeBlobs,
  type BlobRemote,
  type BlobSyncResult,
  type StorageUsage,
} from '@/sync/blobs';
import { synchronize, type SyncRemote, type SyncResult } from '@/sync/engine';
import {
  credentialsFor,
  normalizeInstanceUrl,
  SupabaseRemote,
  SyncError,
} from '@/sync/supabase';
import { deriveVaultKeys } from '@/crypto/keys';
import { fromHex } from '@/crypto/vectors';
import { discardNoteStore } from '@/notes/store-manager';
import { deleteRetiring, loadRetiring } from '@/vault/key-store';
import { parseRetiring, retireVault, type RetireReport } from '@/vault/retire';
import { useVault } from '@/vault/vault-context';

export type SyncStatus = {
  /** `off` : désactivée, ou coffre verrouillé. */
  state: 'off' | 'idle' | 'syncing' | 'error';
  lastSyncAt: number | null;
  error: string | null;
  /** Copies de conflit créées depuis l'ouverture du coffre. */
  conflicts: number;
  /** Place occupée sur le serveur par les images et fichiers joints ; `null` : inconnue. */
  usage: StorageUsage | null;
  /** Images et fichiers que le serveur a refusés faute de place, à la dernière synchronisation. */
  overQuota: number;
  /** Les notes sont synchronisées, mais pas les images et fichiers joints. */
  blobError: string | null;
};

type SyncContextValue = {
  config: SyncConfig;
  status: SyncStatus;
  /**
   * Vérifie l'instance (connexion, création du compte au besoin) puis active la
   * synchronisation.
   * @throws SyncError avec un message affichable.
   */
  enable: (url: string, anonKey: string) => Promise<void>;
  disable: () => void;
  syncNow: () => void;
  /** Accès au serveur ; `null` si la synchronisation est désactivée ou le coffre verrouillé. */
  remote: SupabaseRemote | null;
  /** Retrait de l'ancien coffre après « Recréer le coffre ». */
  retirement: RetirementStatus;
  retryRetirement: () => void;
};

export type RetirementStatus =
  | { state: 'none' }
  /** Le nouveau compte n'a pas encore tout reçu : l'ancien reste en place. */
  | { state: 'waiting'; detail: string }
  | { state: 'running' }
  | { state: 'error'; error: string }
  | { state: 'done'; report: RetireReport };

/** Délai après une modification locale avant de l'envoyer. */
const WRITE_DELAY_MS = 2_000;
/** Intervalle de relève quand l'app est au premier plan. */
const POLL_INTERVAL_MS = 30_000;

const OFF: SyncStatus = {
  state: 'off',
  lastSyncAt: null,
  error: null,
  conflicts: 0,
  usage: null,
  overQuota: 0,
  blobError: null,
};

type RunOutcome = {
  result: SyncResult | null;
  error: string | null;
  blobs: BlobSyncResult | null;
  blobError: string | null;
};

const describe = (cause: unknown) =>
  cause instanceof SyncError ? cause.message : `Synchronisation interrompue : ${String(cause)}`;

/** Enchaîne les synchronisations : jamais deux à la fois, les demandes se cumulent. */
class SyncRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private stopped = false;

  constructor(
    private readonly store: NoteStore,
    private readonly remote: SyncRemote & BlobRemote,
    private readonly wrapKey: Uint8Array,
    private readonly onStart: () => void,
    private readonly onDone: (outcome: RunOutcome) => void,
  ) {}

  request(delayMs = 0): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async run(): Promise<void> {
    this.timer = null;
    this.running = true;
    this.onStart();
    const outcome: RunOutcome = { result: null, error: null, blobs: null, blobError: null };
    try {
      outcome.result = await synchronize(this.store, this.remote, this.wrapKey);
    } catch (cause) {
      outcome.error = describe(cause);
    }
    // Les images et fichiers suivent les notes ; leur échec ne remet pas en cause les notes.
    if (outcome.result && !this.stopped) {
      try {
        outcome.blobs = await synchronizeBlobs(this.store, this.remote, this.wrapKey);
      } catch (cause) {
        outcome.blobError = describe(cause);
      }
    }
    this.running = false;
    // Arrêté en cours de route (verrouillage) : la base est fermée, rien à signaler.
    if (this.stopped) return;
    this.onDone(outcome);
    if (this.again) {
      this.again = false;
      this.request(WRITE_DELAY_MS);
    }
  }
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { keys } = useVault();
  const { store, revision, invalidate } = useNotes();
  const [config, setConfig] = useState(loadSyncConfig);
  const [status, setStatus] = useState<SyncStatus>(OFF);
  const runner = useRef<SyncRunner | null>(null);

  const { enabled, url, anonKey } = config;

  const remote = useMemo(
    () => (enabled && keys ? new SupabaseRemote({ url, anonKey }, credentialsFor(keys, url)) : null),
    [enabled, url, anonKey, keys],
  );

  useEffect(() => {
    if (!remote || !keys || !store) return;
    const current = new SyncRunner(
      store,
      remote,
      keys.wrapKey,
      () => setStatus((previous) => ({ ...previous, state: 'syncing' })),
      ({ result, error, blobs, blobError }) => {
        setStatus((previous) =>
          result
            ? {
                state: 'idle',
                lastSyncAt: Date.now(),
                error: null,
                conflicts: previous.conflicts + result.conflicts,
                usage: blobs?.usage ?? previous.usage,
                overQuota: blobs ? blobs.overQuota : previous.overQuota,
                blobError,
              }
            : { ...previous, state: 'error', error },
        );
        // Des éléments ont changé localement : les listes doivent se recharger.
        if (
          result &&
          (result.pulled > 0 || result.conflicts > 0 || (blobs?.downloaded ?? 0) > 0)
        ) {
          invalidate();
        }
      },
    );
    runner.current = current;
    current.request();

    const poll = setInterval(() => {
      if (AppState.currentState === 'active') current.request();
    }, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') current.request();
    });
    return () => {
      current.stop();
      runner.current = null;
      clearInterval(poll);
      subscription.remove();
      setStatus(OFF);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `invalidate` change à chaque rendu
  }, [remote, keys, store]);

  // Chaque écriture locale déclenche un envoi, après un court délai.
  useEffect(() => {
    if (revision > 0) runner.current?.request(WRITE_DELAY_MS);
  }, [revision]);

  // --- Retrait de l'ancien coffre ------------------------------------------
  const [retirement, setRetirement] = useState<RetirementStatus>({ state: 'none' });
  const [retryToken, setRetryToken] = useState(0);
  const retiring = useRef(false);

  useEffect(() => {
    if (!keys || !store || retiring.current) return;
    let cancelled = false;
    (async () => {
      const raw = await loadRetiring().catch(() => null);
      if (cancelled) return;
      if (!raw) return;
      const record = parseRetiring(raw);
      if (!record) {
        await deleteRetiring();
        return;
      }
      if (keys.accountId === record.accountId) {
        // Recréation interrompue avant que le nouveau coffre devienne actif.
        await discardNoteStore(record.successorId);
        await deleteRetiring();
        return;
      }
      if (keys.accountId !== record.successorId) return;

      // Avant de fermer l'ancien compte, le nouveau doit avoir tout reçu.
      if (remote) {
        if (status.state !== 'idle') {
          setRetirement({ state: 'waiting', detail: 'Envoi des notes au nouveau compte…' });
          return;
        }
        const pending = (await store.listPending()).length;
        const blobs = (await store.listBlobs()).filter(
          (blob) => blob.referenced && blob.hasData && !blob.uploaded,
        ).length;
        if (cancelled) return;
        if (pending > 0 || blobs > 0) {
          setRetirement({
            state: 'waiting',
            detail:
              status.overQuota > 0
                ? `${status.overQuota} image(s) ou fichier(s) dépassent le quota du nouveau compte : faites-le augmenter sur l'instance.`
                : `Envoi au nouveau compte en cours (${pending} note(s), ${blobs} fichier(s) restants).`,
          });
          return;
        }
      }

      retiring.current = true;
      setRetirement({ state: 'running' });
      const oldMaster = fromHex(record.masterKey);
      const oldKeys = deriveVaultKeys(oldMaster);
      try {
        const sameInstance = remote !== null && record.instance?.url === url;
        const report = await retireVault({
          deleteOldDatabase: () => discardNoteStore(record.accountId),
          oldRemote: record.instance
            ? new SupabaseRemote(
                record.instance,
                credentialsFor(oldKeys, record.instance.url),
                fetch,
                true,
              )
            : null,
          oldWrapKey: oldKeys.wrapKey,
          newRemote: sameInstance ? remote : null,
          newWrapKey: keys.wrapKey,
          store,
        });
        await deleteRetiring();
        setRetirement({ state: 'done', report });
      } catch (cause) {
        setRetirement({ state: 'error', error: describe(cause) });
      } finally {
        oldMaster.fill(0);
        oldKeys.wrapKey.fill(0);
        oldKeys.databaseKey.fill(0);
        retiring.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // `status` complet changerait à chaque début de synchronisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, store, remote, url, status.lastSyncAt, status.state, retryToken]);

  const enable = async (inputUrl: string, inputKey: string) => {
    if (!keys) throw new SyncError('Le coffre doit être déverrouillé.');
    const instance = {
      url: normalizeInstanceUrl(inputUrl, __DEV__),
      anonKey: inputKey.trim(),
    };
    if (instance.anonKey === '') throw new SyncError("La clé de l'instance est requise.");
    // Rien n'est enregistré tant que l'instance n'a pas accepté la connexion.
    await new SupabaseRemote(instance, credentialsFor(keys, instance.url)).signIn();
    const next = { ...instance, enabled: true };
    saveSyncConfig(next);
    setConfig(next);
  };

  const disable = () => {
    const next = { ...config, enabled: false };
    saveSyncConfig(next);
    setConfig(next);
  };

  return (
    <SyncContext
      value={{
        config,
        status,
        enable,
        disable,
        syncNow: () => runner.current?.request(),
        remote,
        retirement,
        retryRetirement: () => setRetryToken((token) => token + 1),
      }}>
      {children}
    </SyncContext>
  );
}

export function useSync(): SyncContextValue {
  const value = use(SyncContext);
  if (!value) {
    throw new Error('useSync doit être utilisé sous SyncProvider');
  }
  return value;
}
