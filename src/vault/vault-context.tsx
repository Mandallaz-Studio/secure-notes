import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { cryptoReady } from '@/crypto/aead';
import { deriveVaultKeys, masterKeyFromEntropy, type VaultKeys } from '@/crypto/keys';
import { getPref, removePref, setPref } from '@/storage/prefs';
import {
  canUseBiometrics,
  deleteMasterKey,
  isPersistent,
  loadMasterKey,
  saveMasterKey,
} from '@/vault/key-store';

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
  /** Efface la clé de cet appareil. Sans la phrase, les données sont perdues. */
  destroy: () => Promise<void>;
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

  const destroy = async () => {
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
