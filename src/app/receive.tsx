import { Stack, useRouter } from 'expo-router';
import { QrCode as QrIcon, RefreshCw } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { QrCode } from '@/components/qr-code';
import { Screen } from '@/components/screen';
import { ScreenCaptureGuard } from '@/components/screen-capture-guard';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { cryptoReady } from '@/crypto/aead';
import { defaultInstance, hostOf, isDefaultInstance } from '@/share/config';
import {
  createReceiver,
  HANDOFF_POLL_MS,
  HandoffError,
  openHandoff,
  takeHandoff,
  wipeReceiver,
  type HandoffReceiver,
} from '@/share/handoff';
import type { ShareInstance } from '@/share/link';
import { useSync } from '@/sync/sync-context';

/**
 * Réception d'une note par QR code (`/receive`) : affiche un code que l'app
 * d'un autre appareil scanne depuis l'écran de partage d'une note, relève le
 * lien déposé, puis ouvre la note (`/s/<id>`).
 *
 * Les secrets du code ne vivent qu'en mémoire, le temps de cet écran ; il est
 * protégé des captures d'écran.
 */

type Phase =
  | { name: 'starting' }
  | { name: 'consent' }
  | { name: 'waiting'; text: string; remaining: number; warning: string | null }
  | { name: 'expired' }
  | { name: 'failed'; message: string };

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function ReceiveScreen() {
  const router = useRouter();
  const { config } = useSync();
  // L'app ne contacte aucun serveur sans la synchronisation : sans elle, on
  // demande avant de relever sur le serveur par défaut.
  const instance: ShareInstance | null = config.enabled
    ? { url: config.url, anonKey: config.anonKey }
    : defaultInstance();
  const [phase, setPhase] = useState<Phase>(config.enabled ? { name: 'starting' } : { name: 'consent' });
  /**
   * Numéro du code affiché : 0 tant que l'utilisateur n'a pas accepté de
   * contacter le serveur. Synchronisation active, le code s'affiche aussitôt.
   */
  const [session, setSession] = useState(config.enabled ? 1 : 0);
  const url = instance?.url ?? null;
  const anonKey = instance?.anonKey ?? null;

  useEffect(() => {
    if (session === 0 || url === null || anonKey === null) return;
    let alive = true;
    let receiver: HandoffReceiver | null = null;
    const discard = () => {
      if (receiver) wipeReceiver(receiver);
      receiver = null;
    };
    void (async () => {
      await cryptoReady();
      if (!alive) return;
      const fresh = createReceiver(isDefaultInstance(url) ? null : url, Date.now());
      receiver = fresh;
      let warning: string | null = null;
      while (alive) {
        const left = fresh.expiresAt - Date.now();
        if (left <= 0) {
          discard();
          setPhase({ name: 'expired' });
          return;
        }
        setPhase({ name: 'waiting', text: fresh.text, remaining: left, warning });
        let payload: string | null = null;
        try {
          payload = await takeHandoff({ url, anonKey }, fresh.channel);
          warning = null;
        } catch (cause) {
          // Passager (réseau) : on réessaie jusqu'à l'expiration du code.
          warning = cause instanceof HandoffError ? cause.message : 'Relève impossible.';
        }
        if (!alive) return;
        if (payload !== null) {
          try {
            const message = openHandoff(fresh, payload);
            discard();
            router.replace({
              pathname: '/s/[id]',
              params: { id: message.id, '#': message.fragment },
            });
          } catch (cause) {
            discard();
            setPhase({
              name: 'failed',
              message: `${cause instanceof HandoffError ? cause.message : 'Message illisible.'} Affichez un nouveau code et scannez-le à nouveau.`,
            });
          }
          return;
        }
        await new Promise((done) => setTimeout(done, HANDOFF_POLL_MS));
      }
    })();
    return () => {
      alive = false;
      discard();
    };
  }, [session, url, anonKey, router]);

  const start = () => setSession((previous) => previous + 1);

  if (!instance) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Recevoir une note' }} />
        <Notice tone="info" title="Aucun serveur">
          Activez la synchronisation dans les réglages pour recevoir des notes par QR code.
        </Notice>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        phase.name === 'consent' ? (
          <Button label="Afficher le code" variant="primary" icon={QrIcon} onPress={start} />
        ) : phase.name === 'expired' || phase.name === 'failed' ? (
          <Button label="Nouveau code" variant="primary" icon={RefreshCw} onPress={start} />
        ) : undefined
      }>
      <Stack.Screen options={{ title: 'Recevoir une note' }} />
      {phase.name === 'waiting' && <ScreenCaptureGuard />}

      {phase.name === 'consent' && (
        <Notice tone="info" title="Contacter le serveur ?">
          {`Pour recevoir le lien, l’app le relèvera sur ${hostOf(instance.url)}. Ce serveur verra votre adresse IP, mais jamais le lien ni la note.`}
        </Notice>
      )}

      {phase.name === 'waiting' && (
        <View style={styles.qr}>
          <QrCode value={phase.text} label="QR code de réception" />
          <ThemedText type="callout" themeColor="inkMuted" style={styles.center}>
            {`En attente de l’autre appareil · expire dans ${clock(phase.remaining)}`}
          </ThemedText>
        </View>
      )}

      {phase.name === 'expired' && (
        <Notice tone="info" title="Code expiré">
          Un code ne sert qu’une fois et pendant 5 minutes.
        </Notice>
      )}

      {phase.name === 'failed' && (
        <Notice tone="danger" title="Lien refusé">
          {phase.message}
        </Notice>
      )}

      {phase.name === 'waiting' && phase.warning && <Notice tone="warning">{phase.warning}</Notice>}

      <View style={styles.steps}>
        <ThemedText type="section" themeColor="inkMuted">
          Sur l’autre appareil
        </ThemedText>
        <ThemedText>1. Ouvrez la note dans Secure Notes, puis touchez Partager.</ThemedText>
        <ThemedText>2. Sur l’un de ses liens, touchez « QR code ».</ThemedText>
        <ThemedText>3. Scannez ce code : la note s’ouvre ici.</ThemedText>
      </View>

      <Notice tone="secure" title="Chiffré de bout en bout">
        Le lien arrive chiffré pour cet écran seulement : le serveur qui le transmet ne peut pas le
        lire. Ne montrez ce code qu’à l’appareil qui envoie.
      </Notice>
    </Screen>
  );
}

const styles = StyleSheet.create({
  qr: { gap: Spacing.three, alignItems: 'center' },
  steps: { gap: Spacing.one },
  center: { textAlign: 'center' },
});
