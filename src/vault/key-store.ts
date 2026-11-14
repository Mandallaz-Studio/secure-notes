import * as SecureStore from 'expo-secure-store';

import { fromHex, toHex } from '@/crypto/vectors';

/**
 * Stockage de la clé maîtresse dans le Keychain (iOS) ou le Keystore (Android).
 *
 * Avec la protection biométrique, la clé est liée à l'authentification par le
 * système lui-même : elle n'est remise à l'app qu'après empreinte ou visage.
 * Contrepartie : si les empreintes enregistrées sur le téléphone changent, le
 * système invalide la clé et il faut restaurer le coffre avec la phrase.
 */

const KEY = 'vault.master-key';

export const isPersistent = true;

export function canUseBiometrics(): boolean {
  return SecureStore.canUseBiometricAuthentication();
}

export async function saveMasterKey(masterKey: Uint8Array, biometric: boolean): Promise<void> {
  // Supprimer d'abord : une entrée ne change pas de niveau de protection en place.
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.setItemAsync(KEY, toHex(masterKey), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: biometric,
    authenticationPrompt: 'Protéger le coffre',
  });
}

/**
 * @returns la clé, ou `null` si aucune n'est stockée.
 * @throws si l'authentification biométrique échoue ou est annulée.
 */
export async function loadMasterKey(biometric: boolean): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(KEY, {
    requireAuthentication: biometric,
    authenticationPrompt: 'Déverrouiller le coffre',
  });
  return hex ? fromHex(hex) : null;
}

export async function deleteMasterKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
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
