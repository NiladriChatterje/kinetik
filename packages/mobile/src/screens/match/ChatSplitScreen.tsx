import React, { useCallback, useEffect, useMemo } from 'react';
import { BackHandler, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ChatListScreen } from './ChatListScreen';
import { ChatScreen } from './ChatScreen';
import { useAuthStore } from '../../store/authStore';
import { useChatPaneStore, type PaneChat } from '../../store/chatPaneStore';
import { PaneWidthContext } from '../../hooks/usePaneWidth';
import { isChatSplitWidth } from '../../navigation/openChat';
import { colors, spacing, typography } from '../../theme';

/**
 * The Chat tab. On a phone it is the chat list, and a chat opens as its own
 * screen. On a large screen (tablet, unfolded foldable) the list stays on
 * the left and the chat opens on the right.
 *
 * The chat on the right is kept only while the Chat tab is the tab in use
 * (a screen opened over the tabs, like the partner's profile, keeps it), so
 * a chat left behind in another tab never marks new messages read or hides
 * them from the badge.
 */
export const ChatSplitScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { width } = useWindowDimensions();
  const split = isChatSplitWidth(width);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const ownerId = useChatPaneStore((s) => s.ownerId);
  const storedChat = useChatPaneStore((s) => s.chat);
  // A chat picked by another account on this device is not this one's
  const chat = storedChat && ownerId === userId ? storedChat : null;
  const tabInUse = useNavigationState((s) => s?.routes?.[s.index]?.name === 'ChatListTab');

  const openInPane = useCallback((c: PaneChat) => {
    useChatPaneStore.getState().open(userId, c);
  }, [userId]);
  const closePane = useCallback(() => useChatPaneStore.getState().close(), []);

  // The screen got narrow with a chat open (a foldable folded): carry on
  // with it as a phone does, on its own screen
  useEffect(() => {
    if (split || !chat || !tabInUse) return;
    useChatPaneStore.getState().close();
    navigation.navigate('Chat', chat);
  }, [split, chat, tabInUse, navigation]);

  // Back closes the open chat first, then works as usual. A game or sheet
  // inside the chat registers later, so it still answers back before this.
  useEffect(() => {
    if (!split || !chat || !tabInUse) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      useChatPaneStore.getState().close();
      return true;
    });
    return () => sub.remove();
  }, [split, chat, tabInUse, navigation]);

  const listWidth = Math.round(Math.min(400, Math.max(300, width * 0.36)));
  const paneRoute = useMemo(() => (chat ? { key: `pane-${chat.matchId}`, name: 'Chat', params: chat } : null), [chat]);

  if (!split) return <ChatListScreen navigation={navigation} />;

  return (
    <View style={styles.row}>
      <View style={[styles.list, { width: listWidth }]}>
        <ChatListScreen navigation={navigation} onOpenChat={openInPane} selectedMatchId={chat?.matchId} />
      </View>
      <View style={styles.pane}>
        {chat && paneRoute && tabInUse ? (
          <PaneWidthContext.Provider value={width - listWidth}>
            <ChatScreen key={chat.matchId} navigation={navigation} route={paneRoute} onClose={closePane} />
          </PaneWidthContext.Provider>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={56} color={colors.textMuted} />
            <Text style={styles.emptyText}>Pick a chat to open it here</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  list: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.surfaceHighlight },
  pane: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyText: { ...typography.body1, color: colors.textMuted, textAlign: 'center' },
});
