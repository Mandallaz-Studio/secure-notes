import { Platform, type TextStyle } from 'react-native';

/**
 * Couleurs de l'interface. Les noms suivent le design system « Secure Notes »
 * (jetons `canvas`, `surface`, `ink`, `accent`…), en camelCase.
 *
 * - Fonds : `canvas` (écrans de liste), `surface` (éditeur, groupes, en-têtes),
 *   `surfaceSunken` (champs de recherche, chips, cases), `surfaceSelected` (pressé, actif).
 * - Texte : `ink`, `inkMuted` (secondaire), `inkSubtle` (dates, textes indicatifs ;
 *   jamais sur `surfaceSelected`).
 * - Filets : `border` (séparation), `borderStrong` (contour d'un contrôle, 3:1).
 * - Marque : `accent`, texte posé dessus en `onAccent` — jamais en blanc codé en dur.
 */
export const Colors = {
  light: {
    canvas: '#FAFAF9',
    surface: '#FFFFFF',
    surfaceSunken: '#F1F1EF',
    surfaceSelected: '#E6E6E3',
    border: '#E2E2DE',
    borderStrong: '#858883',
    ink: '#1A1C1E',
    inkMuted: '#5C6066',
    inkSubtle: '#686D73',
    accent: '#1E5A6B',
    accentPressed: '#174956',
    accentSubtle: '#E3EEF0',
    onAccent: '#FFFFFF',
    danger: '#B42318',
    dangerSubtle: '#FBEAE8',
    onDanger: '#FFFFFF',
    success: '#1E7A4C',
    successSubtle: '#E5F3EB',
    warning: '#8A5100',
    warningSubtle: '#FFF4DD',
  },
  dark: {
    canvas: '#111214',
    surface: '#17181A',
    surfaceSunken: '#202124',
    surfaceSelected: '#2B2D31',
    border: '#2C2E32',
    borderStrong: '#6B7077',
    ink: '#ECEDEE',
    inkMuted: '#A3A8AE',
    inkSubtle: '#8C9198',
    accent: '#7CC4D3',
    accentPressed: '#A3D8E3',
    accentSubtle: '#173840',
    onAccent: '#0D1F24',
    danger: '#FF8A80',
    dangerSubtle: '#3A1C19',
    onDanger: '#2A0B08',
    success: '#5ED39A',
    successSubtle: '#15301F',
    warning: '#F2B65A',
    warningSubtle: '#33270F',
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

/**
 * Polices chargées au démarrage (voir `_layout.tsx`). Android ne synthétise
 * pas les graisses d'une police personnalisée : chaque graisse est une famille.
 */
export const FontFiles = {
  sans400: 'IBMPlexSans_400Regular',
  sans400Italic: 'IBMPlexSans_400Regular_Italic',
  sans500: 'IBMPlexSans_500Medium',
  sans600: 'IBMPlexSans_600SemiBold',
  sans600Italic: 'IBMPlexSans_600SemiBold_Italic',
  mono400: 'IBMPlexMono_400Regular',
  mono500: 'IBMPlexMono_500Medium',
} as const;

export type FontWeight = 400 | 500 | 600;

/** Famille à utiliser pour une graisse donnée (pas de `fontWeight` avec ces familles). */
export function fontFamily(weight: FontWeight = 400, italic = false, mono = false): string {
  if (mono) return weight >= 500 ? FontFiles.mono500 : FontFiles.mono400;
  if (weight >= 600) return italic ? FontFiles.sans600Italic : FontFiles.sans600;
  if (weight === 500) return FontFiles.sans500;
  return italic ? FontFiles.sans400Italic : FontFiles.sans400;
}

/** Piles CSS pour le contenu web (éditeur TenTap, page de lecture). */
export const Fonts = Platform.select({
  web: {
    sans: `${FontFiles.sans400}, "IBM Plex Sans", system-ui, sans-serif`,
    mono: `${FontFiles.mono400}, "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace`,
  },
  default: { sans: FontFiles.sans400, mono: FontFiles.mono400 },
});

/** Styles de texte du design system. */
export const Type = {
  display: { fontFamily: fontFamily(600), fontSize: 28, lineHeight: 34, letterSpacing: -0.2 },
  title: { fontFamily: fontFamily(600), fontSize: 22, lineHeight: 28, letterSpacing: -0.1 },
  headline: { fontFamily: fontFamily(600), fontSize: 17, lineHeight: 24 },
  section: {
    fontFamily: fontFamily(500),
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  body: { fontFamily: fontFamily(400), fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fontFamily(500), fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fontFamily(400), fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fontFamily(500), fontSize: 14, lineHeight: 20 },
  caption: {
    fontFamily: fontFamily(400),
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
  },
  phrase: { fontFamily: fontFamily(500, false, true), fontSize: 15, lineHeight: 22 },
  code: { fontFamily: fontFamily(400, false, true), fontSize: 13, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

export type TypeStyle = keyof typeof Type;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Rembourrage vertical des lignes (note, réglage). */
export const RowPadding = 12;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  full: 999,
} as const;

export const Sizes = {
  control: 44,
  controlSmall: 36,
  chip: 32,
  icon: 20,
  toolbar: 48,
} as const;

/** Trait des icônes Lucide. */
export const IconStroke = 1.75;

export const MaxContentWidth = 720;
