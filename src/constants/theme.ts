import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    textSecondary: '#60646C',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    border: '#D9D9E0',
    tint: '#2F6FED',
    danger: '#CE2C31',
    success: '#218358',
  },
  dark: {
    text: '#ECEDEE',
    textSecondary: '#B0B4BA',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    border: '#363A3F',
    tint: '#70A5FF',
    danger: '#FF9592',
    success: '#3DD68C',
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Couleurs utilisables dans le contenu des notes. Une note stocke le nom du
 * jeton (`red`, `blue`…), jamais la valeur hexadécimale : la teinte réelle est
 * choisie selon le thème au moment de l'affichage, ce qui garde le texte
 * lisible en clair comme en sombre.
 */
export const NotePalette = {
  light: {
    text: {
      red: '#CE2C31',
      orange: '#CC4E00',
      green: '#218358',
      blue: '#0D74CE',
      purple: '#8145B5',
    },
    highlight: {
      yellow: '#FFF3A3',
      green: '#C9F2D5',
      blue: '#CDE4FF',
      pink: '#FFD6E7',
    },
  },
  dark: {
    text: {
      red: '#FF9592',
      orange: '#FFA057',
      green: '#3DD68C',
      blue: '#70B8FF',
      purple: '#D19DFF',
    },
    highlight: {
      yellow: '#5C4A00',
      green: '#1B4B2F',
      blue: '#143C6B',
      pink: '#5C1F3A',
    },
  },
} as const;

export type NoteTextColor = keyof typeof NotePalette.light.text;
export type NoteHighlightColor = keyof typeof NotePalette.light.highlight;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  default: { sans: 'normal', mono: 'monospace' },
  web: {
    sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const MaxContentWidth = 800;
