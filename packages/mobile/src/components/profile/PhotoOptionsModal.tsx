import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  Animated,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveUrl } from '../../config';
import { colors, typography, spacing, radius } from '../../theme';

const SHEET_HEIGHT = 340;
/** Destructive red, matching the Delete Account confirmation on the profile screen */
const DANGER = '#E53935';

interface PhotoOptionsModalProps {
  visible: boolean;
  /** URL or thumbnail URL of the photo being acted upon */
  photoUrl: string;
  /** Whether this photo is currently the primary profile photo */
  isPrimary: boolean;
  /** Called when the user taps "Set as Primary" */
  onSetPrimary: () => void;
  /** Called once the user confirms the delete; the sheet waits for it, then closes */
  onDelete: () => Promise<void>;
  /**
   * False when deleting is not allowed right now (the profile is at its
   * minimum photo count). The row is shown greyed out and does nothing.
   */
  canDelete?: boolean;
  /** Shown under "Delete Photo" when canDelete is false */
  deleteDisabledReason?: string;
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
  canDelete = true,
  deleteDisabledReason = 'Add another photo first',
}) => {
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  // Delete asks for confirmation inside this sheet rather than a system alert
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Every opening starts on the options view
  useEffect(() => {
    if (visible) {
      setConfirmingDelete(false);
      setDeleting(false);
    }
  }, [visible]);

  const handleClose = () => {
    if (!deleting) onClose();
  };

  // Android back steps out of the confirmation before closing the sheet
  const handleRequestClose = () => {
    if (deleting) return;
    if (confirmingDelete) setConfirmingDelete(false);
    else onClose();
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      onClose();
    }
  };

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
      onRequestClose={handleRequestClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <TouchableWithoutFeedback onPress={handleClose}>
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

              {confirmingDelete ? (
                <>
                  {/* Delete confirmation */}
                  <Text style={styles.confirmTitle}>Delete this photo?</Text>
                  <Text style={styles.confirmBody}>
                    It will be removed from your profile. This cannot be undone.
                  </Text>

                  <TouchableOpacity
                    style={[styles.deleteButton, deleting && styles.deleteButtonBusy]}
                    onPress={handleConfirmDelete}
                    disabled={deleting}
                    activeOpacity={0.8}
                  >
                    {deleting && <ActivityIndicator size="small" color={colors.textMuted} />}
                    <Text style={[styles.deleteButtonText, deleting && styles.deleteButtonTextBusy]}>
                      {deleting ? 'Deleting…' : 'Delete Photo'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setConfirmingDelete(false)}
                    disabled={deleting}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cancelText}>Keep Photo</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
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

                    {/* Delete Photo — greyed out while the profile is at its
                        minimum photo count */}
                    <TouchableOpacity
                      style={[styles.optionRow, !canDelete && styles.optionRowDisabled]}
                      onPress={() => setConfirmingDelete(true)}
                      disabled={!canDelete}
                      activeOpacity={0.6}
                      accessibilityState={{ disabled: !canDelete }}
                    >
                      <View style={[styles.optionIconWrap, canDelete && styles.optionIconDanger]}>
                        <Ionicons
                          name={canDelete ? 'trash-outline' : 'lock-closed-outline'}
                          size={22}
                          color={canDelete ? DANGER : colors.textMuted}
                        />
                      </View>
                      <View style={styles.optionContent}>
                        <Text style={[styles.optionTitle, canDelete ? styles.optionTitleDanger : styles.optionTitleDisabled]}>
                          Delete Photo
                        </Text>
                        <Text style={styles.optionSubtitle}>
                          {canDelete ? 'Remove this photo permanently' : deleteDisabledReason}
                        </Text>
                      </View>
                      {canDelete && (
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={colors.textMuted}
                        />
                      )}
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
                </>
              )}
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
    backgroundColor: 'rgba(229, 57, 53, 0.1)',
  },
  optionRowDisabled: {
    opacity: 0.55,
  },
  optionTitleDisabled: {
    color: colors.textMuted,
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
    color: DANGER,
  },
  optionSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Delete confirmation
  confirmTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  confirmBody: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  deleteButton: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    backgroundColor: DANGER,
    marginBottom: spacing.sm,
  },
  deleteButtonBusy: {
    backgroundColor: colors.surfaceHighlight,
  },
  deleteButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  deleteButtonTextBusy: {
    color: colors.textMuted,
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
