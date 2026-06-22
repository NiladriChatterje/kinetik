import React from 'react';
import { View, Image, StyleSheet, ViewStyle } from 'react-native';

import { colors, radius } from '../../theme';

interface AvatarProps {
  uri?: string;
  size?: number;
  isOnline?: boolean;
  hasGlow?: boolean;
  style?: ViewStyle;
}

export const Avatar: React.FC<AvatarProps> = React.memo(({
  uri,
  size = 56,
  isOnline,
  hasGlow = false,
  style,
}) => {
  const indicatorSize = size * 0.3;

  const avatarContent = uri ? (
    <Image
      source={{ uri }}
      style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
    />
  ) : (
    <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.placeholderInner, { width: size * 0.6, height: size * 0.6 }]} />
    </View>
  );

  return (
    <View style={[styles.container, style]}>
      {hasGlow ? (
        <View style={[styles.glowBorder, { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2, borderColor: colors.textPrimary, borderWidth: 2 }]}>
          {avatarContent}
        </View>
      ) : (
        avatarContent
      )}
      {isOnline !== undefined && (
        <View
          style={[
            styles.onlineIndicator,
            {
              width: indicatorSize,
              height: indicatorSize,
              borderRadius: indicatorSize / 2,
              backgroundColor: isOnline ? colors.success : colors.textMuted,
              borderColor: colors.background,
              borderWidth: 2,
            },
          ]}
        />
      )}
    </View>
  );
});
Avatar.displayName = 'Avatar';

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    resizeMode: 'cover',
  },
  placeholder: {
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderInner: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.full,
  },
  glowBorder: {
    padding: 2,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
});
