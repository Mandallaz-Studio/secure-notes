import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useNotes } from '@/notes/notes-context';
import type { NoteStore } from '@/notes/types';
import { loadSyncConfig, saveSyncConfig, type SyncConfig } from '@/sync/config';
import { synchronize, type SyncRemote, type SyncResult } from '@/sync/engine';
import {
  credentialsFor,
  normalizeInstanceUrl,
  SupabaseRemote,
  SyncError,
} from '@/sync/supabase';
import { useVault } from '@/vault/vault-context';

export type SyncStatus = {
  /** `off` : désactivée, ou coffre verrouillé. */
  state: 'off' | 'idle' | 'syncing' | 'error';
  lastSyncAt: number | null;
  error: string | null;
  /** Copies de conflit créées depuis l'ouverture du coffre. */
  conflicts: number;
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
};

/** Délai après une modification locale avant de l'envoyer. */
const WRITE_DELAY_MS = 2_000;
/** Intervalle de relève quand l'app est au premier plan. */
const POLL_INTERVAL_MS = 30_000;

const OFF: SyncStatus = { state: 'off', lastSyncAt: null, error: null, conflicts: 0 };

/** Enchaîne les synchronisations : jamais deux à la fois, les demandes se cumulent. */
class SyncRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private stopped = false;

  constructor(
    private readonly store: NoteStore,
    private readonly remote: SyncRemote,
    private readonly wrapKey: Uint8Array,
    private readonly onStart: () => void,
    private readonly onDone: (result: SyncResult | null, error: string | null) => void,
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
    let result: SyncResult | null = null;
    let error: string | null = null;
    try {
      result = await synchronize(this.store, this.remote, this.wrapKey);
    } catch (cause) {
      error =
        cause instanceof SyncError ? cause.message : `Synchronisation interrompue : ${String(cause)}`;
    }
    this.running = false;
    // Arrêté en cours de route (verrouillage) : la base est fermée, rien à signaler.
    if (this.stopped) return;
    this.onDone(result, error);
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

  useEffect(() => {
    if (!enabled || !keys || !store) return;
    const remote = new SupabaseRemote({ url, anonKey }, credentialsFor(keys, url));
    const current = new SyncRunner(
      store,
      remote,
      keys.wrapKey,
      () => setStatus((previous) => ({ ...previous, state: 'syncing' })),
      (result, error) => {
        setStatus((previous) =>
          result
            ? {
                state: 'idle',
                lastSyncAt: Date.now(),
                error: null,
                conflicts: previous.conflicts + result.conflicts,
              }
            : { ...previous, state: 'error', error },
        );
        // Des éléments ont changé localement : les listes doivent se recharger.
        if (result && (result.pulled > 0 || result.conflicts > 0)) invalidate();
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
  }, [enabled, url, anonKey, keys, store]);

  // Chaque écriture locale déclenche un envoi, après un court délai.
  useEffect(() => {
    if (revision > 0) runner.current?.request(WRITE_DELAY_MS);
  }, [revision]);

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
      value={{ config, status, enable, disable, syncNow: () => runner.current?.request() }}>
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
