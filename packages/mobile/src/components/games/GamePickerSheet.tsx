import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, BackHandler, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import { DOTS_SIZES } from './gameTypes';

/**
 * The games a chat can start, opened from the gamepad in the chat header.
 * Pick a game, then (as the one starting it) the board size.
 *
 * An overlay inside the chat screen like ReportBlockSheet, not a <Modal>,
 * for the same keyboard reasons. Render it near the end of the screen so it
 * covers the chat.
 */

type Step = 'games' | 'size';

interface GamePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Starts the game; resolves true when it started (the sheet then closes) */
  onStartDots: (rows: number, cols: number) => Promise<boolean>;
}

export const GamePickerSheet: React.FC<GamePickerSheetProps> = ({ visible, onClose, onStartDots }) => {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('games');
  const [size, setSize] = useState(4);
  const [busy, setBusy] = useState(false);

  // Start fresh every time the sheet opens
  useEffect(() => {
    if (visible) {
      setStep('games');
      setSize(4);
      setBusy(false);
    }
  }, [visible]);

  // Android back steps back to the game list, then closes the sheet
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (step !== 'games') setStep('games');
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, step, busy, onClose]);

  if (!visible) return null;

  const close = () => {
    if (!busy) onClose();
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const started = await onStartDots(size, size);
    setBusy(false);
    if (started) onClose();
  };

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessibilityLabel="Close" />
      <View style={styles.avoider} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.handle} />

          {step === 'games' && (
            <>
              <Text style={styles.title}>Play a game</Text>
              <TouchableOpacity
                style={styles.gameRow}
                onPress={() => setStep('size')}
                accessibilityRole="button"
                accessibilityLabel="Dots and Boxes"
              >
                <View style={styles.gameIcon}>
                  <Ionicons name="grid-outline" size={22} color={colors.textPrimary} />
                </View>
                <View style={styles.gameText}>
                  <Text style={styles.gameLabel}>Dots and Boxes</Text>
                  <Text style={styles.gameHint}>Take turns joining dots. Close a box to take it and go again.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </>
          )}

          {step === 'size' && (
            <>
              <View style={styles.titleRow}>
                <TouchableOpacity
                  onPress={() => !busy && setStep('games')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Back"
                >
                  <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={[styles.title, styles.titleInRow]}>Board size</Text>
              </View>
              <Text style={styles.body}>Boxes on each side. You move first.</Text>

              <View style={styles.sizeGrid}>
                {DOTS_SIZES.map((option) => {
                  const selected = option.size === size;
                  return (
                    <TouchableOpacity
                      key={option.size}
                      style={[styles.sizeTile, selected && styles.sizeTileSelected]}
                      onPress={() => setSize(option.size)}
                      disabled={busy}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${option.size} by ${option.size}, ${option.label}`}
                    >
                      <Text style={[styles.sizeValue, selected && styles.sizeTextSelected]}>
                        {option.size} × {option.size}
                      </Text>
                      <Text style={[styles.sizeLabel, selected && styles.sizeTextSelected]}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, busy && styles.primaryBtnBusy]}
                onPress={start}
                disabled={busy}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryText}>Start game</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    zIndex: 1000,
    elevation: 1000,
  },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceHighlight,
    marginBottom: spacing.md,
  },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  titleInRow: { marginBottom: 0 },
  body: { ...typography.body2, color: colors.textMuted, marginBottom: spacing.lg },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    marginBottom: spacing.sm,
  },
  gameIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameText: { flex: 1 },
  gameLabel: { ...typography.h4, color: colors.textPrimary },
  gameHint: { ...typography.body2, color: colors.textMuted, marginTop: 2 },
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
    marginBottom: spacing.lg,
  },
  sizeTile: {
    width: '48%',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  sizeTileSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sizeValue: { ...typography.h3, color: colors.textPrimary },
  sizeLabel: { ...typography.body2, color: colors.textMuted, marginTop: 2 },
  sizeTextSelected: { color: colors.textInverse },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnBusy: { opacity: 0.7 },
  primaryText: { ...typography.h4, color: colors.textInverse },
});
