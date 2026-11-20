import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { StackActions, useNavigationState } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { create } from 'zustand';
import { ProfileLedgerScreen } from './ProfileLedgerScreen';
import { EditProfileScreen } from './EditProfileScreen';
import { SubscriptionCheckoutScreen } from './SubscriptionCheckoutScreen';
import { BillingHistoryScreen } from './BillingHistoryScreen';
import { NotificationPreferencesScreen } from '../settings/NotificationPreferencesScreen';
import { PrivacyScreen } from '../settings/PrivacyScreen';
import { PaneEmptyState, PaneShortcut } from '../../components/common/PaneEmptyState';
import { PaneWidthContext } from '../../hooks/usePaneWidth';
import { isSplitWidth, splitListWidth } from '../../navigation/splitLayout';
import { colors } from '../../theme';
import { useTabBarSpace } from '../../navigation/FloatingTabBar';

/**
 * The Profile tab. On a phone it is the profile page, and its settings open
 * as screens of their own. On a large screen (tablet, unfolded foldable) the
 * profile page stays on the left and a picked setting opens on the right;
 * until one is picked the right says so.
 *
 * The right side is a small stack of its own, so each page works there as it
 * does full screen: its back button and Android back return to the empty
 * state, Subscription's "Show more" opens Billing history in the same pane,
 * and Edit profile still asks before dropping unsaved changes.
 */

export type ProfilePage = 'EditProfile' | 'NotificationPreferences' | 'Privacy' | 'SubscriptionCheckout';

type PaneParamList = {
  PaneHome: undefined;
  EditProfile: undefined;
  NotificationPreferences: undefined;
  Privacy: undefined;
  SubscriptionCheckout: undefined;
  BillingHistory: undefined;
};

const PaneStack = createStackNavigator<PaneParamList>();

// The page open on the right, for the mark on the left and for carrying it
// on full screen when the screen gets narrow
const usePaneStore = create<{ page: ProfilePage | null; setPage: (p: ProfilePage | null) => void }>((set) => ({
  page: null,
  setPage: (page) => set({ page }),
}));

// The pane stack's navigation, held by its first screen while it is mounted
let paneNavigation: any = null;

const pageOf = (name: string | undefined): ProfilePage | null =>
  name === 'BillingHistory' ? 'SubscriptionCheckout' : (name as ProfilePage | undefined) ?? null;

/** Open a page on the right, in place of the one there now. */
function openPage(page: ProfilePage): void {
  const nav = paneNavigation;
  if (!nav) return;
  const state = nav.getState();
  const top = state.routes[state.index];
  if (top?.name === page) return;
  if (state.index === 0) {
    nav.navigate(page);
    return;
  }
  // Billing history over Subscription: back to Subscription first
  if (state.index > 1) {
    nav.dispatch({ ...StackActions.pop(state.index - 1), source: top.key, target: state.key });
  }
  // A replace (not a reset) so Edit profile's unsaved-changes question still
  // comes up; it goes on to the new page when the edits are dropped
  nav.dispatch({ ...StackActions.replace(page), source: state.routes[1].key, target: state.key });
}

const SHORTCUTS: { page: ProfilePage; icon: React.ComponentProps<typeof PaneShortcut>['icon']; label: string }[] = [
  { page: 'EditProfile', icon: 'create-outline', label: 'Edit profile' },
  { page: 'NotificationPreferences', icon: 'notifications-outline', label: 'Notifications' },
  { page: 'Privacy', icon: 'lock-closed-outline', label: 'Privacy' },
  { page: 'SubscriptionCheckout', icon: 'card-outline', label: 'Subscription' },
];

/** The bottom of the pane stack: nothing picked yet. */
const PaneHome: React.FC<{ navigation: any }> = ({ navigation }) => {
  useEffect(() => {
    paneNavigation = navigation;
    usePaneStore.getState().setPage(null);
    const unsubscribe = navigation.addListener('state', (e: any) => {
      const state = e?.data?.state;
      usePaneStore.getState().setPage(state && state.index > 0 ? pageOf(state.routes[state.index]?.name) : null);
    });
    return () => {
      unsubscribe();
      if (paneNavigation === navigation) paneNavigation = null;
    };
  }, [navigation]);

  return (
    <PaneEmptyState
      icon="settings-outline"
      title="Nothing selected yet"
      text="Pick a setting on the left to see it here, or jump straight in:"
    >
      {SHORTCUTS.map((s) => (
        <PaneShortcut key={s.page} icon={s.icon} label={s.label} onPress={() => openPage(s.page)} />
      ))}
    </PaneEmptyState>
  );
};

const paneScreenOptions = {
  headerShown: false,
  cardStyle: { backgroundColor: colors.background },
  gestureEnabled: false,
};

export const ProfileSplitScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { width } = useWindowDimensions();
  const split = isSplitWidth(width);
  const page = usePaneStore((s) => s.page);
  const tabInUse = useNavigationState((s) => s?.routes?.[s.index]?.name === 'Profile');
  // Pages on the right end above the floating tab pill, so their buttons are
  // never under it (the pill hides while typing, and so does this gap)
  const tabSpace = useTabBarSpace({ dropWhileTyping: true });

  // The screen got narrow with a page open (a foldable folded): carry on
  // with it full screen, as on a phone
  useEffect(() => {
    if (split || !page || !tabInUse) return;
    usePaneStore.getState().setPage(null);
    navigation.navigate(page);
  }, [split, page, tabInUse, navigation]);

  const onOpenPage = useCallback((p: ProfilePage) => openPage(p), []);

  if (!split) return <ProfileLedgerScreen />;

  const listWidth = splitListWidth(width);
  return (
    <View style={styles.row}>
      <View style={[styles.list, { width: listWidth }]}>
        <PaneWidthContext.Provider value={listWidth}>
          <ProfileLedgerScreen onOpenPage={onOpenPage} openPage={page} />
        </PaneWidthContext.Provider>
      </View>
      <View style={[styles.pane, { paddingBottom: tabSpace }]}>
        <PaneWidthContext.Provider value={width - listWidth}>
          <PaneStack.Navigator initialRouteName="PaneHome" screenOptions={paneScreenOptions}>
            <PaneStack.Screen name="PaneHome" component={PaneHome} />
            <PaneStack.Screen name="EditProfile" component={EditProfileScreen} />
            <PaneStack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
            <PaneStack.Screen name="Privacy" component={PrivacyScreen} />
            <PaneStack.Screen name="SubscriptionCheckout" component={SubscriptionCheckoutScreen} />
            <PaneStack.Screen name="BillingHistory" component={BillingHistoryScreen} />
          </PaneStack.Navigator>
        </PaneWidthContext.Provider>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  list: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.surfaceHighlight },
  pane: { flex: 1 },
});
