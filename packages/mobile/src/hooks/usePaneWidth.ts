import React, { useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * The width a screen is drawn in. A screen shown in a pane (the chat beside
 * the chat list on large screens) gets the pane's width through the
 * provider; everywhere else it is the window's width.
 */
export const PaneWidthContext = React.createContext<number | null>(null);

export function usePaneWidth(): number {
  const pane = useContext(PaneWidthContext);
  const { width } = useWindowDimensions();
  return pane ?? width;
}
