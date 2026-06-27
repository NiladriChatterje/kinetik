import React from 'react';
import { ActivityIndicator, View, StyleSheet, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { colors, typography } from '../theme';

/** Tab icon with badge for the Match tab — shows incoming like count */
function MatchTabIcon({ color }: { color: string }) {
  const unreadLikeCount = useAuthStore((s) => s.unreadLikeCount);
  return (
    <View style={{ position: 'relative' }}>
      <Ionicons name="heart-outline" size={22} color={color} />
      {unreadLikeCount > 0 && (
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
            {unreadLikeCount > 9 ? '9+' : unreadLikeCount}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen Imports ─────────────────────────────────────
// Onboarding
import { SplashScreen } from '../screens/onboarding/SplashScreen';
import { OTPVerifyScreen } from '../screens/onboarding/OTPVerifyScreen';
import { IdentityScreen } from '../screens/onboarding/IdentityScreen';
import { LocationPermissionScreen } from '../screens/onboarding/LocationPermissionScreen';
import { PhotoUploadScreen } from '../screens/onboarding/PhotoUploadScreen';
import { PoseVerificationScreen } from '../screens/onboarding/PoseVerificationScreen';
import { KYCScreen } from '../screens/onboarding/KYCScreen';

// Preferences
import { FilterConstraintsScreen } from '../screens/preferences/FilterConstraintsScreen';
import { ValueMatrixScreen } from '../screens/preferences/ValueMatrixScreen';
import { PriorityWeightingScreen } from '../screens/preferences/PriorityWeightingScreen';
import { CommCadenceScreen } from '../screens/preferences/CommCadenceScreen';

// Engine
import { FlashCountdownScreen } from '../screens/engine/FlashCountdownScreen';
import { ActiveRadarScreen } from '../screens/engine/ActiveRadarScreen';
import { VibeCheckScreen } from '../screens/engine/VibeCheckScreen';
import { UnmaskingScreen } from '../screens/engine/UnmaskingScreen';
import { CommitmentGateScreen } from '../screens/engine/CommitmentGateScreen';

// Scheduling
import { LockStatusScreen } from '../screens/scheduling/LockStatusScreen';
import { CalendarSyncScreen } from '../screens/scheduling/CalendarSyncScreen';
import { VenueSelectorScreen } from '../screens/scheduling/VenueSelectorScreen';
import { ReservationLockerScreen } from '../screens/scheduling/ReservationLockerScreen';

// Viral (Duo screens kept for profile access)
import { DuoWingmanScreen } from '../screens/viral/DuoWingmanScreen';
import { DoubleDateScreen } from '../screens/viral/DoubleDateScreen';
import { HeatMapScreen } from '../screens/viral/HeatMapScreen';

// Match
import { MatchScreen } from '../screens/match/MatchScreen';
import { LikeListScreen } from '../screens/match/LikeListScreen';
import { ChatListScreen } from '../screens/match/ChatListScreen';
import { ChatScreen } from '../screens/match/ChatScreen';

// Wallet
import { TokenVaultScreen } from '../screens/wallet/TokenVaultScreen';
import { ProfileLedgerScreen } from '../screens/wallet/ProfileLedgerScreen';

// Notifications
import { NotificationHandler } from '../hooks/useNotifications';

// Settings
import { NotificationPreferencesScreen } from '../screens/settings/NotificationPreferencesScreen';

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: undefined;
  NotificationPreferences: undefined;
  TokenVault: undefined;
  VibeCheck: { vibeId: string; partnerName: string };
  Unmasking: { vibeId: string };
  Commitment: { vibeId: string };
  LockStatus: { vibeId: string; partnerName: string };
  CalendarSync: { matchId: string };
  VenueSelector: { matchId: string };
  ReservationLocker: { matchId: string; venueId: string };
  DoubleDate: { roomId: string };
  HeatMap: undefined;
  // Match screens shown as modal overlays
  Likes: undefined;
  ChatList: undefined;
  Chat: { matchId: string; partnerName: string; partnerId?: string; partnerPhotoUrl?: string };
  // Kept for profile access
  DuoWingman: undefined;
};

export type OnboardingStackParamList = {
  Splash: undefined;
  OTPVerify: undefined;
  Identity: undefined;
  Location: undefined;
  Photos: undefined;
  PoseVerification: undefined;
  KYC: undefined;
};

export type PreferencesStackParamList = {
  FilterConstraints: undefined;
  ValueMatrix: undefined;
  PriorityWeights: undefined;
  CommCadence: undefined;
};

export type MainTabParamList = {
  FlashCountdown: undefined;
  ActiveRadar: undefined;
  Match: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();
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
      <OnboardingStack.Screen name="Location" component={LocationPermissionScreen} />
      <OnboardingStack.Screen name="Photos" component={PhotoUploadScreen} />
      <OnboardingStack.Screen name="PoseVerification" component={PoseVerificationScreen} />
      <OnboardingStack.Screen name="KYC" component={KYCScreen} />
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
        name="FlashCountdown"
        component={FlashCountdownScreen}
        options={{
          tabBarLabel: 'Flash',
          tabBarIcon: ({ color }) => <Ionicons name="flash-outline" size={22} color={color} />,
        }}
      />
      <MainTab.Screen
        name="ActiveRadar"
        component={ActiveRadarScreen}
        options={{
          tabBarLabel: 'Radar',
          tabBarIcon: ({ color }) => <Ionicons name="radio-outline" size={22} color={color} />,
        }}
      />
      <MainTab.Screen
        name="Match"
        component={MatchScreen}
        options={{
          tabBarLabel: 'Match',
          tabBarIcon: ({ color }) => <MatchTabIcon color={color} />,
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

export function RootNavigator() {
  const { isAuthenticated, isLoading, onboardingStep } = useAuthStore();

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const showOnboarding = !isAuthenticated || onboardingStep !== 'complete';

  return (
    <NavigationContainer>
      {/* Notification tap handler must be inside NavigationContainer */}
      <NotificationHandler />
      <RootStack.Navigator
        screenOptions={screenOptions}
        initialRouteName={showOnboarding ? 'Onboarding' : 'Main'}
      >
        <RootStack.Screen name="Onboarding" component={AuthNavigator} />
        <RootStack.Screen name="Main" component={MainTabNavigator} />
        {/* Match screens (pushed above tab bar) */}
        <RootStack.Screen name="Likes" component={LikeListScreen} />
        <RootStack.Screen name="ChatList" component={ChatListScreen} />
        <RootStack.Screen name="Chat" component={ChatScreen} />
        {/* Screens navigated from Profile */}
        <RootStack.Screen name="TokenVault" component={TokenVaultScreen} />
        <RootStack.Screen name="DuoWingman" component={DuoWingmanScreen} />
        {/* Existing root overlay screens */}
        <RootStack.Screen name="VibeCheck" component={VibeCheckScreen} />
        <RootStack.Screen name="Unmasking" component={UnmaskingScreen} />
        <RootStack.Screen name="Commitment" component={CommitmentGateScreen} />
        <RootStack.Screen name="LockStatus" component={LockStatusScreen} />
        <RootStack.Screen name="CalendarSync" component={CalendarSyncScreen} />
        <RootStack.Screen name="VenueSelector" component={VenueSelectorScreen} />
        <RootStack.Screen name="ReservationLocker" component={ReservationLockerScreen} />
        <RootStack.Screen name="DoubleDate" component={DoubleDateScreen} />
        <RootStack.Screen name="HeatMap" component={HeatMapScreen} />
        <RootStack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
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
});
