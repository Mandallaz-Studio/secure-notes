import { Plus } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Bouton flottant « Nouvelle note » : seul élément avec une ombre. */
export function Fab({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { backgroundColor: pressed ? theme.accentPressed : theme.accent }]}>
      <Icon icon={Plus} color="onAccent" strokeWidth={2} />
      <ThemedText type="bodyStrong" themeColor="onAccent">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 48,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.four,
    borderRadius: Radius.lg,
    shadowColor: '#1A1C1E',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
