/**
 * Enregistrement de la clé maîtresse : une écriture qui échoue (demande
 * d'empreinte annulée, erreur du Keystore) ne doit jamais faire perdre la clé
 * déjà enregistrée.
 */

const mockSecure = new Map<string, { value: string; biometric: boolean }>();
let mockFailNextWrite = false;

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  canUseBiometricAuthentication: () => true,
  deleteItemAsync: async (key: string) => {
    mockSecure.delete(key);
  },
  setItemAsync: async (key: string, value: string, options?: { requireAuthentication?: boolean }) => {
    if (mockFailNextWrite) {
      mockFailNextWrite = false;
      throw new Error('Authentification annulée');
    }
    mockSecure.set(key, { value, biometric: options?.requireAuthentication === true });
  },
  getItemAsync: async (key: string) => mockSecure.get(key)?.value ?? null,
}));

const mockPrefs = new Map<string, string>();

jest.mock('@/storage/prefs', () => ({
  getPref: (key: string) => mockPrefs.get(key) ?? null,
  setPref: (key: string, value: string) => mockPrefs.set(key, value),
  removePref: (key: string) => mockPrefs.delete(key),
}));

// eslint-disable-next-line import/first
import { deleteMasterKey, loadMasterKey, saveMasterKey } from '@/vault/key-store';

const keyA = new Uint8Array(32).fill(1);
const keyB = new Uint8Array(32).fill(2);

beforeEach(() => {
  mockSecure.clear();
  mockPrefs.clear();
  mockFailNextWrite = false;
});

test('la clé enregistrée se relit, et change de protection', async () => {
  await saveMasterKey(keyA, false);
  expect(await loadMasterKey(false)).toEqual(keyA);
  await saveMasterKey(keyA, true);
  expect(await loadMasterKey(true)).toEqual(keyA);
  // Une seule entrée à la fois : l'ancienne, sans biométrie, a disparu.
  expect([...mockSecure.values()]).toEqual([{ value: expect.any(String), biometric: true }]);
});

test('une écriture refusée laisse la clé précédente en place', async () => {
  await saveMasterKey(keyA, false);
  mockFailNextWrite = true;
  await expect(saveMasterKey(keyA, true)).rejects.toThrow('Authentification annulée');
  expect(await loadMasterKey(false)).toEqual(keyA);
  expect([...mockSecure.values()]).toEqual([{ value: expect.any(String), biometric: false }]);
});

test('un remplacement refusé garde l’ancienne clé', async () => {
  await saveMasterKey(keyA, false);
  mockFailNextWrite = true;
  await expect(saveMasterKey(keyB, false)).rejects.toThrow();
  expect(await loadMasterKey(false)).toEqual(keyA);
  await saveMasterKey(keyB, false);
  expect(await loadMasterKey(false)).toEqual(keyB);
});

test('les installations existantes lisent le premier emplacement', async () => {
  mockSecure.set('vault.master-key', { value: '01'.repeat(32), biometric: false });
  expect(await loadMasterKey(false)).toEqual(keyA);
  await saveMasterKey(keyB, false);
  expect(await loadMasterKey(false)).toEqual(keyB);
  expect(mockSecure.has('vault.master-key')).toBe(false);
});

test('la suppression efface les deux emplacements', async () => {
  await saveMasterKey(keyA, false);
  await saveMasterKey(keyB, false);
  await deleteMasterKey();
  expect(mockSecure.size).toBe(0);
  expect(await loadMasterKey(false)).toBeNull();
});
