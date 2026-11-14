import { fromBase64, keyedHash, toBase64 } from '@/crypto/aead';
import type { VaultKeys } from '@/crypto/keys';
import {
  QuotaExceededError,
  type BlobRemote,
  type RemoteAttachment,
  type StorageUsage,
} from '@/sync/blobs';
import type { RemoteRow, SyncRemote } from '@/sync/engine';

/**
 * Accès à une instance Supabase, directement par ses API HTTP (Auth et
 * PostgREST, Storage pour les fichiers), sans bibliothèque tierce.
 *
 * Le compte n'a pas d'e-mail réel : l'adresse est fabriquée à partir de
 * l'identifiant du compte, et le mot de passe est dérivé de la phrase de
 * récupération **et de l'adresse de l'instance**. Une instance malveillante
 * n'apprend donc rien qui permette de se connecter à une autre instance.
 */

export type SyncInstance = {
  /** Adresse de l'instance, sans barre finale. */
  url: string;
  /** Clé publique (« anon » ou « publishable ») de l'instance. */
  anonKey: string;
};

/** Domaine des adresses synthétiques ; aucun e-mail n'y est jamais envoyé. */
const EMAIL_DOMAIN = 'securenotes.invalid';

const REQUEST_TIMEOUT_MS = 20_000;
/** Marge avant l'expiration du jeton pour en redemander un. */
const TOKEN_MARGIN_MS = 60_000;

/** Erreur de synchronisation dont le message peut être montré tel quel. */
export class SyncError extends Error {}

/** Le compte a été fermé : le coffre a été recréé, avec une nouvelle phrase, sur un autre appareil. */
export class AccountClosedError extends SyncError {
  constructor() {
    super(
      'Ce coffre a été remplacé par un nouveau (nouvelle phrase de récupération) depuis un autre appareil : son compte est fermé et ne reçoit plus rien. Exportez au besoin les notes de cet appareil, puis supprimez ce coffre et restaurez le nouveau avec sa phrase.',
    );
  }
}

/**
 * L'identifiant d'un partage est déjà pris par un autre compte : ce lien
 * affiche désormais un contenu que son auteur ne contrôle plus.
 */
export class ShareTakenError extends SyncError {
  constructor() {
    super(
      'Ce lien de partage a été repris par un autre compte : il ne montre plus votre note. Prévenez ses destinataires.',
    );
  }
}

/**
 * Met l'adresse sous une forme unique (le mot de passe du compte en dépend).
 * @throws SyncError si l'adresse est inutilisable.
 */
export function normalizeInstanceUrl(input: string, allowHttp = false): string {
  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)$/i.exec(input.trim());
  if (!match) {
    throw new SyncError("Adresse d'instance invalide (attendu : https://…).");
  }
  const scheme = match[1].toLowerCase();
  if (scheme !== 'https' && !allowHttp) {
    throw new SyncError("L'adresse de l'instance doit commencer par https://.");
  }
  return `${scheme}://${match[2].toLowerCase()}${match[3].replace(/\/+$/, '')}`;
}

export type SyncCredentials = { email: string; password: string };

/** @param url Adresse déjà normalisée. */
export function credentialsFor(
  keys: Pick<VaultKeys, 'accountId' | 'authSecret'>,
  url: string,
): SyncCredentials {
  const secret = fromBase64(keys.authSecret);
  try {
    return {
      email: `${keys.accountId}@${EMAIL_DOMAIN}`,
      password: toBase64(keyedHash(`sn1:auth:${url}`, secret)),
    };
  } finally {
    secret.fill(0);
  }
}

type Json = Record<string, unknown>;

/** Partage tel que le serveur le garde : tout y est chiffré. */
export type RemoteShare = { id: string; meta: string; createdAt: number };

type Reply = { status: number; body: unknown; bytes?: Uint8Array };

/** Bucket Storage privé des blocs chiffrés (voir la migration « attachments »). */
const BUCKET = 'attachments';
/** Nombre d'objets supprimés par requête. */
const DELETE_BATCH = 100;

export class SupabaseRemote implements SyncRemote, BlobRemote {
  readonly instanceId: string;
  private session: { token: string; expiresAt: number; userId: string | null } | null = null;

  /**
   * @param allowClosed Accepter un compte fermé : seul le ménage qui le ferme
   *   s'y connecte encore. Sinon la connexion échoue par AccountClosedError.
   */
  constructor(
    private readonly instance: SyncInstance,
    private readonly credentials: SyncCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly allowClosed = false,
  ) {
    this.instanceId = instance.url;
  }

