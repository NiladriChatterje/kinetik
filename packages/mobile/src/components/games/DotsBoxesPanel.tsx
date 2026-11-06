import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, Alert, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';
import type { DotsGame, DotsEdge } from './gameTypes';

/**
 * Dots and Boxes, shown at the top of the chat while a game is on (and once
 * it is over, until the player closes it). The chat stays below it; the
 * header bar folds the board away, and the chat folds it while typing.
 *
 * The server checks every move. A tapped line shows at once while the move
 * is sent; the board then follows what the server answers.
 */

const MY_BOX = 'rgba(255, 107, 107, 0.45)';
const THEIR_BOX = 'rgba(0, 0, 0, 0.16)';
const MY_DOT = '#FF6B6B';
const THEIR_DOT = 'rgba(0, 0, 0, 0.35)';
const LINE = 'rgba(0, 0, 0, 0.55)';
const LINE_LAST = '#000000';
const LINE_EMPTY = 'rgba(0, 0, 0, 0.07)';

const DOT = 8;
const PAD = 14;
const MAX_CELL = 56;

interface DotsBoxesPanelProps {
  game: DotsGame;
  myId: string;
  partnerName: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The line being sent, drawn at once */
  pending: DotsEdge | null;
  onMove: (edge: DotsEdge) => void;
  onEnd: () => void;
  onClose: () => void;
}

function sameEdge(a: DotsEdge | null, b: DotsEdge | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.r === b.r && a.c === b.c;
}

