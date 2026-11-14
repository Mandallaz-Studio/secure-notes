import { FolderMinus, Tag } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ListRow } from '@/components/list-group';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Category } from '@/notes/types';

type CategoryPickerProps = {
  visible: boolean;
  title: string;
  categories: Category[];
  /** `null` : sans catégorie. */
  onPick: (categoryId: string | null) => void;
  onClose: () => void;
};

/** Feuille du bas pour choisir une catégorie (ou aucune). */
export function CategoryPicker({ visible, title, categories, onPick, onClose }: CategoryPickerProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Fermer"
        style={styles.backdrop}
        onPress={onClose}
      />
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
          {title}
        </ThemedText>
        <ScrollView style={styles.list}>
          <ListRow icon={FolderMinus} label="Sans catégorie" onPress={() => onPick(null)} />
          {categories.map((category) => (
            <ListRow
              key={category.id}
              icon={Tag}
              label={category.name}
              onPress={() => onPick(category.id)}
            />
          ))}
        </ScrollView>
        <Button label="Annuler" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Voile du système, identique en thème clair et sombre.
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    maxHeight: '70%',
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
  },
  title: { paddingHorizontal: Spacing.two },
  list: { flexGrow: 0 },
});
