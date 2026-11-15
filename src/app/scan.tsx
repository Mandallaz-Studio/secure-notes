import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import { Check, ScanQrCode } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { defaultInstance, hostOf, sameInstanceUrl } from '@/share/config';
import { HandoffError, parseOffer, sealHandoff, type HandoffOffer } from '@/share/handoff';
import { clearOutgoingLink, peekOutgoingLink } from '@/share/outbox';
import { useSync } from '@/sync/sync-context';
import { SyncError } from '@/sync/supabase';

/**
 * Envoi d'un lien de partage par QR code (`/scan`, depuis l'écran de
 * partage) : scanne le code de réception affiché par l'extension de
 * navigateur ou par une autre app, et y dépose le lien, chiffré pour lui.
 */

type Phase =
  | { name: 'scanning'; hint: string | null }
  | { name: 'sending' }
  | { name: 'sent'; host: string }
  | { name: 'failed'; message: string };

export default function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { remote, config } = useSync();
  const [permission, requestPermission] = useCameraPermissions();
  const [link] = useState(peekOutgoingLink);
  const [phase, setPhase] = useState<Phase>({ name: 'scanning', hint: null });
  const busy = useRef(false);
  const lastRejected = useRef<string | null>(null);

  // Le lien ne reste en mémoire que le temps de cet écran.
  useEffect(() => clearOutgoingLink, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  if (!link) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Envoyer par QR code' }} />
        <Notice tone="info" title="Aucun lien à envoyer">
          Revenez à l’écran de partage de la note et touchez « QR code » sur l’un de ses liens.
        </Notice>
      </Screen>
    );
  }

  const send = async (offer: HandoffOffer) => {
    try {
      // Le dépôt se fait avec le compte de synchronisation : il doit être sur
      // l'instance où l'afficheur relèvera.
      const target = offer.instanceUrl ?? defaultInstance()?.url ?? null;
      if (!remote) {
        throw new HandoffError('Activez la synchronisation pour envoyer par QR code.');
      }
      if (target === null || !sameInstanceUrl(target, config.url)) {
        throw new HandoffError(
          `Ce code attend le lien sur ${target ? hostOf(target) : 'un serveur inconnu'}, mais ce coffre se synchronise sur ${hostOf(config.url)}. Réglez l’extension ou l’autre app sur le même serveur.`,
        );
      }
      const { channel, payload } = sealHandoff(offer, { id: link.id, fragment: link.fragment });
      await remote.createHandoff(channel, payload);
      setPhase({ name: 'sent', host: hostOf(target) });
    } catch (cause) {
      setPhase({
        name: 'failed',
        message:
          cause instanceof HandoffError || cause instanceof SyncError
            ? cause.message
            : `Envoi impossible : ${String(cause)}`,
      });
    } finally {
      offer.secret.fill(0);
    }
  };

  const onScanned = (result: BarcodeScanningResult) => {
    if (busy.current || result.data === lastRejected.current) return;
    const offer = parseOffer(result.data);
    if (!offer) {
      lastRejected.current = result.data;
      setPhase({
        name: 'scanning',
        hint: 'Ce QR code n’est pas un code de réception Secure Notes.',
      });
      return;
    }
    busy.current = true;
    setPhase({ name: 'sending' });
    void send(offer);
  };

  const retry = () => {
    busy.current = false;
    lastRejected.current = null;
    setPhase({ name: 'scanning', hint: null });
  };

  const title = link.title === '' ? 'Sans titre' : link.title;

  return (
    <Screen
      footer={
        phase.name === 'sent' ? (
          <Button label="Terminé" variant="primary" onPress={() => router.back()} />
        ) : phase.name === 'failed' ? (
          <Button label="Scanner à nouveau" variant="primary" icon={ScanQrCode} onPress={retry} />
        ) : undefined
      }>
      <Stack.Screen options={{ title: 'Envoyer par QR code' }} />

      {phase.name === 'sent' ? (
        <View style={styles.done}>
          <View style={[styles.badge, { backgroundColor: theme.successSubtle }]}>
            <Icon icon={Check} color="success" size={32} />
          </View>
          <ThemedText type="title" style={styles.center}>
            Lien envoyé
          </ThemedText>
          <ThemedText themeColor="inkMuted" style={styles.center}>
            {`« ${title} » s’ouvre sur l’appareil qui affichait le code.`}
          </ThemedText>
        </View>
      ) : (
        <>
          <ThemedText themeColor="inkMuted">
            {`Scannez le QR code affiché par l’extension Secure Notes de votre navigateur, ou par « Recevoir une note » dans une autre app. Il recevra le lien de « ${title} ».`}
          </ThemedText>

          {permission?.granted ? (
            <View
              style={[styles.viewfinder, { borderColor: theme.border, backgroundColor: theme.surfaceSunken }]}>
              {phase.name === 'scanning' && (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={onScanned}
                />
              )}
              {phase.name === 'sending' && (
                <ThemedText themeColor="inkMuted">Chiffrement et envoi…</ThemedText>
              )}
            </View>
          ) : permission && !permission.canAskAgain ? (
            <Notice
              tone="warning"
              title="Appareil photo refusé"
              action={<Button size="sm" label="Ouvrir les réglages" onPress={() => void Linking.openSettings()} />}>
              Autorisez l’appareil photo pour Secure Notes dans les réglages du téléphone. Il ne sert
              qu’à lire ce QR code ; aucune image n’est gardée.
            </Notice>
          ) : (
            <Notice
              tone="info"
              title="Appareil photo requis"
              action={<Button size="sm" label="Autoriser" onPress={() => void requestPermission()} />}>
              Il ne sert qu’à lire le QR code ; aucune image n’est gardée.
            </Notice>
          )}

          {phase.name === 'scanning' && phase.hint && <Notice tone="warning">{phase.hint}</Notice>}
          {phase.name === 'failed' && (
            <Notice tone="danger" title="Lien non envoyé">
              {phase.message}
            </Notice>
          )}

          <Notice tone="secure" title="Chiffré pour cet appareil seulement">
            Le lien est chiffré avec le secret du QR code et la clé de l’appareil qui l’affiche : le
            serveur qui le transmet ne peut pas le lire. Ne scannez que des codes affichés sur vos
            propres écrans.
          </Notice>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewfinder: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: 360,
    alignSelf: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: { alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.five },
  badge: {
    width: 64,
    height: 64,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
