/**
 * Lien en attente d'envoi par QR code, entre l'écran de partage et l'écran
 * de scan. Gardé en mémoire seulement : le lien contient la clé de la note,
 * il ne passe ni par les paramètres de navigation ni par le stockage.
 */

export type OutgoingLink = { id: string; fragment: string; title: string };

let pending: OutgoingLink | null = null;

export function setOutgoingLink(link: OutgoingLink): void {
  pending = link;
}

export function peekOutgoingLink(): OutgoingLink | null {
  return pending;
}

/** À la fermeture de l'écran de scan. */
export function clearOutgoingLink(): void {
  pending = null;
}
