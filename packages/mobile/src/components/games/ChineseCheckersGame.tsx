import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { spacing } from '../../theme';
import { FullScreenGame, GameBar, GamePlayer, MiniChatLine } from './FullScreenGame';
import { CHECKERS_BOARD, CHECKERS_PEGS } from './gameTypes';
import type { CheckersGame, CheckersMove } from './gameTypes';

/**
 * Chinese Checkers for two inside a chat. The chat shows a slim bar
 * (CheckersBar); the game opens full screen (CheckersScreen) over the chat,
 * in the same frame as Reversi (FullScreenGame).
 *
 * Each player sees their own pegs at the bottom, heading for the top: for
 * the player who did not start, the board is turned half a turn (hole i is
 * drawn where hole 120 - i is).
 *
 * The server checks every move and sends, for the player to move, each peg
 * that can move and the holes it can reach (state.legal), so the app needs
 * no copy of the rules: tap a peg, its holes light up, tap one to move
 * there. The last move's route is drawn in red so a run of jumps is easy to
 * follow.
 */

const MY_PEG = '#FF6B6B';
const THEIR_PEG = '#111111';
const HOLE = 'rgba(0, 0, 0, 0.13)';
/** Empty holes in the point I am heading for */
const MY_TARGET = 'rgba(255, 107, 107, 0.35)';
const ROUTE = '#E53935';
const SELECT_RING = '#000000';
const SQRT3 = Math.sqrt(3);

function statusLine(game: CheckersGame, myId: string, partnerName: string, pending: boolean, selected: boolean): string {
  const { state, status } = game;
  const me = state.players.indexOf(myId);
  if (status === 'finished') {
    return game.winnerId === myId ? 'You won! 🎉' : game.winnerId ? `${partnerName} won` : "It's a draw";
  }
  if (status === 'ended') return game.endedBy === myId ? 'You ended the game' : `${partnerName} ended the game`;
  if (pending) return 'Sending…';
  const mine = state.turn === me;
  if (mine && selected) return 'Tap where it should go';
  if (state.passed) {
    return mine ? `${partnerName} had no move. Your turn again` : `You had no move. ${partnerName}'s turn again`;
  }
  return mine ? 'Your turn: tap a peg' : `${partnerName}'s turn`;
}

function Peg({ mine, size }: { mine: boolean; size: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: mine ? MY_PEG : THEIR_PEG }} />;
}

function players(game: CheckersGame, myId: string, partnerName: string, badgeSize: number): [GamePlayer, GamePlayer] {
  const { state, status } = game;
  const me = state.players.indexOf(myId);
  const them = me === 0 ? 1 : 0;
  const toMove = (p: number) => status === 'active' && state.turn === p;
  return [
    { badge: <Peg mine size={badgeSize} />, name: 'You', score: `${state.scores[me] ?? 0}/${CHECKERS_PEGS}`, toMove: toMove(me) },
    { badge: <Peg mine={false} size={badgeSize} />, name: partnerName, score: `${state.scores[them] ?? 0}/${CHECKERS_PEGS}`, toMove: toMove(them) },
  ];
}

// ─── The bar in the chat ─────────────────────────────────

interface CheckersBarProps {
  game: CheckersGame;
  myId: string;
  partnerName: string;
  onOpen: () => void;
  onClose: () => void;
}