  /**
   * @param body Objet envoyé en JSON, ou octets envoyés tels quels.
   * @param binary La réponse 200 est lue en octets (`bytes`) et non en JSON.
   */
  private async send(
    method: string,
    path: string,
    body?: Json | Uint8Array,
    headers?: Json,
    binary = false,
  ): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const raw = body instanceof Uint8Array;
    let response: Response;
    let text = '';
    let bytes: Uint8Array | undefined;
    try {
      response = await this.fetchImpl(`${this.instance.url}${path}`, {
        method,
        headers: {
          apikey: this.instance.anonKey,
          ...(body ? { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' } : {}),
          ...headers,
        } as Record<string, string>,
        body: raw ? (body as unknown as BodyInit) : body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (binary && response.status === 200) {
        bytes = new Uint8Array(await response.arrayBuffer());
      } else {
        text = await response.text();
      }
    } catch {
      throw new SyncError('Instance injoignable (pas de réseau, ou adresse incorrecte).');
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown = null;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      // Réponse non JSON : ce n'est pas une instance Supabase, ou une erreur de proxy.
    }
    return { status: response.status, body: parsed, bytes };
  }

  private static describe(reply: Reply): string {
    const body = (reply.body ?? {}) as Json;
    const detail = body.msg ?? body.message ?? body.error_description ?? body.error;
    return typeof detail === 'string' ? `${reply.status} — ${detail}` : String(reply.status);
  }

  private adopt(reply: Reply): boolean {
    const body = (reply.body ?? {}) as Json;
    if (reply.status !== 200 || typeof body.access_token !== 'string') return false;
    const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    const user = (body.user ?? {}) as Json;
    this.session = {
      token: body.access_token,
      expiresAt: Date.now() + lifetime * 1000,
      userId: typeof user.id === 'string' ? user.id : null,
    };
    return true;
  }

  /** Ouvre une session ; crée le compte s'il n'existe pas encore sur l'instance. */
  async signIn(): Promise<void> {
    this.session = null;
    const login = await this.send('POST', '/auth/v1/token?grant_type=password', this.credentials);
    if (this.adopt(login)) {
      if (!this.allowClosed && (await this.isClosed())) {
        this.session = null;
        throw new AccountClosedError();
      }
      return;
    }
    if (login.status === 401 || login.status === 403 || login.status === 404) {
      throw new SyncError(
        `L'instance a refusé la connexion (${SupabaseRemote.describe(login)}). Vérifiez l'adresse et la clé.`,
      );
    }
    if (login.status !== 400) {
      throw new SyncError(`Connexion impossible (${SupabaseRemote.describe(login)}).`);
    }

    // Identifiants inconnus : premier usage de ce coffre sur cette instance.
    const signup = await this.send('POST', '/auth/v1/signup', this.credentials);
    if (this.adopt(signup)) return;
    if (signup.status === 200) {
      throw new SyncError(
        "L'instance exige une confirmation par e-mail : désactivez « Confirm email » dans ses réglages d'authentification.",
      );
    }
    const code = ((signup.body ?? {}) as Json).error_code;
    if (signup.status === 422 && code === 'user_already_exists') {
      throw new SyncError(
        'Ce coffre a déjà un compte sur cette instance, créé sous une autre adresse : utilisez exactement la même adresse que sur vos autres appareils.',
      );
    }
    throw new SyncError(`Création du compte impossible (${SupabaseRemote.describe(signup)}).`);
  }

  private async ensureSession(): Promise<void> {
    if (!this.session || this.session.expiresAt - TOKEN_MARGIN_MS < Date.now()) {
      await this.signIn();
    }
  }

  /** Requête authentifiée ; rouvre la session si elle a expiré. */
  private async authed(
    method: string,
    path: string,
    body?: Json | Uint8Array,
    headers?: Json,
    binary = false,
  ): Promise<Reply> {
    for (let attempt = 0; ; attempt += 1) {
      await this.ensureSession();
      const reply = await this.send(
        method,
        path,
        body,
        { Authorization: `Bearer ${this.session?.token}`, ...headers },
        binary,
      );
      if (reply.status === 401 && attempt === 0) {
        this.session = null;
        continue;
      }
      return reply;
    }
  }

  /** Requête authentifiée vers PostgREST. */
  private rest(method: string, path: string, body?: Json, prefer?: string): Promise<Reply> {
    return this.authed(method, `/rest/v1${path}`, body, prefer ? { Prefer: prefer } : undefined);
  }

  /** Chemin, dans le bucket, du bloc `index` du fichier `id` : `<compte>/<fichier>/<rang>`. */
  private async chunkPath(id: string, index: number): Promise<string> {
    await this.ensureSession();
    const userId = this.session?.userId;
    if (!userId) throw new SyncError("L'instance n'a pas indiqué l'identifiant du compte.");
    return `${userId}/${id}/${index}`;
  }

  /**
   * Code d'une réponse de Storage : selon sa version, l'erreur réelle est dans
   * le statut HTTP ou dans le champ `statusCode` d'une réponse 400.
   */
  private static storageCode(reply: Reply): number {
    const code = Number(((reply.body ?? {}) as Json).statusCode);
    return Number.isInteger(code) && code > 0 ? code : reply.status;
  }

  private static failStorage(reply: Reply): never {
    if (SupabaseRemote.storageCode(reply) === 404) {
      throw new SyncError(
        "L'instance n'est pas à jour pour Secure Notes (bucket « attachments » absent) : appliquez les migrations du dossier supabase/migrations.",
      );
    }
    throw new SyncError(`Le stockage a refusé la requête (${SupabaseRemote.describe(reply)}).`);
  }

  private static failOutdated(missing: string): never {
    throw new SyncError(
      `L'instance n'est pas à jour pour Secure Notes (${missing}) : appliquez les migrations du dossier supabase/migrations.`,
    );
  }

  private static fail(reply: Reply): never {
    const message = ((reply.body ?? {}) as Json).message;
    if (typeof message === 'string' && message.includes('storage_quota_exceeded')) {
      throw new SyncError(
        'Quota du compte atteint sur le serveur : les modifications restent sur cet appareil. Supprimez des fichiers joints, videz la corbeille, ou faites augmenter le quota du compte.',
      );
    }
    if (reply.status === 404) {
      throw new SyncError(
        "L'instance n'est pas à jour pour Secure Notes (table absente) : appliquez les migrations du dossier supabase/migrations.",
      );
    }
    throw new SyncError(`Le serveur a refusé la requête (${SupabaseRemote.describe(reply)}).`);
  }

  private static seqOf(reply: Reply): number | null {
    const row = Array.isArray(reply.body) ? (reply.body[0] as Json | undefined) : undefined;
    return typeof row?.seq === 'number' ? row.seq : null;
  }

  async pull(afterSeq: number, limit: number): Promise<RemoteRow[]> {
    const reply = await this.rest(
      'GET',
      `/items?select=id,seq,ciphertext,wrapped_key&seq=gt.${afterSeq}&order=seq.asc&limit=${limit}`,
    );
    if (reply.status !== 200 || !Array.isArray(reply.body)) SupabaseRemote.fail(reply);
    return (reply.body as Json[]).map((row) => {
      if (typeof row.id !== 'string' || typeof row.seq !== 'number') {
        throw new SyncError('Réponse du serveur inattendue.');
      }
      return {
        id: row.id,
        seq: row.seq,
        ciphertext: typeof row.ciphertext === 'string' ? row.ciphertext : '',
        wrappedKey: typeof row.wrapped_key === 'string' ? row.wrapped_key : '',
      };
    });
  }

  async insert(row: Omit<RemoteRow, 'seq'>): Promise<number | null> {
    const reply = await this.rest(
      'POST',
      '/items?select=seq',
      { id: row.id, ciphertext: row.ciphertext, wrapped_key: row.wrappedKey },
      'return=representation',
    );
    if (reply.status === 409) return null;
    const seq = SupabaseRemote.seqOf(reply);
    if (reply.status !== 201 || seq === null) SupabaseRemote.fail(reply);
    return seq;
  }

  async update(row: Omit<RemoteRow, 'seq'>, baseSeq: number): Promise<number | null> {
    const reply = await this.rest(
      'PATCH',
      `/items?id=eq.${row.id}&seq=eq.${baseSeq}&select=seq`,
      { ciphertext: row.ciphertext, wrapped_key: row.wrappedKey },
      'return=representation',
    );
    if (reply.status !== 200 || !Array.isArray(reply.body)) SupabaseRemote.fail(reply);
    // Aucune ligne touchée : la version du serveur n'est plus celle attendue.
    return SupabaseRemote.seqOf(reply);
  }

  // --- Fichiers joints et images -------------------------------------------
  // Une ligne par fichier dans la table `attachments` ; les blocs chiffrés sont
  // des objets du bucket Storage.

  async listAttachmentIds(): Promise<string[]> {
    const ids: string[] = [];
    const page = 1000;
    for (;;) {
      const reply = await this.rest(
        'GET',
        `/attachments?select=id&order=id.asc&limit=${page}&offset=${ids.length}`,
      );
      if (reply.status !== 200 || !Array.isArray(reply.body)) SupabaseRemote.fail(reply);
      const rows = reply.body as Json[];
      for (const row of rows) if (typeof row.id === 'string') ids.push(row.id);
      if (rows.length < page) return ids;
    }
  }

  async getAttachment(id: string): Promise<RemoteAttachment | null> {
    const reply = await this.rest(
      'GET',
      `/attachments?id=eq.${id}&select=wrapped_key,chunk_count,size_bytes`,
    );
    if (reply.status !== 200 || !Array.isArray(reply.body)) SupabaseRemote.fail(reply);
    const row = reply.body[0] as Json | undefined;
    if (!row) return null;
    if (
      typeof row.wrapped_key !== 'string' ||
      typeof row.chunk_count !== 'number' ||
      typeof row.size_bytes !== 'number'
    ) {
      throw new SyncError('Réponse du serveur inattendue.');
    }
    return { wrappedKey: row.wrapped_key, chunkCount: row.chunk_count, sizeBytes: row.size_bytes };
  }

  async createAttachment(id: string, attachment: RemoteAttachment): Promise<boolean> {
    const reply = await this.rest('POST', '/attachments', {
      id,
      wrapped_key: attachment.wrappedKey,
      chunk_count: attachment.chunkCount,
      size_bytes: attachment.sizeBytes,
    });
    if (reply.status === 201) return true;
    if (reply.status === 409) return false;
    const body = (reply.body ?? {}) as Json;
    if (typeof body.message === 'string' && body.message.includes('storage_quota_exceeded')) {
      throw new QuotaExceededError('Quota de stockage atteint');
    }
    SupabaseRemote.fail(reply);
  }

  async putChunk(id: string, index: number, data: Uint8Array): Promise<void> {
    const path = await this.chunkPath(id, index);
    const reply = await this.authed('POST', `/storage/v1/object/${BUCKET}/${path}`, data);
    if (reply.status === 200) return;
    const code = SupabaseRemote.storageCode(reply);
    // Bloc déjà envoyé lors d'une tentative précédente.
    if (code === 409) return;
    if (code === 403) {
      // Refus par la politique du bucket : le quota est atteint, sauf autre cause.
      const usage = await this.getUsage();
      if (usage && usage.usedBytes >= usage.quotaBytes) {
        throw new QuotaExceededError('Quota de stockage atteint');
      }
    }
    SupabaseRemote.failStorage(reply);
  }

  async getChunk(id: string, index: number): Promise<Uint8Array | null> {
    const path = await this.chunkPath(id, index);
    const reply = await this.authed(
      'GET',
      `/storage/v1/object/authenticated/${BUCKET}/${path}`,
      undefined,
      undefined,
      true,
    );
    if (reply.status === 200 && reply.bytes) return reply.bytes;
    // Bloc pas encore déposé : l'envoi par l'autre appareil est en cours.
    if (SupabaseRemote.storageCode(reply) === 404) return null;
    SupabaseRemote.failStorage(reply);
  }

  async deleteAttachment(id: string): Promise<void> {
    // Les blocs d'abord : tant que la ligne existe, un ménage interrompu se reprend.
    const attachment = await this.getAttachment(id);
    if (!attachment) return;
    const prefix = (await this.chunkPath(id, 0)).slice(0, -1);
    for (let start = 0; start < attachment.chunkCount; start += DELETE_BATCH) {
      const count = Math.min(DELETE_BATCH, attachment.chunkCount - start);
      const reply = await this.authed('DELETE', `/storage/v1/object/${BUCKET}`, {
        prefixes: Array.from({ length: count }, (_, offset) => `${prefix}${start + offset}`),
      });
      if (reply.status !== 200) SupabaseRemote.failStorage(reply);
    }
    const reply = await this.rest('DELETE', `/attachments?id=eq.${id}`);
    if (reply.status !== 204 && reply.status !== 200) SupabaseRemote.fail(reply);
  }

  // --- Partage par lien -----------------------------------------------------

  /**
   * Dépose la copie chiffrée d'une note, lisible par qui connaît `id`.
   * @throws QuotaExceededError si le quota du compte ne suffit pas.
   */
  async createShare(id: string, ciphertext: string, meta: string): Promise<void> {
    const reply = await this.rest('POST', '/shared_notes', { id, ciphertext, meta });
    if (reply.status === 201) return;
    if (reply.status === 409) {
      // Ce partage existe déjà. Un identifiant neuf (aléatoire) n'entre jamais
      // en conflit : c'est un transfert repris après interruption… à condition
      // que la ligne soit bien la nôtre (la lecture ne renvoie que les lignes
      // du compte). Sinon, quelqu'un qui connaissait le lien l'a pris.
      if ((await this.getShareCiphertext(id)) === ciphertext) return;
      throw new ShareTakenError();
    }
    const body = (reply.body ?? {}) as Json;
    if (typeof body.message === 'string' && body.message.includes('storage_quota_exceeded')) {
      throw new QuotaExceededError('Quota de stockage atteint');
    }
    // Identifiant d'un lien révoqué : il ne peut plus resservir (voir la
    // migration « share_tombstones »). Un identifiant neuf n'y tombe jamais.
    if (typeof body.message === 'string' && body.message.includes('share_id_revoked')) {
      throw new ShareTakenError();
    }
    SupabaseRemote.fail(reply);
  }

  /** Identifiant, sur l'instance, du compte connecté. */
  async accountUserId(): Promise<string> {
    await this.ensureSession();
    const userId = this.session?.userId;
    if (!userId) throw new SyncError("L'instance n'a pas indiqué l'identifiant du compte.");
    return userId;
  }

  /** Accepte de recevoir les liens de partage du compte `predecessor` (voir `transferShare`). */
  async acceptSharesFrom(predecessor: string): Promise<void> {
    const reply = await this.rest('POST', '/rpc/accept_shares_from', { predecessor });
    if (reply.status === 204 || reply.status === 200) return;
    if (reply.status === 404) SupabaseRemote.failOutdated('transfert des liens absent');
    SupabaseRemote.fail(reply);
  }

  /**
   * Passe un partage de ce compte au compte `successor`, en une seule
   * transaction : le lien ne cesse jamais d'exister, personne ne peut en
   * prendre l'identifiant. Le successeur doit l'avoir accepté (`acceptSharesFrom`).
   * @param meta Métadonnées du partage, rechiffrées pour le successeur.
   * @returns `false` si ce compte n'a plus ce partage.
   * @throws QuotaExceededError si le quota du successeur ne suffit pas.
   */
  async transferShare(id: string, successor: string, meta: string): Promise<boolean> {
    const reply = await this.rest('POST', '/rpc/transfer_share', {
      share_id: id,
      successor,
      new_meta: meta,
    });
    if (reply.status === 200) return reply.body === true;
    const message = ((reply.body ?? {}) as Json).message;
    if (typeof message === 'string' && message.includes('storage_quota_exceeded')) {
      throw new QuotaExceededError('Quota de stockage atteint');
    }
    if (reply.status === 404) SupabaseRemote.failOutdated('transfert des liens absent');
    SupabaseRemote.fail(reply);
  }

  /** Partages du compte, du plus récent au plus ancien. */
  async listShares(): Promise<RemoteShare[]> {
    const reply = await this.rest(
      'GET',
      '/shared_notes?select=id,meta,created_at&order=created_at.desc&limit=1000',
    );
    if (reply.status !== 200 || !Array.isArray(reply.body)) SupabaseRemote.fail(reply);
    const shares: RemoteShare[] = [];
    for (const row of reply.body as Json[]) {
      if (typeof row.id !== 'string' || typeof row.meta !== 'string') continue;
      const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
      shares.push({ id: row.id, meta: row.meta, createdAt: Number.isNaN(createdAt) ? 0 : createdAt });
    }
    return shares;
  }

  /** Révoque un lien : sa copie disparaît du serveur. */
  async deleteShare(id: string): Promise<void> {
    const reply = await this.rest('DELETE', `/shared_notes?id=eq.${id}`);
    if (reply.status !== 204 && reply.status !== 200) SupabaseRemote.fail(reply);
  }

  /** Copie chiffrée d'un partage du compte ; `null` s'il n'existe plus. */
  async getShareCiphertext(id: string): Promise<string | null> {
    const reply = await this.rest('GET', `/shared_notes?id=eq.${id}&select=ciphertext`);
    if (reply.status !== 200 || !Array.isArray(reply.body)) SupabaseRemote.fail(reply);
    const row = reply.body[0] as Json | undefined;
    return typeof row?.ciphertext === 'string' ? row.ciphertext : null;
  }

  // --- Fermeture du compte ---------------------------------------------------

  /**
   * Le compte de la session ouverte est-il fermé ? Lu sans passer par
   * `authed` : appelé depuis `signIn`, il ne doit pas en relancer un.
   * Une instance sans la migration de fermeture répond « non ».
   */
  private async isClosed(): Promise<boolean> {
    const reply = await this.send('GET', '/rest/v1/profiles?select=closed_at', undefined, {
      Authorization: `Bearer ${this.session?.token}`,
    });
    const row = Array.isArray(reply.body) ? (reply.body[0] as Json | undefined) : undefined;
    return reply.status === 200 && typeof row?.closed_at === 'string';
  }

  /**
   * Vide et ferme le compte (notes, fichiers, partages). Les blocs des
   * fichiers doivent avoir été supprimés avant (`deleteAttachment`).
   * Sans effet sur un compte déjà fermé.
   */
  async closeAccount(): Promise<void> {
    const reply = await this.rest('POST', '/rpc/close_account', {});
    if (reply.status === 204 || reply.status === 200) return;
    const message = ((reply.body ?? {}) as Json).message;
    if (typeof message === 'string' && message.includes('attachments_remaining')) {
      throw new SyncError("Des fichiers de l'ancien compte restent sur le serveur : réessayez.");
    }
    if (reply.status === 404) {
      throw new SyncError(
        "L'instance n'est pas à jour pour Secure Notes (fermeture de compte absente) : appliquez les migrations du dossier supabase/migrations.",
      );
    }
    SupabaseRemote.fail(reply);
  }

  async getUsage(): Promise<StorageUsage | null> {
    const reply = await this.rest('GET', '/profiles?select=storage_quota_bytes,storage_used_bytes');
    const row = Array.isArray(reply.body) ? (reply.body[0] as Json | undefined) : undefined;
    if (
      reply.status !== 200 ||
      typeof row?.storage_quota_bytes !== 'number' ||
      typeof row.storage_used_bytes !== 'number'
    ) {
      return null;
    }
    return { usedBytes: row.storage_used_bytes, quotaBytes: row.storage_quota_bytes };
  }
}

/** Plus longue réponse admise : une copie de `shared_notes` (8 000 000 caractères) en JSON. */
const MAX_SHARED_REPLY_CHARS = 8_000_016;

/**
 * Lit la copie chiffrée d'une note partagée, sans compte.
 * @returns `null` si le lien n'existe pas ou a été révoqué.
 * @throws SyncError si l'instance est injoignable ou refuse la requête.
 */
export async function fetchSharedNote(
  instance: SyncInstance,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status: number;
  let text: string;
  try {
    const response = await fetchImpl(`${instance.url}/rest/v1/rpc/get_shared_note`, {
      method: 'POST',
      headers: { apikey: instance.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ share_id: id }),
      signal: controller.signal,
    });
    status = response.status;
    // L'instance peut être celle de l'auteur du lien : ne pas la croire sur la
    // taille. Annoncée trop grande, la réponse n'est pas lue du tout.
    if (Number(response.headers?.get('content-length') ?? 0) > MAX_SHARED_REPLY_CHARS) {
      controller.abort();
      throw new SyncError('Réponse du serveur trop volumineuse.');
    }
    text = await response.text();
  } catch (cause) {
    if (cause instanceof SyncError) throw cause;
    throw new SyncError('Serveur injoignable : vérifiez votre connexion.');
  } finally {
    clearTimeout(timer);
  }
  if (text.length > MAX_SHARED_REPLY_CHARS) {
    throw new SyncError('Réponse du serveur trop volumineuse.');
  }
  if (status === 404) {
    throw new SyncError("Ce serveur ne propose pas le partage de notes (instance pas à jour).");
  }
  if (status !== 200) throw new SyncError(`Le serveur a refusé la lecture (${status}).`);
  try {
    const body: unknown = text === '' ? null : JSON.parse(text);
    return typeof body === 'string' && body !== '' ? body : null;
  } catch {
    throw new SyncError('Réponse du serveur inattendue.');
  }
}
