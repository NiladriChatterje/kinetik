import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, BackHandler, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, typography, spacing, radius } from '../../theme';
import { DOTS_MIN_SIDE, DOTS_SIDES } from './gameTypes';

/**
 * The games a chat can start, opened from the gamepad in the chat header.
 * Pick a game, then (as the one starting it) the board for Dots and
 * Boxes (columns and rows, 6 to 8 each), or a confirm for Reversi.
 *
 * An overlay inside the chat screen like ReportBlockSheet, not a <Modal>,
 * for the same keyboard reasons. Render it near the end of the screen so it
 * covers the chat.
 */

type Step = 'games' | 'size' | 'reversi';

interface GamePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Starts the game; resolves true when it started (the sheet then closes) */
  onStartDots: (rows: number, cols: number) => Promise<boolean>;
  onStartReversi: () => Promise<boolean>;
}

export const GamePickerSheet: React.FC<GamePickerSheetProps> = ({ visible, onClose, onStartDots, onStartReversi }) => {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('games');
  const [cols, setCols] = useState(DOTS_MIN_SIDE);
  const [rows, setRows] = useState(DOTS_MIN_SIDE);
  const [busy, setBusy] = useState(false);

  // Start fresh every time the sheet opens
  useEffect(() => {
    if (visible) {
      setStep('games');
      setCols(DOTS_MIN_SIDE);
      setRows(DOTS_MIN_SIDE);
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
    const started = step === 'reversi' ? await onStartReversi() : await onStartDots(rows, cols);
    setBusy(false);
    if (started) onClose();
  };

  const startButton = (
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
  );

  const backTitle = (title: string) => (
    <View style={styles.titleRow}>
      <TouchableOpacity
        onPress={() => !busy && setStep('games')}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={[styles.title, styles.titleInRow]}>{title}</Text>
    </View>
  );

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
              <TouchableOpacity
                style={styles.gameRow}
                onPress={() => setStep('reversi')}
                accessibilityRole="button"
                accessibilityLabel="Reversi"
              >
                <View style={styles.gameIcon}>
                  <Ionicons name="ellipse" size={20} color={colors.textPrimary} />
                </View>
                <View style={styles.gameText}>
                  <Text style={styles.gameLabel}>Reversi</Text>
                  <Text style={styles.gameHint}>Trap their discs between yours to flip them. Most discs wins.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </>
          )}

          {step === 'reversi' && (
            <>
              {backTitle('Reversi')}
              <Text style={styles.body}>8 × 8 board. You play black and move first. It opens full screen, with the chat below the board.</Text>
              {startButton}
            </>
          )}

          {step === 'size' && (
            <>
              {backTitle('Board size')}
              <Text style={styles.body}>Pick how many boxes across and down. You move first.</Text>

              {([
                ['Across', cols, setCols],
                ['Down', rows, setRows],
              ] as const).map(([label, value, set]) => (
                <View key={label} style={styles.sideRow}>
                  <Text style={styles.sideLabel}>{label}</Text>
                  <View style={styles.sideChoices}>
                    {DOTS_SIDES.map((n) => {
                      const selected = n === value;
                      return (
                        <TouchableOpacity
                          key={n}
                          style={[styles.sizeTile, selected && styles.sizeTileSelected]}
                          onPress={() => set(n)}
                          disabled={busy}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`${n} boxes ${label.toLowerCase()}`}
                        >
                          <Text style={[styles.sizeValue, selected && styles.sizeTextSelected]}>{n}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}

              <Text style={styles.sizeSummary}>
                {cols} × {rows} board · {cols * rows} boxes to take
              </Text>

              {startButton}
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
  sideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sideLabel: { ...typography.h4, color: colors.textPrimary, width: 64 },
  sideChoices: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  sizeSummary: {
    ...typography.body2,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  sizeTile: {
    flex: 1,
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
