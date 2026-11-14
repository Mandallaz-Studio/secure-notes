import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { cryptoReady } from '@/crypto/aead';
import { deriveVaultKeys, masterKeyFromEntropy, type VaultKeys } from '@/crypto/keys';
import { toHex } from '@/crypto/vectors';
import type { CopyReport } from '@/notes/copy-store';
import { cloneNoteStore, destroyNoteStore, discardNoteStore } from '@/notes/store-manager';
import { getPref, removePref, setPref } from '@/storage/prefs';
import type { SyncInstance } from '@/sync/supabase';
import {
  canUseBiometrics,
  deleteMasterKey,
  deleteRetiring,
  isPersistent,
  loadMasterKey,
  saveMasterKey,
  saveRetiring,
} from '@/vault/key-store';
import type { RetiringVault } from '@/vault/retire';

/**
 * État du coffre :
 * - `loading`  : démarrage, rien n'est encore connu ;
 * - `empty`    : aucun coffre sur cet appareil (création ou restauration) ;
 * - `locked`   : un coffre existe, la clé n'est pas en mémoire ;
 * - `unlocked` : les clés sont en mémoire, l'app est utilisable.
 */
export type VaultStatus = 'loading' | 'empty' | 'locked' | 'unlocked';

type VaultContextValue = {
  status: VaultStatus;
  /** Clés dérivées ; non nul uniquement quand le coffre est déverrouillé. */
  keys: VaultKeys | null;
  /** Identifiant public du compte, connu même coffre verrouillé. */
  accountId: string | null;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  /** Ouvre un coffre à partir de l'entropie d'une phrase nouvelle ou saisie. */
  openWithEntropy: (entropy: Uint8Array) => Promise<void>;
  /** @returns `false` si l'authentification a échoué ou a été annulée. */
  unlock: () => Promise<boolean>;
  lock: () => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  /** Efface la clé et les notes de cet appareil. Sans la phrase, elles sont perdues. */
  destroy: () => Promise<void>;
  /**
   * Remplace le coffre par un nouveau, tiré d'une nouvelle phrase : tout le
   * contenu y est recopié, puis le nouveau coffre devient le coffre actif.
   * L'ancien est ensuite retiré par la synchronisation (voir `retire.ts`).
   * @param instance Instance où l'ancien compte est synchronisé, ou `null`.
   * @throws si la copie ou l'enregistrement de la nouvelle clé échoue ; le
   *   coffre actuel reste alors en place.
   */
  recreate: (entropy: Uint8Array, instance: SyncInstance | null) => Promise<CopyReport>;
};

// Marqueurs non secrets : ils permettent de savoir qu'un coffre existe sans
// déclencher la demande d'empreinte au démarrage.
const PREF_ACCOUNT = 'vault.account-id';
const PREF_BIOMETRIC = 'vault.biometric';

