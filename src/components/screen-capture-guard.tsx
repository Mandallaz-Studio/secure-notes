import { usePreventScreenCapture } from 'expo-screen-capture';

/** Bloque captures et enregistrements d'écran tant que ce composant est monté. */
export function ScreenCaptureGuard() {
  usePreventScreenCapture();
  return null;
}
