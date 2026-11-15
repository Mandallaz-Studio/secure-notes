import { fromBase64, KEY_BYTES, toBase64, utf8Decode, utf8Encode } from '@/crypto/aead';

/**
 * Forme des liens de partage : `<site>/s/<id>#<clé>[.<instance>]`.
 *
 * Sans dépendance à l'app (notes, stockage) : ce module sert aussi à
 * l'extension de navigateur. Ces formats font partie des liens déjà émis : ne
 * pas les changer.
 */

export type ShareInstance = { url: string; anonKey: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isShareId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** Fragment d'un lien (sans « # ») : la clé, puis l'instance si elle doit être précisée. */
export function buildShareFragment(shareKey: Uint8Array, instance: ShareInstance | null): string {
  const where = instance
    ? `.${toBase64(utf8Encode(JSON.stringify([instance.url, instance.anonKey])))}`
    : '';
  return `${toBase64(shareKey)}${where}`;
}

/**
 * @param base Adresse du site de lecture (`https://notes.exemple.fr`) ou
 *   schéma de l'app (`securenotes://`).
 * @param instance À préciser si le destinataire ne peut pas la deviner :
 *   instance autre que celle prévue à la compilation.
 */
export function buildShareLink(
  base: string,
  id: string,
  shareKey: Uint8Array,
  instance: ShareInstance | null,
): string {
  const root = base.endsWith('://') ? base : `${base.replace(/\/+$/, '')}/`;
  return `${root}s/${id}#${buildShareFragment(shareKey, instance)}`;
}

/** Lit le fragment d'un lien ; `null` s'il est incomplet ou malformé. */
export function parseShareFragment(
  fragment: string,
): { key: Uint8Array; instance: ShareInstance | null } | null {
  try {
    const [keyPart, instancePart, ...rest] = fragment.replace(/^#/, '').split('.');
    if (rest.length > 0) return null;
    const key = fromBase64(keyPart);
    if (key.length !== KEY_BYTES) return null;
    if (instancePart === undefined) return { key, instance: null };
    const pair: unknown = JSON.parse(utf8Decode(fromBase64(instancePart)));
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== 'string' ||
      typeof pair[1] !== 'string' ||
      // La page de lecture ne parle qu'en HTTPS.
      !/^https:\/\/[^/?#\s]+[^?#\s]*$/i.test(pair[0])
    ) {
      return null;
    }
    return { key, instance: { url: pair[0], anonKey: pair[1] } };
  } catch {
    return null;
  }
}

/** Découpe un lien complet en identifiant et fragment ; `null` s'il n'en a pas la forme. */
export function splitShareLink(link: string): { id: string; fragment: string } | null {
  const match = /\/s\/([0-9a-f-]{36})#([A-Za-z0-9_.-]+)$/.exec(link);
  return match && isShareId(match[1]) ? { id: match[1], fragment: match[2] } : null;
}
