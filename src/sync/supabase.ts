import { fromBase64, keyedHash, toBase64 } from '@/crypto/aead';
import type { VaultKeys } from '@/crypto/keys';
import type { RemoteRow, SyncRemote } from '@/sync/engine';

/**
 * Accès à une instance Supabase, directement par ses API HTTP (Auth et
 * PostgREST) : trois requêtes suffisent, sans bibliothèque tierce.
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

type Reply = { status: number; body: unknown };

export class SupabaseRemote implements SyncRemote {
  readonly instanceId: string;
  private session: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly instance: SyncInstance,
    private readonly credentials: SyncCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.instanceId = instance.url;
  }

  private async send(method: string, path: string, body?: Json, headers?: Json): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(`${this.instance.url}${path}`, {
        method,
        headers: {
          apikey: this.instance.anonKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        } as Record<string, string>,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      text = await response.text();
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
    return { status: response.status, body: parsed };
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
    this.session = { token: body.access_token, expiresAt: Date.now() + lifetime * 1000 };
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

  /** Requête authentifiée vers PostgREST ; rouvre la session si elle a expiré. */
  private async rest(method: string, path: string, body?: Json, prefer?: string): Promise<Reply> {
    for (let attempt = 0; ; attempt += 1) {
      if (!this.session || this.session.expiresAt - TOKEN_MARGIN_MS < Date.now()) {
        await this.signIn();
      }
      const reply = await this.send(method, `/rest/v1${path}`, body, {
        Authorization: `Bearer ${this.session?.token}`,
        ...(prefer ? { Prefer: prefer } : {}),
      });
      if (reply.status === 401 && attempt === 0) {
        this.session = null;
        continue;
      }
      return reply;
    }
  }

  private static fail(reply: Reply): never {
    if (reply.status === 404) {
      throw new SyncError(
        "L'instance n'est pas préparée pour Secure Notes (table « items » absente) : appliquez les migrations du dossier supabase/migrations.",
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
}
