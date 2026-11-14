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

type Reply = { status: number; body: unknown; bytes?: Uint8Array };

/** Bucket Storage privé des blocs chiffrés (voir la migration « attachments »). */
const BUCKET = 'attachments';
/** Nombre d'objets supprimés par requête. */
const DELETE_BATCH = 100;

export class SupabaseRemote implements SyncRemote, BlobRemote {
  readonly instanceId: string;
  private session: { token: string; expiresAt: number; userId: string | null } | null = null;

  constructor(
    private readonly instance: SyncInstance,
    private readonly credentials: SyncCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
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
    if (this.adopt(login)) return;
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

  private static fail(reply: Reply): never {
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