export const DotsBoxesPanel: React.FC<DotsBoxesPanelProps> = ({
  game, myId, partnerName, collapsed, onToggleCollapsed, pending, onMove, onEnd, onClose,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const { state, status } = game;
  const { rows, cols } = state;
  const me = state.players.indexOf(myId);
  const them = me === 0 ? 1 : 0;
  const myTurn = status === 'active' && state.turn === me && !pending;

  const cell = Math.min(MAX_CELL, Math.floor((screenWidth - 2 * spacing.lg - 2 * PAD) / Math.max(rows, cols)));
  const boardWidth = cols * cell + 2 * PAD;
  const boardHeight = rows * cell + 2 * PAD;
  // The tap area of a line: thick enough for a thumb, kept off the dots so
  // a tap near a corner is not taken for the line across
  const hit = Math.min(36, Math.round(cell * 0.7));
  const inset = Math.min(hit / 2, cell * 0.22);

  let statusText: string;
  if (status === 'active') {
    if (pending) statusText = 'Sending…';
    else statusText = state.turn === me ? 'Your turn' : `${partnerName}'s turn`;
  } else if (status === 'finished') {
    statusText = game.winnerId === myId ? 'You won! 🎉' : game.winnerId ? `${partnerName} won` : "It's a draw";
  } else {
    statusText = game.endedBy === myId ? 'You ended the game' : `${partnerName} ended the game`;
  }

  const confirmEnd = () => {
    Alert.alert('End this game?', 'It ends for both of you.', [
      { text: 'Keep playing', style: 'cancel' },
      { text: 'End game', style: 'destructive', onPress: onEnd },
    ]);
  };

  const lines = useMemo(() => {
    const out: Array<{ edge: DotsEdge; drawn: boolean }> = [];
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c < cols; c++) out.push({ edge: { kind: 'h', r, c }, drawn: state.h[r * cols + c] === 1 });
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c <= cols; c++) out.push({ edge: { kind: 'v', r, c }, drawn: state.v[r * (cols + 1) + c] === 1 });
    }
    return out;
  }, [rows, cols, state.h, state.v]);

  const lineFrame = (edge: DotsEdge, thickness: number) =>
    edge.kind === 'h'
      ? { left: PAD + edge.c * cell, top: PAD + edge.r * cell - thickness / 2, width: cell, height: thickness }
      : { left: PAD + edge.c * cell - thickness / 2, top: PAD + edge.r * cell, width: thickness, height: cell };

  const hitFrame = (edge: DotsEdge) =>
    edge.kind === 'h'
      ? { left: PAD + edge.c * cell + inset, top: PAD + edge.r * cell - hit / 2, width: cell - 2 * inset, height: hit }
      : { left: PAD + edge.c * cell - hit / 2, top: PAD + edge.r * cell + inset, width: hit, height: cell - 2 * inset };

  return (
    <View style={styles.panel}>
      {/* Header: scores, whose turn, end or close, fold */}
      <Pressable style={styles.header} onPress={onToggleCollapsed} accessibilityRole="button" accessibilityLabel={collapsed ? 'Show the board' : 'Hide the board'}>
        <View style={styles.scores}>
          <View style={[styles.swatch, { backgroundColor: MY_DOT }]} />
          <Text style={styles.scoreText}>You {state.scores[me] ?? 0}</Text>
          <Text style={styles.scoreSep}>·</Text>
          <View style={[styles.swatch, { backgroundColor: THEIR_DOT }]} />
          <Text style={styles.scoreText} numberOfLines={1}>
            {partnerName} {state.scores[them] ?? 0}
          </Text>
        </View>
        <Text
          style={[styles.status, status === 'active' && state.turn === me && !pending && styles.statusMine]}
          numberOfLines={1}
        >
          {statusText}
        </Text>
        {status === 'active' ? (
          <TouchableOpacity onPress={confirmEnd} style={styles.action} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
            <Text style={styles.actionText}>End</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onClose} style={styles.action} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
            <Text style={styles.actionText}>Close</Text>
          </TouchableOpacity>
        )}
        <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={18} color={colors.textMuted} />
      </Pressable>

      {!collapsed && (
        <View style={[styles.board, { width: boardWidth, height: boardHeight }]}>
          {/* Taken boxes */}
          {state.boxes.map((owner, i) => {
            if (owner === null) return null;
            const r = Math.floor(i / cols);
            const c = i % cols;
            return (
              <View
                key={`b${i}`}
                style={[
                  styles.box,
                  {
                    left: PAD + c * cell + 3,
                    top: PAD + r * cell + 3,
                    width: cell - 6,
                    height: cell - 6,
                    backgroundColor: owner === me ? MY_BOX : THEIR_BOX,
                  },
                ]}
              />
            );
          })}

          {/* Lines: drawn, the last one drawn, the one being sent, empty */}
          {lines.map(({ edge, drawn }) => {
            const isPending = sameEdge(edge, pending);
            const isLast = drawn && sameEdge(edge, state.last);
            const shown = drawn || isPending;
            return (
              <View
                key={`l${edge.kind}${edge.r}-${edge.c}`}
                pointerEvents="none"
                style={[
                  styles.line,
                  lineFrame(edge, shown ? 4 : 2),
                  { backgroundColor: isLast ? LINE_LAST : shown ? LINE : LINE_EMPTY },
                ]}
              />
            );
          })}

          {/* Dots */}
          {Array.from({ length: (rows + 1) * (cols + 1) }, (_, i) => {
            const r = Math.floor(i / (cols + 1));
            const c = i % (cols + 1);
            return (
              <View
                key={`d${i}`}
                pointerEvents="none"
                style={[styles.dot, { left: PAD + c * cell - DOT / 2, top: PAD + r * cell - DOT / 2 }]}
              />
            );
          })}

          {/* Tap areas, only for open lines on my turn */}
          {myTurn &&
            lines.map(({ edge, drawn }) =>
              drawn ? null : (
                <Pressable
                  key={`t${edge.kind}${edge.r}-${edge.c}`}
                  style={[styles.hit, hitFrame(edge)]}
                  onPress={() => onMove(edge)}
                  accessibilityLabel={`${edge.kind === 'h' ? 'Across' : 'Down'} line, row ${edge.r + 1}, column ${edge.c + 1}`}
                />
              ),
            )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  scores: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  scoreText: { ...typography.body2, color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
  scoreSep: { ...typography.body2, color: colors.textMuted },
  status: { ...typography.body2, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  statusMine: { color: colors.textPrimary, fontWeight: '700' },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  actionText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  board: { alignSelf: 'center', marginVertical: spacing.sm },
  box: { position: 'absolute', borderRadius: 4 },
  line: { position: 'absolute', borderRadius: 2 },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.textPrimary,
  },
  hit: { position: 'absolute' },
});
