/**
 * Sur le web, il n'existe pas de stockage matériel sécurisé : la clé maîtresse
 * n'est gardée qu'en mémoire et disparaît au rechargement de la page. Le web ne
 * sert qu'à lire les notes partagées et à tester l'interface.
 */

let inMemory: Uint8Array | null = null;

export const isPersistent = false;

export function canUseBiometrics(): boolean {
  return false;
}

export async function saveMasterKey(masterKey: Uint8Array, _biometric: boolean): Promise<void> {
  inMemory = masterKey.slice();
}

export async function loadMasterKey(_biometric: boolean): Promise<Uint8Array | null> {
  return inMemory ? inMemory.slice() : null;
}

export async function deleteMasterKey(): Promise<void> {
  inMemory?.fill(0);
  inMemory = null;
}
