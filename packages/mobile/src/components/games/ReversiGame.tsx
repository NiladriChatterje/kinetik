import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { spacing, radius } from '../../theme';
import { FullScreenGame, GameBar, GamePlayer, MiniChatLine } from './FullScreenGame';
import type { ReversiCell, ReversiGame } from './gameTypes';

export type { MiniChatLine } from './FullScreenGame';

/**
 * Reversi inside a chat. The chat shows a slim bar (ReversiBar); the game
 * itself opens full screen (ReversiScreen) over the chat, with the last few
 * messages and a box to write under the board (the frame is FullScreenGame).
 *
 * The server checks every move and sends the squares the player to move may
 * take (state.legal), so the app needs no copy of the rules: it marks those
 * squares and sends the one tapped.
 */

const ROSE = '#FF6B6B';
const BOARD_BG = '#F3F3F3';
const GRID = 'rgba(0, 0, 0, 0.08)';
const BLACK_DISC = '#111111';
const WHITE_DISC = '#FFFFFF';
const WHITE_EDGE = '#BDBDBD';

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

function players(game: ReversiGame, myId: string, partnerName: string, badgeSize: number): [GamePlayer, GamePlayer] {
  const { state, status } = game;
  const me = state.players.indexOf(myId);
  const them = me === 0 ? 1 : 0;
  const toMove = (p: number) => status === 'active' && state.turn === p;
  return [
    { badge: <Disc owner={me as 0 | 1} size={badgeSize} />, name: 'You', score: String(state.scores[me] ?? 0), toMove: toMove(me) },
    { badge: <Disc owner={them as 0 | 1} size={badgeSize} />, name: partnerName, score: String(state.scores[them] ?? 0), toMove: toMove(them) },
  ];
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
  const me = game.state.players.indexOf(myId);
  return (
    <GameBar
      title="Reversi"
      players={players(game, myId, partnerName, 12)}
      statusText={statusLine(game, myId, partnerName, false)}
      myTurn={game.status === 'active' && game.state.turn === me}
      active={game.status === 'active'}
      onOpen={onOpen}
      onClose={onClose}
    />
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
  const { state, status } = game;
  const me = state.players.indexOf(myId);
  const myTurn = status === 'active' && state.turn === me && !pending;
  const legal = useMemo(() => new Set(myTurn ? state.legal : []), [myTurn, state.legal]);
  const lastIndex = state.last ? state.last.r * state.size + state.last.c : -1;

  const renderBoard = (area: { width: number; height: number }) => {
    const boardSize = Math.max(0, Math.floor(Math.min(area.width - 2 * spacing.lg, area.height - spacing.md)));
    const cell = Math.floor(boardSize / state.size);
    const disc = Math.round(cell * 0.78);
    if (cell <= 0) return null;
    return (
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
    );
  };

  return (
    <FullScreenGame
      visible={visible}
      title="Reversi"
      active={status === 'active'}
      players={players(game, myId, partnerName, 18)}
      statusText={statusLine(game, myId, partnerName, !!pending)}
      statusMine={myTurn}
      renderBoard={renderBoard}
      partnerName={partnerName}
      onEnd={onEnd}
      onClose={onClose}
      onMinimize={onMinimize}
      recent={recent}
      onSend={onSend}
    />
  );
};

const styles = StyleSheet.create({
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
});
