import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = 340;

interface PhotoOptionsModalProps {
  visible: boolean;
  /** URL or thumbnail URL of the photo being acted upon */
  photoUrl: string;
  /** Whether this photo is currently the primary profile photo */
  isPrimary: boolean;
  /** Called when the user taps "Set as Primary" */
  onSetPrimary: () => void;
  /** Called when the user taps "Delete Photo" */
  onDelete: () => void;
  /** Called to close the modal */
  onClose: () => void;
}

export const PhotoOptionsModal: React.FC<PhotoOptionsModalProps> = ({
  visible,
  photoUrl,
  isPrimary,
  onSetPrimary,
  onDelete,
  onClose,
}) => {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          damping: 20,
          stiffness: 200,
          mass: 1,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SHEET_HEIGHT,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  const resolvedUrl = resolveUrl(photoUrl);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <TouchableWithoutFeedback>
            <Animated.View
              style={[
                styles.sheet,
                { transform: [{ translateY: slideAnim }] },
              ]}
            >
              {/* Handle bar */}
              <View style={styles.handleBar} />

              {/* Photo Preview */}
              <View style={styles.previewSection}>
                <Image
                  source={{ uri: resolvedUrl }}
                  style={styles.previewImage}
                />
              </View>

              {/* Divider */}
              <View style={styles.divider} />

              {/* Options */}
              <View style={styles.optionsSection}>
                {/* Set as Primary (hidden if already primary) */}
                {!isPrimary && (
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => {
                      onClose();
                      onSetPrimary();
                    }}
                    activeOpacity={0.6}
                  >
                    <View style={styles.optionIconWrap}>
                      <Ionicons
                        name="star"
                        size={22}
                        color={colors.textPrimary}
                      />
                    </View>
                    <View style={styles.optionContent}>
                      <Text style={styles.optionTitle}>Set as Primary</Text>
                      <Text style={styles.optionSubtitle}>
                        Make this your main profile photo
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                )}

                {/* Delete Photo */}
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => {
                    onClose();
                    onDelete();
                  }}
                  activeOpacity={0.6}
                >
                  <View style={[styles.optionIconWrap, styles.optionIconDanger]}>
                    <Ionicons
                      name="trash-outline"
                      size={22}
                      color={colors.error}
                    />
                  </View>
                  <View style={styles.optionContent}>
                    <Text style={[styles.optionTitle, styles.optionTitleDanger]}>
                      Delete Photo
                    </Text>
                    <Text style={styles.optionSubtitle}>
                      Remove this photo permanently
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {/* Cancel Button */}
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
    paddingHorizontal: spacing.xxl,
    minHeight: SHEET_HEIGHT,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHighlight,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },

  // Preview
  previewSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  previewImage: {
    width: 100,
    height: 100,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
  },

  divider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginBottom: spacing.md,
  },

  // Options
  optionsSection: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  optionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconDanger: {
    backgroundColor: 'rgba(255,0,0,0.08)',
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    ...typography.body1,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  optionTitleDanger: {
    color: colors.error,
  },
  optionSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Cancel
  cancelButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHighlight,
  },
  cancelText: {
    ...typography.body1,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});

export default PhotoOptionsModal;