export const CheckersBar: React.FC<CheckersBarProps> = ({ game, myId, partnerName, onOpen, onClose }) => {
  const me = game.state.players.indexOf(myId);
  return (
    <GameBar
      title="Chinese Checkers"
      players={players(game, myId, partnerName, 12)}
      statusText={statusLine(game, myId, partnerName, false, false)}
      myTurn={game.status === 'active' && game.state.turn === me}
      active={game.status === 'active'}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
};

// ─── The full-screen game ────────────────────────────────

interface CheckersScreenProps {
  visible: boolean;
  game: CheckersGame;
  myId: string;
  partnerName: string;
  /** The move being sent, drawn at once */
  pending: CheckersMove | null;
  onMove: (move: CheckersMove) => void;
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

export const CheckersScreen: React.FC<CheckersScreenProps> = ({
  visible, game, myId, partnerName, pending, onMove, onEnd, onClose, onMinimize, recent, onSend,
}) => {
  const { state, status } = game;
  const me = state.players.indexOf(myId) as 0 | 1;
  const myTurn = status === 'active' && state.turn === me && !pending;
  const [selected, setSelected] = useState<number | null>(null);

  // A new position (or no longer my move) drops the peg I had picked
  useEffect(() => {
    setSelected(null);
  }, [game.id, state.moves, myTurn]);

  // Pegs I can move now, and where each can go
  const options = useMemo(() => {
    const map = new Map<number, number[]>();
    if (myTurn) for (const o of state.legal) map.set(o.from, o.to);
    return map;
  }, [myTurn, state.legal]);
  const targets = useMemo(() => new Set(selected !== null ? options.get(selected) ?? [] : []), [selected, options]);
  // The point I am heading for: the top of my view
  const myTarget = useMemo(
    () => new Set(CHECKERS_BOARD.map((_, i) => i).filter((i) => (me === 0 ? CHECKERS_BOARD[i].r <= 3 : CHECKERS_BOARD[i].r >= 13))),
    [me],
  );

  // What the board shows: the server's, with the move being sent already made
  const board = useMemo(() => {
    if (!pending) return state.board;
    const b = [...state.board];
    b[pending.from] = null;
    b[pending.to] = me;
    return b;
  }, [state.board, pending, me]);

  const renderBoard = (area: { width: number; height: number }) => {
    // u is half the distance between two holes side by side
    const u = Math.max(0, Math.min((area.width - 2 * spacing.md) / 26, (area.height - spacing.sm) / (16 * SQRT3 + 2)));
    if (u < 4) return null;
    const peg = Math.round(u * 1.55);
    const hole = Math.max(4, Math.round(u * 0.6));
    const tap = Math.floor(u * 2);
    // Where hole i is drawn (its centre), turned for the player who did not start
    const at = (i: number) => {
      const h = CHECKERS_BOARD[me === 0 ? i : 120 - i];
      return { left: (h.x + 13) * u, top: (h.r * SQRT3 + 1) * u };
    };

    const route = !pending && state.last && state.last.length > 1 ? state.last : null;
    const segments = route
      ? route.slice(1).map((to, k) => {
          const a = at(route[k]);
          const b = at(to);
          const length = Math.hypot(b.left - a.left, b.top - a.top);
          const angle = Math.atan2(b.top - a.top, b.left - a.left);
          return (
            <View
              key={`s${k}`}
              pointerEvents="none"
              style={[
                styles.segment,
                {
                  width: length,
                  left: (a.left + b.left) / 2 - length / 2,
                  top: (a.top + b.top) / 2 - 1.5,
                  transform: [{ rotate: `${angle}rad` }],
                },
              ]}
            />
          );
        })
      : null;
    const routeStart = route ? at(route[0]) : null;
    const routeEnd = route ? route[route.length - 1] : -1;

    return (
      <View style={{ width: 26 * u, height: (16 * SQRT3 + 2) * u }}>
        {segments}
        {routeStart && (
          <View
            pointerEvents="none"
            style={[styles.routeStart, { width: peg, height: peg, borderRadius: peg / 2, left: routeStart.left - peg / 2, top: routeStart.top - peg / 2 }]}
          />
        )}
        {board.map((owner, i) => {
          const { left, top } = at(i);
          const isSelected = selected === i;
          const canPick = owner === me && options.has(i);
          const isTarget = targets.has(i);
          const isPending = !!pending && pending.to === i;

          let content: React.ReactNode;
          if (owner !== null) {
            content = (
              <View
                style={[
                  {
                    width: peg,
                    height: peg,
                    borderRadius: peg / 2,
                    backgroundColor: owner === me ? MY_PEG : THEIR_PEG,
                    opacity: isPending ? 0.5 : 1,
                  },
                  isSelected && styles.pegSelected,
                  !isSelected && canPick && selected === null && styles.pegMovable,
                  i === routeEnd && styles.pegLast,
                ]}
              />
            );
          } else if (isTarget) {
            content = <View style={[styles.target, { width: peg * 0.6, height: peg * 0.6, borderRadius: peg * 0.3 }]} />;
          } else {
            content = (
              <View
                style={{
                  width: hole,
                  height: hole,
                  borderRadius: hole / 2,
                  backgroundColor: myTarget.has(i) ? MY_TARGET : HOLE,
                }}
              />
            );
          }

          const frame = { position: 'absolute' as const, left: left - tap / 2, top: top - tap / 2, width: tap, height: tap };
          if (canPick || isTarget) {
            return (
              <Pressable
                key={i}
                style={[frame, styles.center]}
                onPress={() => {
                  if (isTarget && selected !== null) onMove({ from: selected, to: i });
                  else setSelected(isSelected ? null : i);
                }}
                accessibilityRole="button"
                accessibilityLabel={isTarget ? 'Move here' : isSelected ? 'Your peg, picked' : 'Your peg'}
              >
                {content}
              </Pressable>
            );
          }
          return (
            <View key={i} style={[frame, styles.center]} pointerEvents="none">
              {content}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <FullScreenGame
      visible={visible}
      title="Chinese Checkers"
      active={status === 'active'}
      players={players(game, myId, partnerName, 18)}
      statusText={statusLine(game, myId, partnerName, !!pending, selected !== null)}
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
  center: { alignItems: 'center', justifyContent: 'center' },
  pegMovable: { borderWidth: 2, borderColor: 'rgba(0, 0, 0, 0.45)' },
  pegSelected: { borderWidth: 3, borderColor: SELECT_RING, transform: [{ scale: 1.12 }] },
  pegLast: { borderWidth: 2.5, borderColor: ROUTE },
  target: { backgroundColor: MY_PEG, borderWidth: 2, borderColor: SELECT_RING },
  segment: { position: 'absolute', height: 3, borderRadius: 1.5, backgroundColor: ROUTE, opacity: 0.8 },
  routeStart: { position: 'absolute', borderWidth: 2, borderColor: ROUTE, borderStyle: 'dashed' },
});
