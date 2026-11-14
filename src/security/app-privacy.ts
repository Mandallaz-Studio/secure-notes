import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

import { getPref, setPref } from '@/storage/prefs';

/**
 * « Masquer dans les apps récentes » : le contenu de l'app n'apparaît ni dans
 * l'aperçu du sélecteur d'apps, ni sur les captures et enregistrements d'écran.
 *
 * - Android : drapeau `FLAG_SECURE` sur la fenêtre (aperçu vide, captures
 *   refusées par le système).
 * - iOS : captures et enregistrements bloqués, et voile flouté sur l'aperçu du
 *   sélecteur d'apps.
 *
 * Désactivé par défaut. Les écrans de la phrase de récupération bloquent les
 * captures dans tous les cas (`ScreenCaptureGuard`) : leurs clés de blocage
 * sont distinctes, l'une ne lève pas l'autre.
 */

const PREF = 'privacy.hide-in-recents';
/** Clé de blocage propre à ce réglage (voir `preventScreenCaptureAsync`). */
const CAPTURE_KEY = 'app-privacy';

export const appPrivacySupported = Platform.OS === 'android' || Platform.OS === 'ios';

export function getHideInRecents(): boolean {
  return getPref(PREF) === '1';
}

async function apply(enabled: boolean): Promise<void> {
  if (!appPrivacySupported) return;
  if (enabled) {
    await ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY);
    if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync();
  } else {
    await ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY);
    if (Platform.OS === 'ios') await ScreenCapture.disableAppSwitcherProtectionAsync();
  }
}

/** À appeler une fois au démarrage : rétablit le réglage enregistré. */
export function applySavedAppPrivacy(): void {
  if (getHideInRecents()) void apply(true).catch(() => {});
}

/** @throws si le système refuse de changer la protection. */
export async function setHideInRecents(enabled: boolean): Promise<void> {
  await apply(enabled);
  setPref(PREF, enabled ? '1' : '0');
}
