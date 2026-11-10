import { Dimensions } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useChatPaneStore, type PaneChat } from '../store/chatPaneStore';
import { isSplitWidth } from './splitLayout';

/**
 * Open a chat: on a phone the Chat screen is pushed; on a large screen the
 * chat opens beside the list in the Chat tab, so there is never a second
 * copy of it on top.
 */
export function openChat(navigation: any, chat: PaneChat): void {
  if (isSplitWidth(Dimensions.get('window').width)) {
    useChatPaneStore.getState().open(useAuthStore.getState().user?.id ?? null, chat);
    navigation.navigate('Main', { screen: 'ChatListTab' });
    return;
  }
  navigation.navigate('Chat', chat);
}

/** The chat list: the Chat tab on a large screen, the pushed list on a phone. */
export function openChatList(navigation: any): void {
  if (isSplitWidth(Dimensions.get('window').width)) {
    navigation.navigate('Main', { screen: 'ChatListTab' });
    return;
  }
  navigation.navigate('ChatList');
}
