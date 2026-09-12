import { useEffect, useState } from 'react';
import {
  getReplyAssistantState,
  subscribeReplyAssistant,
  ReplyAssistantState,
} from '../services/replyAssistant';

/** Live state of the on-device reply assistant download. */
export function useReplyAssistant(): ReplyAssistantState {
  const [state, setState] = useState<ReplyAssistantState>(getReplyAssistantState);
  useEffect(() => subscribeReplyAssistant(setState), []);
  return state;
}
