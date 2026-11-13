import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { createCategory, foldText, renamed } from '@/notes/model';
import { useCategories, useNotes } from '@/notes/notes-context';
import type { Category } from '@/notes/types';

/** Horodatage d'une modification, pris au moment de l'action de l'utilisateur. */
const now = () => Date.now();

export default function CategoriesScreen() {
  const { store, invalidate } = useNotes();
  const categories = useCategories();
  const [newName, setNewName] = useState('');

  const nameTaken = (name: string, exceptId?: string) =>
    categories.some((c) => c.id !== exceptId && foldText(c.name) === foldText(name.trim()));

  const add = async () => {
    if (!store || newName.trim() === '' || nameTaken(newName)) return;
    await store.saveCategory(createCategory(newName, now()));
    setNewName('');
    invalidate();
  };

  const rename = async (category: Category, name: string) => {
    if (!store || name.trim() === '' || name.trim() === category.name || nameTaken(name, category.id)) {
      return;
    }
    await store.saveCategory(renamed(category, name, now()));
    invalidate();
  };

  const remove = async (category: Category) => {
    const confirmed = await confirmDestructive({
      title: `Supprimer « ${category.name} » ?`,
      message: 'Les notes de cette catégorie sont conservées, sans catégorie.',
      confirmLabel: 'Supprimer',
    });
    if (confirmed && store) {
      await store.deleteCategory(category.id, now());
      invalidate();
    }
  };

  return (
    <Screen>
      <View style={styles.block}>
        <ThemedText type="subtitle">Nouvelle catégorie</ThemedText>
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField
              accessibilityLabel="Nom de la nouvelle catégorie"
              placeholder="Nom"
              value={newName}
              invalid={nameTaken(newName)}
              onChangeText={setNewName}
              onSubmitEditing={add}
              returnKeyType="done"
            />
          </View>
          <Button
            label="Ajouter"
            variant="primary"
            disabled={newName.trim() === '' || nameTaken(newName)}
            onPress={add}
          />
        </View>
        {nameTaken(newName) && (
          <ThemedText type="small" themeColor="danger">
            Cette catégorie existe déjà.
          </ThemedText>
        )}
      </View>

      <View style={styles.block}>
        <ThemedText type="subtitle">Catégories</ThemedText>
        {categories.length === 0 && (
          <ThemedText themeColor="textSecondary">Aucune catégorie pour l&apos;instant.</ThemedText>
        )}
        {categories.map((category) => (
          <CategoryRow
            key={category.id}
            category={category}
            onRename={(name) => rename(category, name)}
            onRemove={() => remove(category)}
          />
        ))}
      </View>
    </Screen>
  );
}

type CategoryRowProps = {
  category: Category;
  onRename: (name: string) => void;
  onRemove: () => void;
};

function CategoryRow({ category, onRename, onRemove }: CategoryRowProps) {
  const [name, setName] = useState(category.name);

  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <TextField
          accessibilityLabel={`Nom de la catégorie ${category.name}`}
          value={name}
          onChangeText={setName}
          onEndEditing={() => onRename(name)}
          onSubmitEditing={() => onRename(name)}
          returnKeyType="done"
        />
      </View>
      <Button
        label="Supprimer"
        accessibilityLabel={`Supprimer la catégorie ${category.name}`}
        variant="danger"
        onPress={onRemove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  flex: { flex: 1 },
});
