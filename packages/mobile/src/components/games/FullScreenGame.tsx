import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, TextInput, KeyboardAvoidingView,
  Keyboard, BackHandler, LayoutChangeEvent, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, typography, spacing, radius } from '../../theme';
import { ConfirmModal } from '../common/ConfirmModal';

/**
 * The frame shared by the games that open full screen over a chat (Reversi,
 * Chinese Checkers): a slim bar in the chat (GameBar), and the full screen
 * itself (FullScreenGame) with the players, whose turn it is, the board as
 * large as the space allows, and the last few messages with a box to write.
 * Each game draws only its board.
 *
 * FullScreenGame is an overlay inside the chat screen, not a <Modal>, like
 * the other sheets there: the chat screen's window already handles the
 * keyboard.
 */

export interface MiniChatLine {
  id: string;
  mine: boolean;
  text: string;
}

export interface GamePlayer {
  /** The player's piece, small */
  badge: React.ReactNode;
  name: string;
  score: string;
  toMove: boolean;
}

// ─── The bar in the chat ─────────────────────────────────

interface GameBarProps {
  title: string;
  /** Me, then my partner */
  players: [GamePlayer, GamePlayer];
  statusText: string;
  myTurn: boolean;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export const GameBar: React.FC<GameBarProps> = ({ title, players, statusText, myTurn, active, onOpen, onClose }) => (
  <Pressable style={styles.bar} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${title}`}>
    <View style={styles.barScores}>
      {players[0].badge}
      <Text style={styles.barScore}>{players[0].name} {players[0].score}</Text>
      <Text style={styles.barSep}>·</Text>
      {players[1].badge}
      <Text style={styles.barScore} numberOfLines={1}>
        {players[1].name} {players[1].score}
      </Text>
    </View>
    <Text style={[styles.barStatus, myTurn && styles.barStatusMine]} numberOfLines={1}>
      {statusText}
    </Text>
    {!active && (
      <TouchableOpacity onPress={onClose} style={styles.pill} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
        <Text style={styles.pillText}>Close</Text>
      </TouchableOpacity>
    )}
    <View style={[styles.pill, styles.pillDark]}>
      <Text style={[styles.pillText, styles.pillTextDark]}>Open</Text>
    </View>
  </Pressable>
);

// ─── The full-screen game ────────────────────────────────

interface FullScreenGameProps {
  visible: boolean;
  title: string;
  active: boolean;
  /** Me, then my partner; the one to move is outlined */
  players: [GamePlayer, GamePlayer];
  statusText: string;
  /** Status in bold: it is my move */
  statusMine: boolean;
  /** Draws the board to fit the space it is given */
  renderBoard: (area: { width: number; height: number }) => React.ReactNode;
  partnerName: string;
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

export const FullScreenGame: React.FC<FullScreenGameProps> = ({
  visible, title, active, players, statusText, statusMine, renderBoard, partnerName,
  onEnd, onClose, onMinimize, recent, onSend,
}) => {
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const chatScroll = useRef<ScrollView>(null);

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
          <Text style={styles.title}>{title}</Text>
          {active ? (
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
            {players.map((p, i) => (
              <View key={i} style={[styles.player, p.toMove && styles.playerToMove]}>
                {p.badge}
                <Text style={styles.playerName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.playerScore}>{p.score}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={[styles.status, statusMine && styles.statusMine]} numberOfLines={1}>
          {statusText}
        </Text>

        {/* Board, as large as the space allows */}
        <View style={styles.boardArea} onLayout={onBoardArea}>
          {area.width > 0 && area.height > 0 ? renderBoard(area) : null}
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
