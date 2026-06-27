import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, radius, spacing } from '../../theme';

interface GlassToastProps {
  text1?: string;
  text2?: string;
  hide: () => void;
  onPress?: () => void;
  props?: Record<string, any>;
}

/**
 * Glassmorphic black toast — slides in at the bottom.
 * Used for transient feedback messages (e.g. "Phone already exists!").
 */
export const GlassToast: React.FC<GlassToastProps> = React.memo(({ text1, text2, hide, onPress }) => {
  const handlePress = () => {
    if (onPress) onPress();
    hide();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handlePress}
      style={styles.wrapper}
    >
      <View style={styles.container}>
        <View style={styles.inner}>
          {/* Left icon */}
          <View style={styles.iconContainer}>
            <Ionicons name="alert-circle" size={20} color="rgba(255,255,255,0.85)" />
          </View>

          {/* Content */}
          <View style={styles.content}>
            {text1 ? <Text style={styles.title} numberOfLines={1}>{text1}</Text> : null}
            {text2 ? <Text style={styles.message} numberOfLines={2}>{text2}</Text> : null}
          </View>

          {/* Close button */}
          <TouchableOpacity onPress={hide} style={styles.closeButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
});

GlassToast.displayName = 'GlassToast';

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  container: {
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
    // Backdrop blur hint (iOS renders via backdropFilter if supported)
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  title: {
    ...typography.body2,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  message: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.65)',
    marginTop: 1,
  },
  closeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
