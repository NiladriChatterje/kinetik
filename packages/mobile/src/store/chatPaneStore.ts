import { create } from 'zustand';

/**
 * The chat open in the right-hand pane of the Chat tab on large screens
 * (tablets, unfolded foldables): see ChatSplitScreen. Phones never use it;
 * they push the Chat screen. The owner is kept so a chat picked by one
 * account is never shown to the next one signed in on the same device.
 */
export interface PaneChat {
  matchId: string;
  partnerName: string;
  partnerId?: string;
  partnerPhotoUrl?: string;
  partnerThumbnailUrl?: string;
  locked?: boolean;
}

interface ChatPaneState {
  ownerId: string | null;
  chat: PaneChat | null;
  open: (ownerId: string | null, chat: PaneChat) => void;
  close: () => void;
}

export const useChatPaneStore = create<ChatPaneState>((set) => ({
  ownerId: null,
  chat: null,
  open: (ownerId, chat) => set({ ownerId, chat }),
  close: () => set({ ownerId: null, chat: null }),
}));
