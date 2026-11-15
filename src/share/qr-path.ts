import { toQR } from 'toqr';

/**
 * Tracé SVG d'un QR code (un carré par module noir), pour l'app comme pour
 * l'extension. `size` est le côté en modules, marge non comprise.
 */
export function qrPath(text: string): { size: number; d: string } {
  const modules = toQR(text);
  const size = Math.round(Math.sqrt(modules.length));
  let d = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, d };
}

/** Marge blanche autour du QR code, en modules (4 selon la norme). */
export const QR_QUIET_ZONE = 4;
