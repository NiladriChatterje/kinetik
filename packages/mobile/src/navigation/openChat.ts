import { Dimensions } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useChatPaneStore, type PaneChat } from '../store/chatPaneStore';

/**
 * From this window width (dp) the Chat tab shows the chat list and the open
 * chat side by side: tablets and unfolded foldables. Phones, which stay in
 * portrait, are all narrower.
 */
export const CHAT_SPLIT_MIN_WIDTH = 720;

export const isChatSplitWidth = (width: number) => width >= CHAT_SPLIT_MIN_WIDTH;

/**
 * Open a chat: on a phone the Chat screen is pushed; on a large screen the
 * chat opens beside the list in the Chat tab, so there is never a second
 * copy of it on top.
 */
export function openChat(navigation: any, chat: PaneChat): void {
  if (isChatSplitWidth(Dimensions.get('window').width)) {
    useChatPaneStore.getState().open(useAuthStore.getState().user?.id ?? null, chat);
    navigation.navigate('Main', { screen: 'ChatListTab' });
    return;
  }
  navigation.navigate('Chat', chat);
}

/** The chat list: the Chat tab on a large screen, the pushed list on a phone. */
export function openChatList(navigation: any): void {
  if (isChatSplitWidth(Dimensions.get('window').width)) {
    navigation.navigate('Main', { screen: 'ChatListTab' });
    return;
  }
  navigation.navigate('ChatList');
}
