import {
  decrypt,
  encrypt,
  fromBase64,
  generateKey,
  KEY_BYTES,
  keyedHash,
  toBase64,
  utf8Decode,
  utf8Encode,
} from '@/crypto/aead';
import { BOX_PUBLIC_KEY_BYTES, newBoxKeyPair, openSealed, sealTo, type BoxKeyPair } from '@/crypto/box';
import { padJson } from '@/crypto/padding';
import { isShareId, parseShareFragment } from '@/share/link';

/**
 * Envoi d'un lien de partage par QR code.
 *
 * L'afficheur (extension de navigateur, ou app qui reçoit) tire un secret de
 * 256 bits et une paire de clés X25519 éphémères, et affiche un QR code qui
 * porte le secret et la clé publique. Le téléphone qui le scanne :
 *
 * 1. chiffre le lien (XChaCha20-Poly1305) avec une clé dérivée du secret ;
 * 2. scelle le résultat pour la clé publique de l'afficheur (`crypto_box_seal`) ;
 * 3. le dépose sur le serveur sous un identifiant de canal, lui aussi dérivé
 *    du secret (table `handoffs`, compte connecté obligatoire).
 *
 * L'afficheur relève le dépôt (ce qui le supprime) et l'ouvre. Le secret et la
 * clé publique ne passent que par le QR code, jamais par le serveur : il ne
 * peut ni lire le message, ni le remplacer, ni substituer sa propre clé. La
 * couche symétrique authentifie l'expéditeur (seul qui a vu le QR code peut
 * l'avoir écrit) et protège d'un futur ordinateur quantique ; la couche
 * asymétrique protège de qui aurait seulement photographié le QR code.
 *
 * Ces formats sont lus par l'extension et par d'autres versions de l'app : ne
 * pas les changer sans changer le préfixe.
 */

/** Préfixe du texte du QR code : ce n'est pas une adresse, aucune app ne l'ouvre seule. */
export const OFFER_PREFIX = 'SN1R:';

/** Durée de vie d'un QR code, et d'un dépôt sur le serveur (voir la migration). */
export const HANDOFF_TTL_MS = 5 * 60_000;

/** Intervalle de relève du dépôt par l'afficheur. */
export const HANDOFF_POLL_MS = 2_000;

const SECRET_BYTES = KEY_BYTES;

// Bourrage : la présence d'une instance dans le lien ne doit pas se voir à la
// taille. 4 096 caractères base64 au plus côté serveur.
const MESSAGE_MIN_BYTES = 1024;
const MESSAGE_MAX_BYTES = 2900;

/** Ce que porte le QR code. */
export type HandoffOffer = {
  secret: Uint8Array;
  publicKey: Uint8Array;
  /** Instance où déposer, si ce n'est pas celle prévue à la compilation. */
  instanceUrl: string | null;
};

/** Côté afficheur : le QR code et de quoi ouvrir le dépôt. */
export type HandoffReceiver = {
  /** Texte à mettre dans le QR code. */
  text: string;
  /** Identifiant du dépôt sur le serveur. */
  channel: string;
  expiresAt: number;
  secret: Uint8Array;
  pair: BoxKeyPair;
};

/** Lien reçu : identifiant du partage et fragment (clé, instance), tels que dans le lien. */
export type HandoffMessage = { id: string; fragment: string };

/** Erreur d'envoi ou de réception dont le message peut être montré tel quel. */
export class HandoffError extends Error {}

