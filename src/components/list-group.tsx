import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, RowPadding, Sizes, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ListGroupProps = {
  /** Intitulé du groupe, affiché en capitales. */
  title?: string;
  /** Note sous le groupe. */
  footer?: ReactNode;
  children: ReactNode;
};

/** Groupe de réglages : intitulé, boîte à filet, note de bas de groupe. */
export function ListGroup({ title, footer, children }: ListGroupProps) {
  const theme = useTheme();
  const items = Children.toArray(children).filter(Boolean);

  return (
    <View style={styles.group}>
      {title && (
        <ThemedText type="section" themeColor="inkMuted" accessibilityRole="header" style={styles.inset}>
          {title}
        </ThemedText>
      )}
      <View style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {items.map((item, index) => (
          <Fragment key={index}>
            {index > 0 && <View style={[styles.separator, { backgroundColor: theme.border }]} />}
            {item}
          </Fragment>
        ))}
      </View>
      {footer && (
        <ThemedText type="caption" themeColor="inkSubtle" style={styles.inset}>
          {footer}
        </ThemedText>
      )}
    </View>
  );
}

type ListRowProps = {
  label: string;
  detail?: ReactNode;
  value?: string;
  icon?: LucideIcon;
  /** La ligne ouvre un autre écran. */
  chevron?: boolean;
  tone?: 'default' | 'accent' | 'danger';
  /** Élément à droite (interrupteur…). */
  trailing?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
};

/** Ligne d'un `ListGroup`. */
export function ListRow({ label, detail, value, icon, chevron, tone = 'default', trailing, disabled, onPress }: ListRowProps) {
  const theme = useTheme();
  const color: ThemeColor = tone === 'danger' ? 'danger' : tone === 'accent' ? 'accent' : 'ink';

  const content = (
    <>
      {icon && <Icon icon={icon} color={tone === 'default' ? 'inkMuted' : color} />}
      <View style={styles.main}>
        <ThemedText themeColor={color}>{label}</ThemedText>
        {detail && (
          <ThemedText type="callout" themeColor="inkMuted">
            {detail}
          </ThemedText>
        )}
      </View>
      {value && (
        <ThemedText type="callout" themeColor="inkMuted" numberOfLines={1} style={styles.value}>
          {value}
        </ThemedText>
      )}
      {trailing}
      {chevron && <Icon icon={ChevronRight} size={18} color="inkSubtle" />}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.surfaceSelected : 'transparent', opacity: disabled ? 0.4 : 1 },
      ]}>
      {content}
    </Pressable>
  );
}

/** Contenu libre dans un groupe (champ, sélecteur, jauge), avec les marges d'une ligne. */
export function ListItem({ children }: { children: ReactNode }) {
  return <View style={styles.item}>{children}</View>;
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  inset: { marginHorizontal: Spacing.three },
  box: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: Sizes.control,
    paddingVertical: RowPadding,
    paddingHorizontal: Spacing.three,
  },
  main: { flex: 1 },
  value: { maxWidth: '50%' },
  item: { paddingVertical: RowPadding, paddingHorizontal: Spacing.three, gap: Spacing.two },
});
