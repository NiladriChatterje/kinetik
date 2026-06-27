import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, radius, spacing } from '../../theme';

type ToastType = 'error' | 'success' | 'glass';

interface GlassToastProps {
  type?: string;
  text1?: string;
  text2?: string;
  hide: () => void;
  onPress?: () => void;
  props?: Record<string, any>;
}

/**
 * Get the glassmorphic background color and icon config for each toast type.
 */
function getToastConfig(type: ToastType) {
  switch (type) {
    case 'error':
      return {
        background: 'rgba(140, 40, 30, 0.92)',
        border: 'rgba(255, 120, 90, 0.20)',
        icon: 'close-circle' as const,
      };
    case 'success':
      return {
        background: 'rgba(25, 95, 50, 0.92)',
        border: 'rgba(80, 200, 120, 0.20)',
        icon: 'checkmark-circle' as const,
      };
    case 'glass':
    default:
      return {
        background: 'rgba(18, 18, 18, 0.92)',
        border: 'rgba(255, 255, 255, 0.08)',
        icon: 'alert-circle' as const,
      };
  }
}

/**
 * Glassmorphic toast — slides in at the bottom.
 * Supports error (reddish-brown), success (darkish green), and glass (black) variants.
 */
export const GlassToast: React.FC<GlassToastProps> = React.memo(({ type = 'glass', text1, text2, hide, onPress }) => {
  const handlePress = () => {
    if (onPress) onPress();
    hide();
  };

  const toastType = type as ToastType;
  const config = getToastConfig(toastType);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handlePress}
      style={styles.wrapper}
    >
      <View style={[styles.container, { backgroundColor: config.background, borderColor: config.border }]}>
        <View style={styles.inner}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons name={config.icon} size={20} color="rgba(255,255,255,0.90)" />
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
    borderRadius: radius.lg,
    borderWidth: 1,
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
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