const HTTPS_URL = /^https:\/\/[^/?#\s]+[^?#\s]*$/i;

const channelOf = (secret: Uint8Array) => toBase64(keyedHash('sn1:handoff:channel', secret));
const keyOf = (secret: Uint8Array) => keyedHash('sn1:handoff:key', secret);
const contextOf = (channel: string, publicKey: Uint8Array) =>
  `sn1:handoff:${channel}:${toBase64(publicKey)}`;

/** @param instanceUrl Instance où l'afficheur relèvera, si ce n'est pas celle par défaut. */
export function createReceiver(instanceUrl: string | null, now: number): HandoffReceiver {
  if (instanceUrl !== null && !HTTPS_URL.test(instanceUrl)) {
    throw new HandoffError('Adresse d’instance invalide (attendu : https://…).');
  }
  const secret = generateKey();
  const pair = newBoxKeyPair();
  const packed = new Uint8Array(SECRET_BYTES + BOX_PUBLIC_KEY_BYTES);
  packed.set(secret, 0);
  packed.set(pair.publicKey, SECRET_BYTES);
  const where = instanceUrl === null ? '' : `.${toBase64(utf8Encode(instanceUrl))}`;
  const text = `${OFFER_PREFIX}${toBase64(packed)}${where}`;
  packed.fill(0);
  return { text, channel: channelOf(secret), expiresAt: now + HANDOFF_TTL_MS, secret, pair };
}

/** Efface les secrets de l'afficheur (QR code expiré, écran fermé, lien reçu). */
export function wipeReceiver(receiver: HandoffReceiver): void {
  receiver.secret.fill(0);
  receiver.pair.privateKey.fill(0);
}

/** Lit le texte d'un QR code ; `null` si ce n'est pas un QR code de réception Secure Notes. */
export function parseOffer(text: string): HandoffOffer | null {
  if (!text.startsWith(OFFER_PREFIX)) return null;
  try {
    const [packedPart, instancePart, ...rest] = text.slice(OFFER_PREFIX.length).split('.');
    if (rest.length > 0) return null;
    const packed = fromBase64(packedPart);
    if (packed.length !== SECRET_BYTES + BOX_PUBLIC_KEY_BYTES) return null;
    let instanceUrl: string | null = null;
    if (instancePart !== undefined) {
      instanceUrl = utf8Decode(fromBase64(instancePart));
      if (!HTTPS_URL.test(instanceUrl)) return null;
    }
    const offer = {
      secret: packed.slice(0, SECRET_BYTES),
      publicKey: packed.slice(SECRET_BYTES),
      instanceUrl,
    };
    packed.fill(0);
    return offer;
  } catch {
    return null;
  }
}

/** Valide un lien à envoyer ou reçu ; la clé lue n'est gardée nulle part. */
function isValidMessage(message: HandoffMessage): boolean {
  if (!isShareId(message.id)) return false;
  const parsed = parseShareFragment(message.fragment);
  parsed?.key.fill(0);
  return parsed !== null;
}

/**
 * Côté téléphone : chiffre le lien pour l'afficheur du QR code.
 * @returns l'identifiant du dépôt et le message, en base64.
 */
export function sealHandoff(
  offer: HandoffOffer,
  message: HandoffMessage,
): { channel: string; payload: string } {
  if (!isValidMessage(message)) throw new HandoffError('Lien de partage invalide.');
  const channel = channelOf(offer.secret);
  const key = keyOf(offer.secret);
  try {
    const plain = utf8Encode(JSON.stringify({ v: 1, id: message.id, fragment: message.fragment }));
    if (plain.length > MESSAGE_MAX_BYTES) throw new HandoffError('Lien de partage trop long.');
    const inner = encrypt(
      padJson(plain, MESSAGE_MIN_BYTES, MESSAGE_MAX_BYTES),
      key,
      contextOf(channel, offer.publicKey),
    );
    return { channel, payload: toBase64(sealTo(inner, offer.publicKey)) };
  } finally {
    key.fill(0);
  }
}

/**
 * Côté afficheur : ouvre le dépôt relevé.
 * @throws HandoffError si le message n'a pas été écrit par qui a scanné ce QR code.
 */
export function openHandoff(receiver: HandoffReceiver, payload: string): HandoffMessage {
  const key = keyOf(receiver.secret);
  try {
    const inner = openSealed(fromBase64(payload), receiver.pair);
    const parsed: unknown = JSON.parse(
      utf8Decode(decrypt(inner, key, contextOf(receiver.channel, receiver.pair.publicKey))),
    );
    const message = parsed as { v?: unknown; id?: unknown; fragment?: unknown } | null;
    if (
      typeof message !== 'object' ||
      message === null ||
      message.v !== 1 ||
      typeof message.id !== 'string' ||
      typeof message.fragment !== 'string'
    ) {
      throw new Error('forme');
    }
    const result = { id: message.id, fragment: message.fragment };
    if (!isValidMessage(result)) throw new Error('lien');
    return result;
  } catch {
    throw new HandoffError('Le lien reçu est illisible ou a été altéré.');
  } finally {
    key.fill(0);
  }
}

// --- Relève (sans compte) ----------------------------------------------------

const REQUEST_TIMEOUT_MS = 15_000;
/** Plus longue réponse admise : un message (4 096 caractères) en JSON. */
const MAX_REPLY_CHARS = 4_200;

/**
 * Relève le dépôt d'un canal, ce qui le supprime du serveur.
 * @returns `null` tant que rien n'a été déposé.
 * @throws HandoffError si l'instance est injoignable ou refuse la requête.
 */
export async function takeHandoff(
  instance: { url: string; anonKey: string },
  channel: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status: number;
  let text: string;
  try {
    const response = await fetchImpl(`${instance.url}/rest/v1/rpc/take_handoff`, {
      method: 'POST',
      headers: { apikey: instance.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoff_id: channel }),
      signal: controller.signal,
    });
    status = response.status;
    if (Number(response.headers?.get('content-length') ?? 0) > MAX_REPLY_CHARS) {
      controller.abort();
      throw new HandoffError('Réponse du serveur trop volumineuse.');
    }
    text = await response.text();
  } catch (cause) {
    if (cause instanceof HandoffError) throw cause;
    throw new HandoffError('Serveur injoignable : vérifiez votre connexion.');
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_REPLY_CHARS) throw new HandoffError('Réponse du serveur trop volumineuse.');
  if (status === 404) {
    throw new HandoffError('Ce serveur ne propose pas l’envoi par QR code (instance pas à jour).');
  }
  if (status !== 200) throw new HandoffError(`Le serveur a refusé la requête (${status}).`);
  try {
    const body: unknown = text === '' ? null : JSON.parse(text);
    return typeof body === 'string' && body !== '' ? body : null;
  } catch {
    throw new HandoffError('Réponse du serveur inattendue.');
  }
}
