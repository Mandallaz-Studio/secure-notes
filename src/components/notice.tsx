import { Check, Info, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FontFiles, Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NoticeTone = 'info' | 'secure' | 'success' | 'warning' | 'danger';

const LOOK: Record<NoticeTone, { icon: LucideIcon; color: ThemeColor; background: ThemeColor }> = {
  info: { icon: Info, color: 'accent', background: 'surfaceSunken' },
  secure: { icon: ShieldCheck, color: 'accent', background: 'accentSubtle' },
  success: { icon: Check, color: 'success', background: 'successSubtle' },
  warning: { icon: TriangleAlert, color: 'warning', background: 'warningSubtle' },
  danger: { icon: TriangleAlert, color: 'danger', background: 'dangerSubtle' },
};

type NoticeProps = {
  tone?: NoticeTone;
  /** Ce qui se passe, en quelques mots. */
  title?: string;
  /** Quoi faire. */
  children?: ReactNode;
  /** Au plus une action, sous le texte. */
  action?: ReactNode;
};

/** Message en ligne dans un écran : icône, titre, explication. */
export function Notice({ tone = 'info', title, children, action }: NoticeProps) {
  const theme = useTheme();
  const look = LOOK[tone];
  const titleColor: ThemeColor = tone === 'warning' || tone === 'danger' ? look.color : 'ink';

  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: theme[look.background] }]}>
      <View style={styles.icon}>
        <Icon icon={look.icon} color={look.color} />
      </View>
      <View style={styles.body}>
        {title && (
          <ThemedText type="bodyStrong" themeColor={titleColor} style={styles.title}>
            {title}
          </ThemedText>
        )}
        {children !== undefined && children !== null && children !== false && (
          <ThemedText type="callout" themeColor={tone === 'info' ? 'inkMuted' : 'ink'}>
            {children}
          </ThemedText>
        )}
        {action && <View style={styles.action}>{action}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
  icon: { paddingTop: 2 },
  body: { flex: 1, gap: Spacing.half },
  title: { fontFamily: FontFiles.sans600, fontSize: 15, lineHeight: 22 },
  action: { marginTop: Spacing.two, alignItems: 'flex-start' },
});
