import React from 'react';
import { ActivityIndicator, View, StyleSheet, Text } from 'react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { colors, typography } from '../theme';

/** Tab icon with a count badge — used by the Match and Chat tabs */
function TabIcon({
  icon,
  count,
  color,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  count: number;
  color: string;
}) {
  return (
    <View style={{ position: 'relative' }}>
      <Ionicons name={icon} size={22} color={color} />
      {count > 0 && (
        <View style={{
          position: 'absolute',
          top: -6,
          right: -8,
          backgroundColor: '#FF6B6B',
          minWidth: 18,
          height: 18,
          borderRadius: 9,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 3,
        }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Tab icon with badge for the Match tab — shows incoming like count */
function MatchTabIcon({ color }: { color: string }) {
  const unreadLikeCount = useAuthStore((s) => s.unreadLikeCount);
  return <TabIcon icon="heart-outline" count={unreadLikeCount} color={color} />;
}

/** Tab icon with badge for the Chat tab — shows incoming unread message count */
function ChatTabIcon({ color }: { color: string }) {
  const unreadChatCount = useAuthStore((s) => s.unreadChatCount);
  return <TabIcon icon="chatbubbles-outline" count={unreadChatCount} color={color} />;
}

// ─── Screen Imports ─────────────────────────────────────
// Onboarding
import { SplashScreen } from '../screens/onboarding/SplashScreen';
import { OTPVerifyScreen } from '../screens/onboarding/OTPVerifyScreen';
import { IdentityScreen } from '../screens/onboarding/IdentityScreen';
import { AboutYouScreen } from '../screens/onboarding/AboutYouScreen';
import { LocationPermissionScreen } from '../screens/onboarding/LocationPermissionScreen';
import { PhotoUploadScreen } from '../screens/onboarding/PhotoUploadScreen';
// Lazy-load to defer NitroModules / react-native-fast-tflite native init
const FaceVerificationScreen = React.lazy(
  () => import('../screens/onboarding/FaceVerificationScreen').then(m => ({ default: m.FaceVerificationScreen })),
);
import { KYCScreen } from '../screens/onboarding/KYCScreen';

// Preferences
import { FilterConstraintsScreen } from '../screens/preferences/FilterConstraintsScreen';
import { ValueMatrixScreen } from '../screens/preferences/ValueMatrixScreen';
import { PriorityWeightingScreen } from '../screens/preferences/PriorityWeightingScreen';
import { CommCadenceScreen } from '../screens/preferences/CommCadenceScreen';

// Scheduling
import { LockStatusScreen } from '../screens/scheduling/LockStatusScreen';
import { CalendarSyncScreen } from '../screens/scheduling/CalendarSyncScreen';
import { VenueSelectorScreen } from '../screens/scheduling/VenueSelectorScreen';
import { ReservationLockerScreen } from '../screens/scheduling/ReservationLockerScreen';

// Match
import { ExploreScreen } from '../screens/match/ExploreScreen';
import { MatchScreen } from '../screens/match/MatchScreen';
import { LikeListScreen } from '../screens/match/LikeListScreen';
import { ChatListScreen } from '../screens/match/ChatListScreen';
import { ChatScreen } from '../screens/match/ChatScreen';

// Wallet
import { ProfileLedgerScreen } from '../screens/wallet/ProfileLedgerScreen';
import { WelcomeScreen } from '../screens/onboarding/WelcomeScreen';
import { PrimaryPhotoSelfieScreen } from '../screens/wallet/PrimaryPhotoSelfieScreen';
import { SubscriptionCheckoutScreen } from '../screens/wallet/SubscriptionCheckoutScreen';

// Notifications
import { NotificationHandler } from '../hooks/useNotifications';

// Settings
import { NotificationPreferencesScreen } from '../screens/settings/NotificationPreferencesScreen';
import { PrivacyScreen } from '../screens/settings/PrivacyScreen';

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  // One-time thank-you page right after onboarding (services/welcomeNotice.ts)
  Welcome: undefined;
  Main: undefined;
  NotificationPreferences: undefined;
  Privacy: undefined;
  LockStatus: { matchId: string; partnerName: string };
  CalendarSync: { matchId: string };
  VenueSelector: { matchId: string };
  ReservationLocker: { matchId: string; venueId: string };
  // Match screens shown as modal overlays
  Likes: undefined;
  // The swipe deck, opened on a profile tapped in Explore
  Discover: { focusProfile?: any } | undefined;
  ChatList: undefined;
  Chat: { matchId: string; partnerName: string; partnerId?: string; partnerPhotoUrl?: string; locked?: boolean };
  KYCVerify: undefined;
  // Selfie check before a photo becomes the primary profile photo
  PrimaryPhotoSelfie: { photoId: string; photoUrl: string };
  // fromPaywall: opened from a chat, likes or swipe paywall; a completed
  // purchase goes straight back there
  SubscriptionCheckout: { fromPaywall?: boolean } | undefined;
};

export type OnboardingStackParamList = {
  Splash: undefined;
  OTPVerify: undefined;
  Identity: undefined;
  About: undefined;
  Location: undefined;
  Photos: undefined;
  FaceVerification: undefined;
  KYC: undefined;
};

export type PreferencesStackParamList = {
  FilterConstraints: undefined;
  ValueMatrix: undefined;
  PriorityWeights: undefined;
  CommCadence: undefined;
};

export type MainTabParamList = {
  Explore: undefined;
  Match: undefined;
  ChatListTab: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
const OnboardingStack = createStackNavigator<OnboardingStackParamList>();
const PreferencesStack = createStackNavigator<PreferencesStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

const screenOptions = {
  headerShown: false,
  cardStyle: { backgroundColor: colors.background },
  gestureEnabled: false,
};

// Memoize navigator sub-components to prevent unnecessary re-renders
const AuthNavigator = React.memo(function AuthNavigator() {
  return (
    <OnboardingStack.Navigator screenOptions={screenOptions}>
      <OnboardingStack.Screen name="Splash" component={SplashScreen} />
      <OnboardingStack.Screen name="OTPVerify" component={OTPVerifyScreen} />
      <OnboardingStack.Screen name="Identity" component={IdentityScreen} />
      <OnboardingStack.Screen name="About" component={AboutYouScreen} />
      <OnboardingStack.Screen name="Location" component={LocationPermissionScreen} />
      <OnboardingStack.Screen name="Photos" component={PhotoUploadScreen} />
      <OnboardingStack.Screen name="FaceVerification">
        {(props) => (
          <React.Suspense fallback={<ActivityIndicator size="large" color="#fff" />}>
            <FaceVerificationScreen {...props} />
          </React.Suspense>
        )}
      </OnboardingStack.Screen>
      {/* KYC step commented out — see navigation/onboardingFlow.ts */}
      {/* <OnboardingStack.Screen name="KYC" component={KYCScreen} /> */}
    </OnboardingStack.Navigator>
  );
});
AuthNavigator.displayName = 'AuthNavigator';

const PreferencesNavigator = React.memo(function PreferencesNavigator() {
  return (
    <PreferencesStack.Navigator screenOptions={screenOptions}>
      <PreferencesStack.Screen name="FilterConstraints" component={FilterConstraintsScreen} />
      <PreferencesStack.Screen name="ValueMatrix" component={ValueMatrixScreen} />
      <PreferencesStack.Screen name="PriorityWeights" component={PriorityWeightingScreen} />
      <PreferencesStack.Screen name="CommCadence" component={CommCadenceScreen} />
    </PreferencesStack.Navigator>
  );
});
PreferencesNavigator.displayName = 'PreferencesNavigator';

const tabBarScreenOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: colors.tabBarBg,
    borderTopColor: colors.tabBarBorder,
    borderTopWidth: 1,
    height: 80,
    paddingBottom: 20,
    paddingTop: 10,
  },
  tabBarActiveTintColor: colors.textPrimary,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarLabelStyle: {
    ...typography.caption,
    fontSize: 10,
  },
};

const MainTabNavigator = React.memo(function MainTabNavigator() {
  return (
    <MainTab.Navigator screenOptions={tabBarScreenOptions}>
      <MainTab.Screen
        name="Explore"
        component={ExploreScreen}
        options={{
          tabBarLabel: 'Explore',
          tabBarIcon: ({ color }) => <Ionicons name="grid-outline" size={22} color={color} />,
        }}
      />
      {/* The tab opens the Likes list: Explore already covers discovery, and
          the swipe deck is reached from a profile tapped there (Discover). */}
      <MainTab.Screen
        name="Match"
        component={LikeListScreen}
        options={{
          tabBarLabel: 'Match',
          tabBarIcon: ({ color }) => <MatchTabIcon color={color} />,
        }}
      />
      <MainTab.Screen
        name="ChatListTab"
        component={ChatListScreen}
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: ({ color }) => <ChatTabIcon color={color} />,
        }}
      />
      <MainTab.Screen
        name="Profile"
        component={ProfileLedgerScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={22} color={color} />,
        }}
      />
    </MainTab.Navigator>
  );
});
MainTabNavigator.displayName = 'MainTabNavigator';

