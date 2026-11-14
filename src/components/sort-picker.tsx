import {
  ArrowDownAZ,
  ArrowDownZA,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
  type LucideIcon,
} from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-group';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NoteSort } from '@/notes/types';

export const SORT_OPTIONS: { value: NoteSort; label: string; icon: LucideIcon }[] = [
  { value: 'updated-desc', label: 'Modifiées récemment d’abord', icon: CalendarArrowDown },
  { value: 'updated-asc', label: 'Modifiées anciennement d’abord', icon: CalendarArrowUp },
  { value: 'title-asc', label: 'Titre de A à Z', icon: ArrowDownAZ },
  { value: 'title-desc', label: 'Titre de Z à A', icon: ArrowDownZA },
];

type SortPickerProps = {
  visible: boolean;
  value: NoteSort;
  onPick: (sort: NoteSort) => void;
  onClose: () => void;
};

/** Feuille du bas pour choisir l'ordre de la liste des notes. */
export function SortPicker({ visible, value, onPick, onClose }: SortPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Fermer" style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            paddingBottom: insets.bottom + Spacing.three,
          },
        ]}>
        <ThemedText type="headline" accessibilityRole="header" style={styles.title}>
          Trier les notes
        </ThemedText>
        <View>
          {SORT_OPTIONS.map((option) => (
            <ListRow
              key={option.value}
              icon={option.icon}
              label={option.label}
              tone={option.value === value ? 'accent' : 'default'}
              trailing={option.value === value ? <Icon icon={Check} color="accent" /> : undefined}
              onPress={() => onPick(option.value)}
            />
          ))}
        </View>
        <ThemedText type="caption" themeColor="inkSubtle" style={styles.title}>
          Les notes mises en avant restent en tête de liste.
        </ThemedText>
        <Button label="Annuler" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
  },
  title: { paddingHorizontal: Spacing.two },
});
