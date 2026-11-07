import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, TextInput, KeyboardAvoidingView,
  Keyboard, BackHandler, LayoutChangeEvent, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, typography, spacing, radius } from '../../theme';
import { ConfirmModal } from '../common/ConfirmModal';
import type { ReversiCell, ReversiGame } from './gameTypes';

/**
 * Reversi inside a chat. The chat shows a slim bar (ReversiBar); the game
 * itself opens full screen (ReversiScreen) over the chat, with the last few
 * messages and a box to write under the board.
 *
 * The server checks every move and sends the squares the player to move may
 * take (state.legal), so the app needs no copy of the rules: it marks those
 * squares and sends the one tapped.
 *
 * ReversiScreen is an overlay inside the chat screen, not a <Modal>, like the
 * other sheets there: the chat screen's window already handles the keyboard.
 */

const ROSE = '#FF6B6B';
const BOARD_BG = '#F3F3F3';
const GRID = 'rgba(0, 0, 0, 0.08)';
const BLACK_DISC = '#111111';
const WHITE_DISC = '#FFFFFF';
const WHITE_EDGE = '#BDBDBD';

export interface MiniChatLine {
  id: string;
  mine: boolean;
  text: string;
}

function statusLine(game: ReversiGame, myId: string, partnerName: string, pending: boolean): string {
  const { state, status } = game;
  const me = state.players.indexOf(myId);
  if (status === 'finished') {
    return game.winnerId === myId ? 'You won! 🎉' : game.winnerId ? `${partnerName} won` : "It's a draw";
  }
  if (status === 'ended') return game.endedBy === myId ? 'You ended the game' : `${partnerName} ended the game`;
  if (pending) return 'Sending…';
  const mine = state.turn === me;
  if (state.passed) {
    return mine ? `${partnerName} had no move. Your turn again` : `You had no move. ${partnerName}'s turn again`;
  }
  return mine ? 'Your turn' : `${partnerName}'s turn`;
}

function Disc({ owner, size }: { owner: 0 | 1; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: owner === 0 ? BLACK_DISC : WHITE_DISC,
        borderWidth: owner === 0 ? 0 : 1.5,
        borderColor: WHITE_EDGE,
      }}
    />
  );
}

// ─── The bar in the chat ─────────────────────────────────

interface ReversiBarProps {
  game: ReversiGame;
  myId: string;
  partnerName: string;
  onOpen: () => void;
  onClose: () => void;
}

export const ReversiBar: React.FC<ReversiBarProps> = ({ game, myId, partnerName, onOpen, onClose }) => {
  const { state, status } = game;
  const me = state.players.indexOf(myId);
  const them = me === 0 ? 1 : 0;
  const myTurn = status === 'active' && state.turn === me;
  return (
    <Pressable style={styles.bar} onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open Reversi">
      <View style={styles.barScores}>
        <Disc owner={me as 0 | 1} size={12} />
        <Text style={styles.barScore}>You {state.scores[me] ?? 0}</Text>
        <Text style={styles.barSep}>·</Text>
        <Disc owner={them as 0 | 1} size={12} />
        <Text style={styles.barScore} numberOfLines={1}>
          {partnerName} {state.scores[them] ?? 0}
        </Text>
      </View>
      <Text style={[styles.barStatus, myTurn && styles.barStatusMine]} numberOfLines={1}>
        {statusLine(game, myId, partnerName, false)}
      </Text>
      {status !== 'active' && (
        <TouchableOpacity onPress={onClose} style={styles.pill} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
          <Text style={styles.pillText}>Close</Text>
        </TouchableOpacity>
      )}
      <View style={[styles.pill, styles.pillDark]}>
        <Text style={[styles.pillText, styles.pillTextDark]}>Open</Text>
      </View>
    </Pressable>
  );
};

// ─── The full-screen game ────────────────────────────────

interface ReversiScreenProps {
  visible: boolean;
  game: ReversiGame;
  myId: string;
  partnerName: string;
  /** The square being sent, drawn at once */
  pending: ReversiCell | null;
  onMove: (cell: ReversiCell) => void;
  onEnd: () => void;
  /** Close a finished game (it leaves the chat) */
  onClose: () => void;
  /** Back to the chat; the game stays where it is */
  onMinimize: () => void;
  /** The last few messages of the chat, oldest first */
  recent: MiniChatLine[];
  /** Sends a message; false when it was not taken (one still sending) */
  onSend: (text: string) => boolean;
}

