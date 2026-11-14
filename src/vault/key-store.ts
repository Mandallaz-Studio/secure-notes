import * as SecureStore from 'expo-secure-store';

import { fromHex, toHex } from '@/crypto/vectors';
import { getPref, removePref, setPref } from '@/storage/prefs';

/**
 * Stockage de la clé maîtresse dans le Keychain (iOS) ou le Keystore (Android).
 *
 * Avec la protection biométrique, la clé est liée à l'authentification par le
 * système lui-même : elle n'est remise à l'app qu'après empreinte ou visage.
 * Contrepartie : si les empreintes enregistrées sur le téléphone changent, le
 * système invalide la clé et il faut restaurer le coffre avec la phrase.
 */

/**
 * Deux emplacements, dont un seul est actif (`vault.key-slot`) : changer la
 * protection de la clé, ou la remplacer, c'est écrire dans l'emplacement
 * libre puis basculer. Une écriture qui échoue (demande d'empreinte annulée,
 * erreur du Keystore, app tuée) laisse donc l'ancienne entrée intacte et
 * active : la clé n'est jamais absente du téléphone, même un instant.
 * Une entrée ne change pas de niveau de protection en place : il faut bien une
 * nouvelle entrée.
 */
const SLOTS = ['vault.master-key', 'vault.master-key.b'] as const;
type Slot = 0 | 1;
/** Emplacement actif ; absent, c'est le premier (seul emplacement des premières versions). */
const PREF_SLOT = 'vault.key-slot';

function activeSlot(): Slot {
  return getPref(PREF_SLOT) === '1' ? 1 : 0;
}

export const isPersistent = true;

export function canUseBiometrics(): boolean {
  return SecureStore.canUseBiometricAuthentication();
}

/**
 * Enregistre la clé, avec ou sans protection biométrique, à la place de la
 * clé actuelle.
 * @throws si l'écriture échoue ; la clé enregistrée jusque-là reste alors en place.
 */
export async function saveMasterKey(masterKey: Uint8Array, biometric: boolean): Promise<void> {
  const current = activeSlot();
  const next: Slot = current === 0 ? 1 : 0;
  // L'emplacement libre peut garder le reste d'un essai interrompu.
  await SecureStore.deleteItemAsync(SLOTS[next]);
  try {
    await SecureStore.setItemAsync(SLOTS[next], toHex(masterKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: biometric,
      authenticationPrompt: 'Protéger le coffre',
    });
    setPref(PREF_SLOT, String(next));
    if (activeSlot() !== next) {
      throw new Error("Le choix de l'emplacement de la clé n'a pas pu être enregistré.");
    }
  } catch (error) {
    await SecureStore.deleteItemAsync(SLOTS[next]).catch(() => {});
    throw error;
  }
  // L'ancienne entrée ne sert plus ; si elle résiste, elle sera effacée au
  // prochain enregistrement (c'est alors l'emplacement libre).
  await SecureStore.deleteItemAsync(SLOTS[current]).catch(() => {});
}

/**
 * @returns la clé, ou `null` si aucune n'est stockée.
 * @throws si l'authentification biométrique échoue ou est annulée.
 */
export async function loadMasterKey(biometric: boolean): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(SLOTS[activeSlot()], {
    requireAuthentication: biometric,
    authenticationPrompt: 'Déverrouiller le coffre',
  });
  return hex ? fromHex(hex) : null;
}

export async function deleteMasterKey(): Promise<void> {
  for (const slot of SLOTS) await SecureStore.deleteItemAsync(slot);
  removePref(PREF_SLOT);
}

const RETIRING = 'vault.retiring';

/**
 * Ancien coffre en cours de retrait (voir `retire.ts`). Il contient sa clé
 * maîtresse : il ne reste là que le temps de vider et fermer l'ancien compte,
 * sans protection biométrique pour que ce ménage se fasse sans intervention.
 */
export async function saveRetiring(value: string): Promise<void> {
  await SecureStore.setItemAsync(RETIRING, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadRetiring(): Promise<string | null> {
  return SecureStore.getItemAsync(RETIRING);
}

export async function deleteRetiring(): Promise<void> {
  await SecureStore.deleteItemAsync(RETIRING);
}
