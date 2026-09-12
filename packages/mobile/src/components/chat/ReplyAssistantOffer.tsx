import React from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useReplyAssistant } from '../../hooks/useReplyAssistant';
import { dismissOffer, formatBytes } from '../../services/replyAssistant';
import { colors, typography, spacing, radius } from '../../theme';

interface Props {
  /** How far the conversation has got; the offer waits until people are talking. */
  messageCount: number;
  /** Hidden while the user is composing, like the chips. */
  visible: boolean;
}

/** Only offer once the chat is actually going — not on "hi". */
const MIN_MESSAGES_BEFORE_OFFER = 6;

/**
 * One-line offer above the input to fetch the on-device reply assistant,
 * shown once a conversation has some history. Tapping it opens the
 * settings screen that explains the download and starts it; "Not now"
 * hides it in every chat (the Profile row stays). While a download is
 * running or paused the same line shows its progress instead.
 */
export const ReplyAssistantOffer: React.FC<Props> = ({ messageCount, visible }) => {
  const navigation = useNavigation();
  const state = useReplyAssistant();

  if (!visible) return null;

  const open = () => navigation.navigate('ReplyAssistant' as never);

  if (state.phase === 'downloading' || state.phase === 'paused') {
    const pct = Math.round(state.progress * 100);
    return (
      <TouchableOpacity style={styles.row} onPress={open} activeOpacity={0.7}>
        <Ionicons
          name={state.phase === 'paused' ? 'pause-circle-outline' : 'cloud-download-outline'}
          size={14}
          color={colors.textMuted}
        />
        <Text style={styles.text} numberOfLines={1}>
          {state.phase === 'paused'
            ? `Reply assistant download paused at ${pct}% · tap to resume`
            : `Downloading reply assistant · ${pct}%`}
        </Text>
      </TouchableOpacity>
    );
  }

  if (state.phase !== 'not_downloaded' || state.offerDismissed || messageCount < MIN_MESSAGES_BEFORE_OFFER) {
    return null;
  }

  return (
    <View style={styles.row}>
      <Ionicons name="sparkles-outline" size={14} color={colors.textMuted} />
      <Text style={styles.text} numberOfLines={2}>
        Want sharper reply ideas? Add the on-device assistant ({formatBytes(state.totalBytes)}, one time).
      </Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={open} activeOpacity={0.7} hitSlop={6}>
        <Text style={styles.primaryText}>Get it</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => void dismissOffer()} activeOpacity={0.7} hitSlop={8}>
        <Text style={styles.dismissText}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  primaryText: { ...typography.caption, color: colors.textInverse, fontWeight: '600' },
  dismissText: { ...typography.caption, color: colors.textMuted },
});
