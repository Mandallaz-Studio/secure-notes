import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ProgressBarProps = {
  label: string;
  /** Entre 0 et 1. */
  ratio: number;
  /** Valeur en clair (« 18,4 Mo sur 50 Mo ») : la couleur seule ne suffit pas. */
  valueLabel: string;
  /** Au-delà, la jauge passe en `warning`. */
  warnAt?: number;
};

export function ProgressBar({ label, ratio, valueLabel, warnAt = 0.9 }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, ratio));

  return (
    <View style={styles.progress}>
      <View style={styles.head}>
        <ThemedText type="label" style={styles.label}>
          {label}
        </ThemedText>
        <ThemedText type="callout" themeColor="inkMuted">
          {valueLabel}
        </ThemedText>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
        style={[styles.track, { backgroundColor: theme.surfaceSunken, borderColor: theme.border }]}>
        <View
          style={[
            styles.fill,
            { width: `${clamped * 100}%`, backgroundColor: clamped >= warnAt ? theme.warning : theme.accent },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  label: { flexShrink: 1 },
  track: { height: 6, borderRadius: Radius.full, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
});
