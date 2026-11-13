const DAY_MS = 24 * 60 * 60 * 1000;

/** Heure si la date est d'aujourd'hui, sinon jour et mois (et année si différente). */
export function formatNoteDate(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const sameDay =
    Math.abs(now - timestamp) < DAY_MS &&
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth();
  if (sameDay) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}
