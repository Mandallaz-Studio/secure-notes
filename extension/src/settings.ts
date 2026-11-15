import { defaultInstance, isDefaultInstance, SHARE_SITE } from '@/share/config';
import type { ShareInstance } from '@/share/link';

import { ext } from './browser';

/**
 * Serveur où l'extension relève les liens. Par défaut, celui fixé à la
 * compilation (le même que la page de lecture) ; sinon, celui saisi dans les
 * réglages, gardé dans `storage.local` (rien de secret : la clé « anon » est
 * publique par nature).
 */

const KEY_URL = 'instance.url';
const KEY_ANON = 'instance.anonKey';

/** Site de lecture où s'ouvrent les notes reçues (fixé à la compilation). */
export const READER_SITE = SHARE_SITE;

/** @returns l'adresse sous une forme unique, ou `null` si elle n'est pas en https. */
export function normalizeUrl(input: string): string | null {
  const match = /^https:\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(input.trim());
  return match ? `https://${match[1].toLowerCase()}${match[2].replace(/\/+$/, '')}` : null;
}

export async function loadCustomInstance(): Promise<ShareInstance | null> {
  const stored = await ext.storage.local.get([KEY_URL, KEY_ANON]);
  const url = typeof stored[KEY_URL] === 'string' ? normalizeUrl(stored[KEY_URL]) : null;
  const anonKey = typeof stored[KEY_ANON] === 'string' ? stored[KEY_ANON].trim() : '';
  return url && anonKey !== '' ? { url, anonKey } : null;
}

export async function saveCustomInstance(instance: ShareInstance | null): Promise<void> {
  if (instance) {
    await ext.storage.local.set({ [KEY_URL]: instance.url, [KEY_ANON]: instance.anonKey });
  } else {
    await ext.storage.local.remove([KEY_URL, KEY_ANON]);
  }
}

/**
 * Instance de relève, et adresse à mettre dans le QR code (`null` si c'est
 * celle par défaut, que le téléphone connaît déjà).
 */
export async function receivingInstance(): Promise<{
  instance: ShareInstance;
  announced: string | null;
} | null> {
  const custom = await loadCustomInstance();
  const instance = custom ?? defaultInstance();
  if (!instance) return null;
  return { instance, announced: isDefaultInstance(instance.url) ? null : instance.url };
}
