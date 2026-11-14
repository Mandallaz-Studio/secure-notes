import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type EmptyStateProps = { icon: LucideIcon; title: string; message?: string; action?: ReactNode };

/** État vide d'une liste. */
export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.icon, { backgroundColor: theme.surfaceSunken }]}>
        <Icon icon={icon} size={24} color="inkMuted" />
      </View>
      <ThemedText type="headline" style={styles.center}>
        {title}
      </ThemedText>
      {message && (
        <ThemedText type="callout" themeColor="inkMuted" style={[styles.center, styles.message]}>
          {message}
        </ThemedText>
      )}
      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  icon: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  center: { textAlign: 'center' },
  message: { maxWidth: 280 },
  action: { marginTop: Spacing.two },
});
