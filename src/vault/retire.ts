import { openShareMeta, sealShareMeta } from '@/share/codec';
import type { NoteStore } from '@/notes/types';
import { QuotaExceededError } from '@/sync/blobs';
import { ShareTakenError, type SupabaseRemote, type SyncInstance } from '@/sync/supabase';

/**
 * Retrait de l'ancien coffre, après « Recréer le coffre ».
 *
 * Le nouveau coffre est déjà actif ; il reste à effacer l'ancienne base de cet
 * appareil, puis, si l'ancien compte était synchronisé, à le vider et le
 * fermer sur le serveur. Ses liens de partage passent au nouveau compte sous
 * le même identifiant (ils continuent de fonctionner), si celui-ci est
 * synchronisé sur la même instance ; sinon ils sont révoqués.
 *
 * Les destinataires d'un lien en connaissent l'identifiant et la clé : entre
 * la suppression d'un partage par l'ancien compte et sa recréation par le
 * nouveau, l'un d'eux pourrait déposer sa propre copie sous cet identifiant.
 * Chaque partage est donc transféré seul, suppression puis recréation
 * aussitôt, avant de fermer l'ancien compte ; un identifiant pris entre-temps
 * est détecté (`ShareTakenError`) et signalé.
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
  | 'listShares'
  | 'getShareCiphertext'
  | 'deleteShare'
  | 'listAttachmentIds'
  | 'deleteAttachment'
  | 'closeAccount'
>;
type NewRemote = Pick<SupabaseRemote, 'createShare'>;

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
  /** Liens dont l'identifiant a été pris par un autre compte pendant le transfert. */
  sharesTaken: number;
};

type PendingShare = { id: string; ciphertext: string; meta: string };

/**
 * Clé, dans l'état de synchronisation du nouveau coffre, des partages à recréer.
 * Un changement d'instance efface cet état (`resetSync`) : changer d'instance
 * pendant le retrait révoque donc les liens pas encore repris.
 */
export const PENDING_SHARES = 'retire.shares';

export async function retireVault(deps: RetireDeps): Promise<RetireReport> {
  const report: RetireReport = { sharesMoved: 0, sharesRevoked: 0, sharesTaken: 0 };
  await deps.deleteOldDatabase();
  const old = deps.oldRemote;
  if (!old) return report;

  // 1. Mettre de côté les partages à transférer, avant que la fermeture ne
  //    les supprime. Déjà fait lors d'un essai précédent : on reprend la liste.
  const saved = await deps.store.getSyncValue(PENDING_SHARES);
  let pending: PendingShare[];
  if (saved !== null) {
    pending = JSON.parse(saved) as PendingShare[];
  } else {
    pending = [];
    for (const share of await old.listShares()) {
      const meta = openShareMeta(share.id, share.meta, deps.oldWrapKey);
      const ciphertext = deps.newRemote && meta ? await old.getShareCiphertext(share.id) : null;
      if (meta && ciphertext) {
        pending.push({
          id: share.id,
          ciphertext,
          meta: sealShareMeta(share.id, meta, deps.newWrapKey),
        });
      } else {
        report.sharesRevoked += 1;
      }
    }
    await deps.store.setSyncValue(PENDING_SHARES, JSON.stringify(pending));
  }

  // 2. Transférer les partages un par un, tant que l'ancien compte est ouvert.
  if (deps.newRemote) {
    while (pending.length > 0) {
      const share = pending[0];
      // Sans effet si l'ancien compte l'a déjà supprimé (reprise après interruption).
      await old.deleteShare(share.id);
      try {
        await deps.newRemote.createShare(share.id, share.ciphertext, share.meta);
        report.sharesMoved += 1;
      } catch (cause) {
        if (cause instanceof ShareTakenError) report.sharesTaken += 1;
        else if (cause instanceof QuotaExceededError) report.sharesRevoked += 1;
        else throw cause;
      }
      pending = pending.slice(1);
      await deps.store.setSyncValue(PENDING_SHARES, JSON.stringify(pending));
    }
  } else {
    // Révoqués par la fermeture du compte.
    report.sharesRevoked += pending.length;
  }

  // 3. Supprimer les fichiers (blocs du bucket, puis lignes), puis fermer le compte.
  for (const id of await old.listAttachmentIds()) await old.deleteAttachment(id);
  await old.closeAccount();
  await deps.store.setSyncValue(PENDING_SHARES, '[]');
  return report;
}
