import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Plus, Tag, Trash2 } from 'lucide-react-native';

import { Button } from '@/components/button';
import { confirmDestructive } from '@/components/confirm';
import { EmptyState } from '@/components/empty-state';
import { IconButton } from '@/components/icon-button';
import { ListGroup, ListItem } from '@/components/list-group';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Icon } from '@/components/icon';
import { Sizes, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
      <ListGroup title="Nouvelle catégorie">
        <ListItem>
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField
                accessibilityLabel="Nom de la nouvelle catégorie"
                placeholder="Ex. Clients"
                value={newName}
                error={nameTaken(newName) ? 'Cette catégorie existe déjà.' : undefined}
                onChangeText={setNewName}
                onSubmitEditing={add}
                returnKeyType="done"
              />
            </View>
            <Button
              label="Ajouter"
              icon={Plus}
              variant="primary"
              disabled={newName.trim() === '' || nameTaken(newName)}
              onPress={add}
            />
          </View>
        </ListItem>
      </ListGroup>

      {categories.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Aucune catégorie"
          message="Les catégories rangent vos notes et servent de filtre dans la liste."
        />
      ) : (
        <ListGroup title="Catégories" footer="Touchez un nom pour le modifier.">
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              onRename={(name) => rename(category, name)}
              onRemove={() => remove(category)}
            />
          ))}
        </ListGroup>
      )}
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

  const theme = useTheme();

  return (
    <View style={styles.categoryRow}>
      <Icon icon={Tag} color="inkMuted" />
      <TextInput
        accessibilityLabel={`Nom de la catégorie ${category.name}`}
        value={name}
        onChangeText={setName}
        onEndEditing={() => onRename(name)}
        onSubmitEditing={() => onRename(name)}
        returnKeyType="done"
        selectionColor={theme.accent}
        style={[styles.flex, styles.nameInput, Type.body, { color: theme.ink }]}
      />
      <IconButton
        icon={Trash2}
        label={`Supprimer la catégorie ${category.name}`}
        tone="danger"
        onPress={onRemove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    minHeight: Sizes.control + Spacing.two,
  },
  nameInput: { paddingVertical: Spacing.two },
  flex: { flex: 1 },
});