/** Durée en arrière-plan au-delà de laquelle le coffre se verrouille. */
const BACKGROUND_LOCK_MS = 30_000;

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [keys, setKeys] = useState<VaultKeys | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [biometricEnabled, setBiometricState] = useState(false);
  const masterKey = useRef<Uint8Array | null>(null);

  const forget = () => {
    masterKey.current?.fill(0);
    masterKey.current = null;
    setKeys(null);
  };

  const adopt = (key: Uint8Array) => {
    masterKey.current = key;
    const derived = deriveVaultKeys(key);
    setKeys(derived);
    setAccountId(derived.accountId);
    setStatus('unlocked');
    return derived;
  };

  // Démarrage : sans biométrie, la clé est chargée directement ; avec, on
  // attend un geste de l'utilisateur sur l'écran de verrouillage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await cryptoReady();
      const storedAccount = isPersistent ? getPref(PREF_ACCOUNT) : null;
      const biometric = getPref(PREF_BIOMETRIC) === '1';
      if (cancelled) return;
      if (!storedAccount) {
        setStatus('empty');
        return;
      }
      setAccountId(storedAccount);
      setBiometricState(biometric);
      if (biometric) {
        setStatus('locked');
        return;
      }
      const key = await loadMasterKey(false).catch(() => null);
      if (cancelled) return;
      if (key) {
        adopt(key);
      } else {
        // Marqueur présent mais clé absente (réinstallation, par exemple).
        removePref(PREF_ACCOUNT);
        setAccountId(null);
        setStatus('empty');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Verrouillage automatique après un passage prolongé en arrière-plan.
  useEffect(() => {
    if (status !== 'unlocked' || !biometricEnabled) return;
    let leftAt: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (leftAt !== null && Date.now() - leftAt > BACKGROUND_LOCK_MS) {
          forget();
          setStatus('locked');
        }
        leftAt = null;
      } else if (leftAt === null) {
        leftAt = Date.now();
      }
    });
    return () => subscription.remove();
  }, [status, biometricEnabled]);

  const openWithEntropy = async (entropy: Uint8Array) => {
    const key = masterKeyFromEntropy(entropy);
    await saveMasterKey(key, false);
    setPref(PREF_BIOMETRIC, '0');
    setBiometricState(false);
    const derived = adopt(key);
    if (isPersistent) {
      setPref(PREF_ACCOUNT, derived.accountId);
    }
  };

  const unlock = async () => {
    try {
      const key = await loadMasterKey(biometricEnabled);
      if (!key) return false;
      adopt(key);
      return true;
    } catch {
      return false;
    }
  };

  const lock = () => {
    forget();
    setStatus('locked');
  };

  const setBiometricEnabled = async (enabled: boolean) => {
    if (!masterKey.current) {
      throw new Error('Le coffre doit être déverrouillé pour changer sa protection');
    }
    await saveMasterKey(masterKey.current, enabled);
    setPref(PREF_BIOMETRIC, enabled ? '1' : '0');
    setBiometricState(enabled);
  };

  const recreate = async (entropy: Uint8Array, instance: SyncInstance | null) => {
    const previous = masterKey.current;
    if (!previous) {
      throw new Error('Le coffre doit être déverrouillé pour être recréé.');
    }
    const previousId = deriveVaultKeys(previous).accountId;
    const nextKey = masterKeyFromEntropy(entropy);
    const next = deriveVaultKeys(nextKey);

    const report = await cloneNoteStore(next);
    const record: RetiringVault = {
      accountId: previousId,
      successorId: next.accountId,
      masterKey: toHex(previous),
      instance,
    };
    await saveRetiring(JSON.stringify(record));
    try {
      await saveMasterKey(nextKey, biometricEnabled);
    } catch (error) {
      // `saveMasterKey` efface l'ancienne entrée avant d'écrire : la remettre.
      await saveMasterKey(previous, biometricEnabled).catch(() => saveMasterKey(previous, false));
      await deleteRetiring();
      await discardNoteStore(next.accountId);
      nextKey.fill(0);
      throw error;
    }
    if (isPersistent) {
      setPref(PREF_ACCOUNT, next.accountId);
    }
    adopt(nextKey);
    previous.fill(0);
    return report;
  };

  const destroy = async () => {
    // Les notes d'abord : sans la clé, la base resterait sur l'appareil, illisible.
    if (accountId) {
      await destroyNoteStore(accountId);
    }
    await deleteRetiring();
    await deleteMasterKey();
    removePref(PREF_ACCOUNT);
    removePref(PREF_BIOMETRIC);
    forget();
    setAccountId(null);
    setBiometricState(false);
    setStatus('empty');
  };

  return (
    <VaultContext
      value={{
        status,
        keys,
        accountId,
        biometricEnabled,
        biometricAvailable: canUseBiometrics(),
        openWithEntropy,
        unlock,
        lock,
        setBiometricEnabled,
        destroy,
        recreate,
      }}>
      {children}
    </VaultContext>
  );
}

export function useVault(): VaultContextValue {
  const value = use(VaultContext);
  if (!value) {
    throw new Error('useVault doit être utilisé sous VaultProvider');
  }
  return value;
}
