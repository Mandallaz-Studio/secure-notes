import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

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

/**
 * Issue d'un déverrouillage :
 * - `cancelled`  : authentification refusée ou annulée (ou, avec la biométrie,
 *   clé invalidée par un changement des empreintes : le système ne les distingue pas) ;
 * - `unreadable` : le système n'a pas rendu la clé (erreur du Keychain ou du Keystore) ;
 * - `missing`    : plus aucune clé n'est enregistrée sur l'appareil.
 */
export type UnlockResult = 'ok' | 'cancelled' | 'unreadable' | 'missing';

type VaultContextValue = {
  status: VaultStatus;
  /** Clés dérivées ; non nul uniquement quand le coffre est déverrouillé. */
  keys: VaultKeys | null;
  /** Identifiant public du compte, connu même coffre verrouillé. */
  accountId: string | null;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  /**
   * Verrouillage par le déverrouillage de l'appareil (code, schéma, empreinte
   * ou visage), au choix de l'utilisateur. Contrairement à la biométrie, la
   * clé n'y est pas liée par le système : c'est l'app qui exige
   * l'authentification avant de la lire.
   */
  deviceLockEnabled: boolean;
  /** L'appareil a un verrouillage d'écran (code, schéma, empreinte ou visage). */
  deviceLockAvailable: boolean;
  /** Le coffre se verrouille : au démarrage, après 30 s en arrière-plan, et à la demande. */
  lockable: boolean;
  /**
   * La clé n'a pas pu être lue au démarrage (`unreadable`), ou n'est plus sur
   * l'appareil alors que le coffre y est (`missing`). Le coffre est présenté
   * verrouillé plutôt qu'absent : une erreur passagère ne doit pas pousser à en
   * créer un autre (ce qui effacerait cette clé), et une clé perdue se
   * retrouve avec la phrase, sans effacer les notes de l'appareil.
   */
  keyProblem: Exclude<UnlockResult, 'ok' | 'cancelled'> | null;
  /** Ouvre un coffre à partir de l'entropie d'une phrase nouvelle ou saisie. */
  openWithEntropy: (entropy: Uint8Array) => Promise<void>;
  unlock: () => Promise<UnlockResult>;
  lock: () => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  /**
   * Active ou coupe le verrouillage par le code de l'appareil ; demande
   * l'authentification dans les deux cas.
   * @returns `false` si l'authentification a été refusée ou annulée.
   * @throws si l'appareil n'a aucun verrouillage d'écran.
   */
  setDeviceLockEnabled: (enabled: boolean) => Promise<boolean>;
  /** Efface la clé et les notes de cet appareil. Sans la phrase, elles sont perdues. */
  destroy: () => Promise<void>;
  /**
   * Clé introuvable : revient à l'accueil pour restaurer le coffre avec la
   * phrase. Les notes de l'appareil sont gardées ; la même phrase les rouvre.
   */
  restoreWithPhrase: () => void;
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
const PREF_DEVICE_LOCK = 'vault.device-lock';

/** Durée en arrière-plan au-delà de laquelle le coffre se verrouille. */
const BACKGROUND_LOCK_MS = 30_000;

/** Demande le déverrouillage de l'appareil (biométrie, avec le code en repli). */
async function authenticateDevice(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Annuler',
    });
    return result.success;
  } catch {
    return false;
  }
}

async function hasDeviceLock(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [keys, setKeys] = useState<VaultKeys | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [biometricEnabled, setBiometricState] = useState(false);
  const [deviceLockEnabled, setDeviceLockState] = useState(false);
  const [deviceLockAvailable, setDeviceLockAvailable] = useState(false);
  const [keyProblem, setKeyProblem] = useState<VaultContextValue['keyProblem']>(null);
  const masterKey = useRef<Uint8Array | null>(null);
  const lockable = biometricEnabled || deviceLockEnabled;

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
    setKeyProblem(null);
    setStatus('unlocked');
    return derived;
  };

  // Démarrage : sans verrouillage, la clé est chargée directement ; avec, on
  // attend un geste de l'utilisateur sur l'écran de verrouillage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await cryptoReady();
      const storedAccount = isPersistent ? getPref(PREF_ACCOUNT) : null;
      const biometric = getPref(PREF_BIOMETRIC) === '1';
      const deviceLock = getPref(PREF_DEVICE_LOCK) === '1';
      if (cancelled) return;
      if (!storedAccount) {
        setStatus('empty');
        return;
      }
      setAccountId(storedAccount);
      setBiometricState(biometric);
      setDeviceLockState(deviceLock);
      if (biometric || deviceLock) {
        setStatus('locked');
        return;
      }
      let key: Uint8Array | null;
      try {
        key = await loadMasterKey(false);
      } catch {
        // Erreur du système, peut-être passagère : surtout ne pas conclure à
        // l'absence de coffre. L'écran de verrouillage propose de réessayer.
        if (cancelled) return;
        setKeyProblem('unreadable');
        setStatus('locked');
        return;
      }
      if (cancelled) return;
      if (key) {
        adopt(key);
      } else {
        // Marqueur présent mais clé absente : ne pas conclure à l'absence de
        // coffre, sa base est peut-être encore là. L'écran de verrouillage
        // propose de le restaurer avec la phrase, sans rien effacer.
        setKeyProblem('missing');
        setStatus('locked');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Un verrouillage d'écran a pu être ajouté ou retiré pendant que l'app était en arrière-plan.
  useEffect(() => {
    void hasDeviceLock().then(setDeviceLockAvailable);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void hasDeviceLock().then(setDeviceLockAvailable);
    });
    return () => subscription.remove();
  }, []);

  // Verrouillage automatique après un passage prolongé en arrière-plan.
  useEffect(() => {
    if (status !== 'unlocked' || !lockable) return;
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
  }, [status, lockable]);

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

  const unlock = async (): Promise<UnlockResult> => {
    if (!biometricEnabled && deviceLockEnabled) {
      if (!(await authenticateDevice('Déverrouiller le coffre'))) return 'cancelled';
    }
    let key: Uint8Array | null;
    try {
      key = await loadMasterKey(biometricEnabled);
    } catch {
      return biometricEnabled ? 'cancelled' : 'unreadable';
    }
    if (!key) return 'missing';
    adopt(key);
    return 'ok';
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

  const setDeviceLockEnabled = async (enabled: boolean) => {
    if (!(await hasDeviceLock())) {
      throw new Error("Cet appareil n'a aucun verrouillage d'écran.");
    }
    const ok = await authenticateDevice(
      enabled ? 'Verrouiller le coffre avec le code' : 'Retirer le verrouillage par code',
    );
    if (!ok) return false;
    setPref(PREF_DEVICE_LOCK, enabled ? '1' : '0');
    setDeviceLockState(enabled);
    return true;
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
      // L'ancienne clé est restée en place (voir `saveMasterKey`).
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
    removePref(PREF_DEVICE_LOCK);
    forget();
    setAccountId(null);
    setBiometricState(false);
    setDeviceLockState(false);
    setKeyProblem(null);
    setStatus('empty');
  };

  const restoreWithPhrase = () => {
    forget();
    removePref(PREF_ACCOUNT);
    removePref(PREF_BIOMETRIC);
    removePref(PREF_DEVICE_LOCK);
    setAccountId(null);
    setBiometricState(false);
    setDeviceLockState(false);
    setKeyProblem(null);
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
        deviceLockEnabled,
        deviceLockAvailable,
        lockable,
        keyProblem,
        openWithEntropy,
        unlock,
        lock,
        setBiometricEnabled,
        setDeviceLockEnabled,
        destroy,
        restoreWithPhrase,
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
