import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ExploreScreen } from './ExploreScreen';
import { LikeListScreen } from './LikeListScreen';
import { PaneWidthContext } from '../../hooks/usePaneWidth';
import { isSplitWidth, splitListWidth } from '../../navigation/splitLayout';
import { colors } from '../../theme';

/**
 * The Explore tab. On a phone it is the Explore grid. On a large screen
 * (tablet, unfolded foldable) the grid stays on the left and the Likes list
 * sits beside it on the right, so the people nearby and the people who
 * liked you are in view together. The Match tab still opens Likes on its own.
 *
 * The grid is always the first child, so it stays mounted (loaded pages and
 * scroll position kept) when the screen grows or shrinks across the split,
 * e.g. a foldable being opened or closed.
 */
export const ExploreSplitScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { width } = useWindowDimensions();
  const split = isSplitWidth(width);
  const likesWidth = splitListWidth(width);

  return (
    <View style={styles.row}>
      <View style={styles.main}>
        <PaneWidthContext.Provider value={split ? width - likesWidth : null}>
          <ExploreScreen navigation={navigation} />
        </PaneWidthContext.Provider>
      </View>
      {split ? (
        <View style={[styles.side, { width: likesWidth }]}>
          <PaneWidthContext.Provider value={likesWidth}>
            <LikeListScreen navigation={navigation} />
          </PaneWidthContext.Provider>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  main: { flex: 1 },
  side: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.surfaceHighlight },
});
