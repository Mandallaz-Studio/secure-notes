import { Platform, StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = TextInputProps & {
  invalid?: boolean;
};

/**
 * Champ de saisie pour des secrets (mots de la phrase) : pas de correction
 * automatique, pas de suggestion, pas d'apprentissage par le clavier.
 */
export function SecretTextField({ invalid, style, ...rest }: TextFieldProps) {
  const theme = useTheme();

  return (
    <TextInput
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect={false}
      spellCheck={false}
      importantForAutofill="no"
      // Sur Android, `autoCorrect={false}` ne suffit pas : le clavier corrige quand
      // même (« substrat » devenait « substrate »). Ce type de champ coupe la
      // correction, les suggestions et l'apprentissage des mots saisis.
      keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
      placeholderTextColor={theme.textSecondary}
      {...rest}
      style={[
        styles.input,
        {
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderColor: invalid ? theme.danger : theme.border,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
