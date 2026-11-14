import { openShareMeta, sealShareMeta } from '@/share/codec';
import type { NoteStore } from '@/notes/types';
import { QuotaExceededError } from '@/sync/blobs';
import type { SupabaseRemote, SyncInstance } from '@/sync/supabase';

/**
 * Retrait de l'ancien coffre, après « Recréer le coffre ».
 *
 * Le nouveau coffre est déjà actif ; il reste à effacer l'ancienne base de cet
 * appareil, puis, si l'ancien compte était synchronisé, à le vider et le
 * fermer sur le serveur. Ses liens de partage passent au nouveau compte sous
 * le même identifiant (ils continuent de fonctionner), si celui-ci est
 * synchronisé sur la même instance ; sinon ils sont révoqués.
 *
 * Les destinataires d'un lien en connaissent l'identifiant et la clé : si le
 * lien cessait d'exister, même un instant, l'un d'eux pourrait déposer sa
 * propre copie sous cet identifiant. Le serveur change donc le propriétaire
 * de chaque partage en une seule transaction (`transferShare`), avec l'accord
 * du nouveau compte, avant de fermer l'ancien. Un lien qui n'a pas pu passer
 * (quota) est révoqué : son identifiant ne peut plus resservir.
 *
 * Chaque étape peut être rejouée : une interruption (réseau, app fermée) se
 * reprend au prochain essai.
 */

/** Ce qu'il faut garder, jusqu'au bout du retrait, de l'ancien coffre. */
export type RetiringVault = {
  /** Compte à retirer. */
  accountId: string;
  /** Compte qui le remplace : il doit être le coffre actif pour que le retrait ait lieu. */
  successorId: string;
  /** Clé maîtresse de l'ancien coffre, en hexadécimal. */
  masterKey: string;
  /** Instance où l'ancien compte était synchronisé ; `null` : jamais envoyé. */
  instance: SyncInstance | null;
};

export function parseRetiring(raw: string): RetiringVault | null {
  try {
    const value = JSON.parse(raw) as Partial<RetiringVault>;
    const instance = value.instance;
    if (
      typeof value.accountId === 'string' &&
      typeof value.successorId === 'string' &&
      typeof value.masterKey === 'string' &&
      /^[0-9a-f]{64}$/.test(value.masterKey) &&
      (instance === null ||
        (typeof instance?.url === 'string' && typeof instance.anonKey === 'string'))
    ) {
      return value as RetiringVault;
    }
  } catch {
    // Illisible : traité comme absent.
  }
  return null;
}

type OldRemote = Pick<
  SupabaseRemote,
  | 'accountUserId'
  | 'listShares'
  | 'transferShare'
  | 'deleteShare'
  | 'listAttachmentIds'
  | 'deleteAttachment'
  | 'closeAccount'
>;
type NewRemote = Pick<SupabaseRemote, 'accountUserId' | 'acceptSharesFrom'>;

export type RetireDeps = {
  /** Efface la base de l'ancien coffre sur cet appareil. */
  deleteOldDatabase: () => Promise<void>;
  /** Ancien compte (connexion acceptée même fermé) ; `null` s'il n'a jamais été synchronisé. */
  oldRemote: OldRemote | null;
  oldWrapKey: Uint8Array;
  /** Nouveau compte, s'il est synchronisé sur la même instance que l'ancien. */
  newRemote: NewRemote | null;
  newWrapKey: Uint8Array;
  /** Base du nouveau coffre : y garde les partages en cours de transfert. */
  store: Pick<NoteStore, 'getSyncValue' | 'setSyncValue'>;
};

export type RetireReport = {
  /** Liens passés au nouveau compte. */
  sharesMoved: number;
  /** Liens révoqués (nouveau compte non synchronisé, ou quota atteint). */
  sharesRevoked: number;
};

/** `meta` : métadonnées rechiffrées pour le nouveau compte. */
type PendingShare = { id: string; meta: string };

/**
 * Clé, dans l'état de synchronisation du nouveau coffre, des partages à recréer.
 * Un changement d'instance efface cet état (`resetSync`) : changer d'instance
 * pendant le retrait révoque donc les liens pas encore repris.
 */
export const PENDING_SHARES = 'retire.shares';

export async function retireVault(deps: RetireDeps): Promise<RetireReport> {
  const report: RetireReport = { sharesMoved: 0, sharesRevoked: 0 };
  await deps.deleteOldDatabase();
  const old = deps.oldRemote;
  if (!old) return report;

  const saved = await deps.store.getSyncValue(PENDING_SHARES);
  let pending: PendingShare[];
  if (saved !== null) {
    pending = JSON.parse(saved) as PendingShare[];
  } else {
    pending = [];
    for (const share of await old.listShares()) {
      const meta = deps.newRemote ? openShareMeta(share.id, share.meta, deps.oldWrapKey) : null;
      if (meta) {
        pending.push({ id: share.id, meta: sealShareMeta(share.id, meta, deps.newWrapKey) });
      } else {
        report.sharesRevoked += 1;
      }
    }
    await deps.store.setSyncValue(PENDING_SHARES, JSON.stringify(pending));
  }

  if (deps.newRemote && pending.length > 0) {
    const successor = await deps.newRemote.accountUserId();
    await deps.newRemote.acceptSharesFrom(await old.accountUserId());
    while (pending.length > 0) {
      const share = pending[0];
      try {
        if (await old.transferShare(share.id, successor, share.meta)) report.sharesMoved += 1;
        else report.sharesRevoked += 1;
      } catch (cause) {
        if (!(cause instanceof QuotaExceededError)) throw cause;
        await old.deleteShare(share.id);
        report.sharesRevoked += 1;
      }
      pending = pending.slice(1);
      await deps.store.setSyncValue(PENDING_SHARES, JSON.stringify(pending));
    }
  } else {
    // Supprimés avec le compte par close_account().
    report.sharesRevoked += pending.length;
  }

  for (const id of await old.listAttachmentIds()) await old.deleteAttachment(id);
  await old.closeAccount();
  await deps.store.setSyncValue(PENDING_SHARES, '[]');
  return report;
}