export const ReversiScreen: React.FC<ReversiScreenProps> = ({
  visible, game, myId, partnerName, pending, onMove, onEnd, onClose, onMinimize, recent, onSend,
}) => {
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const chatScroll = useRef<ScrollView>(null);

  const { state, status } = game;
  const me = state.players.indexOf(myId);
  const them = me === 0 ? 1 : 0;
  const myTurn = status === 'active' && state.turn === me && !pending;
  const legal = useMemo(() => new Set(myTurn ? state.legal : []), [myTurn, state.legal]);
  const lastIndex = state.last ? state.last.r * state.size + state.last.c : -1;

  // Android back returns to the chat
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onMinimize();
      return true;
    });
    return () => sub.remove();
  }, [visible, onMinimize]);

  // While writing, the players row steps aside so the board keeps its room
  useEffect(() => {
    if (!visible) return;
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  // Newest message in view
  useEffect(() => {
    if (visible) chatScroll.current?.scrollToEnd({ animated: false });
  }, [visible, recent]);

  if (!visible) return null;

  const onBoardArea = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };
  const boardSize = Math.max(0, Math.floor(Math.min(area.width - 2 * spacing.lg, area.height - spacing.md)));
  const cell = Math.floor(boardSize / state.size);
  const disc = Math.round(cell * 0.78);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (onSend(text)) setDraft('');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onMinimize} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Back to the chat">
            <Ionicons name="chevron-down" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Reversi</Text>
          {status === 'active' ? (
            <TouchableOpacity onPress={() => setConfirmEnd(true)} style={styles.pill} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
              <Text style={styles.pillText}>End</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onClose} style={styles.pill} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
              <Text style={styles.pillText}>Close</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Players: the one to move is outlined */}
        {!typing && (
          <View style={styles.players}>
            {[me, them].map((p, i) => {
              const toMove = status === 'active' && state.turn === p;
              return (
                <View key={i} style={[styles.player, toMove && styles.playerToMove]}>
                  <Disc owner={p as 0 | 1} size={18} />
                  <Text style={styles.playerName} numberOfLines={1}>{i === 0 ? 'You' : partnerName}</Text>
                  <Text style={styles.playerScore}>{state.scores[p] ?? 0}</Text>
                </View>
              );
            })}
          </View>
        )}
        <Text style={[styles.status, myTurn && styles.statusMine]} numberOfLines={1}>
          {statusLine(game, myId, partnerName, !!pending)}
        </Text>

        {/* Board, as large as the space allows */}
        <View style={styles.boardArea} onLayout={onBoardArea}>
          {cell > 0 && (
            <View style={[styles.board, { width: cell * state.size, height: cell * state.size }]}>
              {state.board.map((owner, i) => {
                const r = Math.floor(i / state.size);
                const c = i % state.size;
                const isPending = !!pending && pending.r === r && pending.c === c;
                const shown = isPending ? (me as 0 | 1) : owner;
                const canPlay = legal.has(i);
                const square = (
                  <View style={[styles.square, { width: cell, height: cell }]}>
                    {shown !== null ? (
                      <View style={{ opacity: isPending ? 0.5 : 1 }}>
                        <Disc owner={shown} size={disc} />
                        {i === lastIndex && <View style={[styles.lastMark, { top: disc / 2 - 3, left: disc / 2 - 3 }]} />}
                      </View>
                    ) : canPlay ? (
                      <View style={styles.hint} />
                    ) : null}
                  </View>
                );
                return canPlay ? (
                  <Pressable
                    key={i}
                    onPress={() => onMove({ r, c })}
                    style={{ position: 'absolute', left: c * cell, top: r * cell }}
                    accessibilityLabel={`Play row ${r + 1}, column ${c + 1}`}
                  >
                    {square}
                  </Pressable>
                ) : (
                  <View key={i} style={{ position: 'absolute', left: c * cell, top: r * cell }}>
                    {square}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* The chat, small: the last few messages and a box to write */}
        <View style={styles.chat}>
          <ScrollView ref={chatScroll} style={styles.chatLines} contentContainerStyle={styles.chatLinesContent} keyboardShouldPersistTaps="handled">
            {recent.length === 0 ? (
              <Text style={styles.chatEmpty}>Say something while you play</Text>
            ) : (
              recent.map((line) => (
                <View key={line.id} style={[styles.bubble, line.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, line.mine && styles.bubbleTextMine]} numberOfLines={3}>
                    {line.text}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={`Message ${partnerName}`}
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !draft.trim() && styles.sendBtnOff]}
              onPress={send}
              disabled={!draft.trim()}
              accessibilityLabel="Send"
            >
              <Ionicons name="arrow-up" size={18} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={confirmEnd}
        title="End this game?"
        message="It ends for both of you."
        keepLabel="Keep playing"
        confirmLabel="End game"
        onDismiss={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          onEnd();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The bar in the chat
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  barScores: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  barScore: { ...typography.body2, color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
  barSep: { ...typography.body2, color: colors.textMuted },
  barStatus: { ...typography.body2, color: colors.textSecondary, flex: 1, textAlign: 'right' },
  barStatusMine: { color: colors.textPrimary, fontWeight: '700' },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },
  pillDark: { backgroundColor: colors.primary },
  pillText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  pillTextDark: { color: colors.textInverse },

  // The full-screen game
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    zIndex: 900,
    elevation: 900,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceHighlight,
  },
  title: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  players: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  player: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    backgroundColor: colors.surface,
  },
  playerToMove: { borderColor: colors.textPrimary, backgroundColor: colors.background },
  playerName: { ...typography.body1, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  playerScore: { ...typography.h3, color: colors.textPrimary },
  status: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  statusMine: { color: colors.textPrimary, fontWeight: '700' },
  boardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  board: {
    backgroundColor: BOARD_BG,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  square: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GRID,
  },
  hint: { width: 10, height: 10, borderRadius: 5, backgroundColor: ROSE, opacity: 0.7 },
  lastMark: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: ROSE },
  chat: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chatLines: { maxHeight: 132 },
  chatLinesContent: { gap: 6, paddingBottom: spacing.sm },
  chatEmpty: { ...typography.body2, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm },
  bubble: { maxWidth: '80%', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.lg },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: colors.surfaceHighlight },
  bubbleText: { ...typography.body2, color: colors.textPrimary },
  bubbleTextMine: { color: colors.textInverse },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: {
    ...typography.body1,
    flex: 1,
    color: colors.textPrimary,
    backgroundColor: colors.inputBg,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 96,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.35 },
});
