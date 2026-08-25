import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDmSuggestions, heuristicSuggestions, SuggestionMessage } from '../../services/dmSuggestions';
import { useAuthStore } from '../../store/authStore';
import { colors, typography, spacing, radius } from '../../theme';

interface Props {
  messages: SuggestionMessage[];
  partnerName: string;
  /** Hidden while the user is composing — suggestions are ambient, not pushy */
  visible: boolean;
  /** Tap inserts into the input; sending stays a deliberate user action */
  onPick: (text: string) => void;
}

/** Regenerate at most this often, even if messages keep arriving. */
const MIN_REGEN_INTERVAL_MS = 20000;
/** Let a burst of incoming messages settle before regenerating. */
const DEBOUNCE_MS = 2500;

/**
 * Ambient reply suggestions above the DM input. They refresh quietly as the
 * conversation evolves (screen open + new incoming messages, debounced and
 * rate-limited), so when the user runs out of things to say, ideas are
 * already there. Tap to insert — never auto-send.
 */
export const DmSuggestionChips: React.FC<Props> = ({ messages, partnerName, visible, onPick }) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const lastRunAtRef = useRef(0);
  const hasContextRunRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const myUserId = useAuthStore((s) => s.user?.id) || '';

  // Key that changes only when the conversation meaningfully advances:
  // a new last message (either side) — not on read receipts or re-renders.
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const convoKey = `${messages.length}:${lastMessage?.senderId ?? ''}`;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const run = async () => {
      lastRunAtRef.current = Date.now();
      // Instant heuristic fill, then the LLM result (when available)
      // replaces it — chips are never missing while the model thinks.
      if (aliveRef.current) setSuggestions(heuristicSuggestions(messages, myUserId, partnerName));
      const next = await getDmSuggestions(messages, myUserId, partnerName);
      if (aliveRef.current) setSuggestions(next);
    };

    // Entering the DM: messages are empty until the history fetch lands, so
    // the FIRST run over real history fires immediately — that's the
    // "user opened the chat, read the last 20, suggest now" moment. A truly
    // empty chat waits a beat (grace for the fetch) then shows openers.
    // Everything after is debounced and rate-limited so bursts of messages
    // cost a single generation.
    let delay: number;
    if (!hasContextRunRef.current && messages.length > 0) {
      hasContextRunRef.current = true;
      delay = 0;
    } else if (lastRunAtRef.current === 0) {
      delay = messages.length === 0 ? 1500 : 0;
    } else {
      const sinceLast = Date.now() - lastRunAtRef.current;
      delay = Math.max(DEBOUNCE_MS, MIN_REGEN_INTERVAL_MS - sinceLast);
    }
    debounceRef.current = setTimeout(run, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoKey, partnerName, myUserId]);

  if (!visible || suggestions.length === 0) return null;

  return (
    <View style={styles.row}>
      <Ionicons name="sparkles-outline" size={14} color={colors.textMuted} style={styles.icon} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {suggestions.map((s) => (
          <TouchableOpacity key={s} style={styles.chip} onPress={() => onPick(s)} activeOpacity={0.7}>
            <Text style={styles.chipText} numberOfLines={1}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  icon: { marginRight: spacing.xs },
  chip: {
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginRight: spacing.sm,
    maxWidth: 280,
  },
  chipText: { ...typography.caption, color: colors.textSecondary },
});
