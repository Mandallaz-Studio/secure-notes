import { TriangleAlert, Search, X } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Sizes, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = TextInputProps & {
  /** Libellé affiché au-dessus du champ (et lu par les lecteurs d'écran). */
  label?: string;
  /** Aide sous le champ, remplacée par `error` s'il y en a une. */
  hint?: string;
  error?: string | null;
  /** Contour d'erreur sans message (le message est affiché ailleurs). */
  invalid?: boolean;
  /** Saisie d'un secret : police à chasse fixe. */
  mono?: boolean;
};

export function TextField({
  label,
  hint,
  error,
  invalid,
  mono,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const hasError = invalid || !!error;
  const borderColor = hasError ? theme.danger : focused ? theme.accent : theme.borderStrong;

  return (
    <View style={styles.field}>
      {label && <ThemedText type="label">{label}</ThemedText>}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.inkSubtle}
        selectionColor={theme.accent}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...rest}
        style={[
          styles.input,
          mono ? Type.phrase : Type.body,
          {
            color: theme.ink,
            backgroundColor: theme.surface,
            borderColor,
            borderWidth: focused || hasError ? 2 : 1,
            // La bordure plus épaisse ne décale pas le texte.
            paddingHorizontal: focused || hasError ? Spacing.three - 1 : Spacing.three,
          },
          style,
        ]}
      />
      {(error || hint) && (
        <View style={styles.hint}>
          {error && <Icon icon={TriangleAlert} size={16} color="danger" />}
          <ThemedText type="callout" themeColor={error ? 'danger' : 'inkMuted'} style={styles.hintText}>
            {error || hint}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

/**
 * Champ de saisie pour des secrets (mots de la phrase) : pas de correction
 * automatique, pas de suggestion, pas d'apprentissage par le clavier.
 */
export function SecretTextField(props: TextFieldProps) {
  return (
    <TextField
      mono
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect={false}
      spellCheck={false}
      importantForAutofill="no"
      // Sur Android, `autoCorrect={false}` ne suffit pas : le clavier corrige quand
      // même (« substrat » devenait « substrate »). Ce type de champ coupe la
      // correction, les suggestions et l'apprentissage des mots saisis.
      keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
      {...props}
    />
  );
}

type SearchFieldProps = Omit<TextInputProps, 'style'> & { value: string; onChangeText: (text: string) => void };

/** Recherche de la liste des notes : fond en creux, loupe, bouton d'effacement. */
export function SearchField({ value, onChangeText, ...rest }: SearchFieldProps) {
  const theme = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.surfaceSunken }]}>
      <Icon icon={Search} size={18} color="inkSubtle" />
      <TextInput
        accessibilityLabel="Rechercher"
        placeholderTextColor={theme.inkSubtle}
        selectionColor={theme.accent}
        autoCapitalize="none"
        returnKeyType="search"
        value={value}
        onChangeText={onChangeText}
        {...rest}
        style={[styles.searchInput, Type.body, { color: theme.ink }]}
      />
      {value !== '' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Effacer la recherche"
          hitSlop={8}
          onPress={() => onChangeText('')}
          style={styles.clear}>
          <Icon icon={X} size={16} color="inkMuted" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  input: {
    minHeight: Sizes.control,
    borderRadius: Radius.md,
    paddingVertical: Spacing.two + Spacing.half,
  },
  hint: { flexDirection: 'row', gap: Spacing.one, alignItems: 'flex-start' },
  hintText: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, paddingVertical: 0 },
  clear: { padding: Spacing.one },
});
