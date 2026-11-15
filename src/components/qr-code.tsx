import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Radius } from '@/constants/theme';
import { QR_QUIET_ZONE, qrPath } from '@/share/qr-path';
import { useTheme } from '@/hooks/use-theme';

/**
 * QR code, toujours sombre sur blanc quel que soit le thème : les lecteurs
 * lisent mal les codes inversés.
 */
export function QrCode({ value, size = 240, label }: { value: string; size?: number; label: string }) {
  const theme = useTheme();
  const { size: modules, d } = useMemo(() => qrPath(value), [value]);
  const full = modules + 2 * QR_QUIET_ZONE;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.card, { borderColor: theme.border, width: size, height: size }]}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${full} ${full}`}>
        <Path d={d} fill="#1A1C1E" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    padding: 6,
    borderWidth: 1,
    borderRadius: Radius.lg,
    backgroundColor: '#FFFFFF',
  },
});
