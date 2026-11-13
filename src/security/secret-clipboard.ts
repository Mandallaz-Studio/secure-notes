import * as Clipboard from 'expo-clipboard';
import { AppState } from 'react-native';

/**
 * Copie temporaire d'un secret (la phrase de récupération) dans le
 * presse-papiers.
 *
 * - iOS : le système efface lui-même le contenu à l'échéance et ne le partage
 *   pas avec les autres appareils de l'utilisateur.
 * - Android : le contenu est marqué « sensible » (pas d'aperçu à l'écran ni
 *   dans le clavier) et l'app l'efface à l'échéance.
 *
 * Android n'autorise la lecture du presse-papiers qu'à l'app au premier plan.
 * Si l'échéance tombe pendant que l'app est en arrière-plan, l'effacement a
 * donc lieu au retour dans l'app. On n'efface que si le presse-papiers contient
 * encore le secret, pour ne pas détruire ce que l'utilisateur a copié depuis.
 */

export const SECRET_CLIPBOARD_SECONDS = 60;

let pending: { secret: string; expiresAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

async function clearIfDue(): Promise<void> {
  if (!pending || Date.now() < pending.expiresAt) return;
  if (AppState.currentState !== 'active') return; // Réessayé au retour dans l'app.
  const { secret } = pending;
  try {
    if ((await Clipboard.getStringAsync()) === secret) {
      await Clipboard.setStringAsync('');
    }
    pending = null;
  } catch {
    // Lecture refusée (app pas encore au premier plan) : on réessaiera.
  }
}

function listenForReturn(): void {
  if (listening) return;
  listening = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void clearIfDue();
    }
  });
}

/** Copie `secret` et programme son effacement. */
export async function copySecret(secret: string): Promise<void> {
  const expiresAt = Date.now() + SECRET_CLIPBOARD_SECONDS * 1000;
  await Clipboard.setStringAsync(secret, {
    android: { isSensitive: true },
    ios: { localOnly: true, expiresAt: new Date(expiresAt) },
  });
  pending = { secret, expiresAt };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void clearIfDue(), SECRET_CLIPBOARD_SECONDS * 1000);
  listenForReturn();
}

/**
 * Efface immédiatement le presse-papiers s'il contient `secret`, par exemple
 * une phrase que l'utilisateur vient de coller pour restaurer son coffre.
 */
export async function clearClipboardIfContains(secret: string): Promise<void> {
  try {
    const content = await Clipboard.getStringAsync();
    if (content.trim() !== '' && content.trim() === secret.trim()) {
      await Clipboard.setStringAsync('');
    }
  } catch {
    // Presse-papiers inaccessible : rien à effacer de notre côté.
  }
  if (pending?.secret.trim() === secret.trim()) {
    pending = null;
  }
}