/**
 * Shown while the stored session is checked at launch. The server runs on a
 * free tier and its database sleeps when idle, so a cold open can take up to
 * a minute; after a few seconds the spinner says so instead of leaving the
 * user wondering whether the app is stuck.
 */
const SLOW_START_AFTER_MS = 6000;

function StartupLoader() {
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_START_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.primary} />
      {slow && (
        <View style={styles.loadingNote}>
          <Text style={styles.loadingTitle}>Waking up the server…</Text>
          <Text style={styles.loadingText}>
            We run on a free tier for now, so this can take up to a minute. Thanks for your patience.
          </Text>
        </View>
      )}
    </View>
  );
}

export function RootNavigator() {
  // Per-field selectors: a bare useAuthStore() re-rendered the whole
  // navigator on every store change (badge counts, socket state, open chat)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const onboardingStep = useAuthStore((s) => s.onboardingStep);
  const welcomePending = useAuthStore((s) => s.welcomePending);

  // When the user logs out or deletes their account, reset the navigator
  // back to the Onboarding screen so they can't swipe back into Main.
  const wasAuthenticatedRef = React.useRef(isAuthenticated);
  React.useEffect(() => {
    if (wasAuthenticatedRef.current && !isAuthenticated && navigationRef.isReady()) {
      navigationRef.resetRoot({ index: 0, routes: [{ name: 'Onboarding' }] });
    }
    wasAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  if (isLoading) {
    return <StartupLoader />;
  }

  const showOnboarding = !isAuthenticated || onboardingStep !== 'complete';

  return (
    <NavigationContainer ref={navigationRef}>
      {/* Notification tap handler must be inside NavigationContainer */}
      <NotificationHandler />
      <RootStack.Navigator
        screenOptions={screenOptions}
        initialRouteName={showOnboarding ? 'Onboarding' : welcomePending ? 'Welcome' : 'Main'}
      >
        <RootStack.Screen name="Onboarding" component={AuthNavigator} />
        <RootStack.Screen name="Welcome" component={WelcomeScreen} />
        <RootStack.Screen name="Main" component={MainTabNavigator} />
        {/* Match screens (pushed above tab bar) */}
        <RootStack.Screen name="Likes" component={LikeListScreen} />
        <RootStack.Screen name="Discover" component={MatchScreen} />
        <RootStack.Screen name="ChatList" component={ChatListScreen} />
        <RootStack.Screen name="Chat" component={ChatScreen} />
        {/* Existing root overlay screens */}
        <RootStack.Screen name="LockStatus" component={LockStatusScreen} />
        <RootStack.Screen name="CalendarSync" component={CalendarSyncScreen} />
        <RootStack.Screen name="VenueSelector" component={VenueSelectorScreen} />
        <RootStack.Screen name="ReservationLocker" component={ReservationLockerScreen} />
        <RootStack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
        <RootStack.Screen name="Privacy" component={PrivacyScreen} />
        <RootStack.Screen name="KYCVerify" component={KYCScreen} />
        <RootStack.Screen name="PrimaryPhotoSelfie" component={PrimaryPhotoSelfieScreen} />
        <RootStack.Screen name="SubscriptionCheckout" component={SubscriptionCheckoutScreen} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingNote: {
    marginTop: 28,
    paddingHorizontal: 40,
    alignItems: 'center',
    gap: 6,
  },
  loadingTitle: {
    ...typography.h4,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  loadingText: {
    ...typography.body2,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
