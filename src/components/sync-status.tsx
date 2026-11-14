import { Cloud, CloudOff, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useSync } from '@/sync/sync-context';

/** Ligne d'état discrète sous le titre de la liste des notes. */
export function SyncStatus() {
  const { config, status } = useSync();

  let icon: LucideIcon;
  let iconColor: ThemeColor = 'inkSubtle';
  let textColor: ThemeColor = 'inkSubtle';
  let text: string;
  if (!config.enabled) {
    icon = CloudOff;
    text = 'Hors ligne · notes sur cet appareil';
  } else if (status.state === 'syncing') {
    icon = RefreshCw;
    text = 'Synchronisation…';
  } else if (status.state === 'error') {
    icon = TriangleAlert;
    iconColor = textColor = 'danger';
    text = 'Synchronisation en échec · voir les réglages';
  } else if (status.lastSyncAt) {
    icon = Cloud;
    iconColor = 'success';
    text = `Synchronisé à ${new Date(status.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    icon = Cloud;
    text = 'Pas encore synchronisé';
  }

  return (
    <View style={styles.row} accessibilityRole="text">
      <Icon icon={icon} size={14} color={iconColor} strokeWidth={2} />
      <ThemedText type="caption" themeColor={textColor}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
});
