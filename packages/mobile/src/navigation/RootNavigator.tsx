import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { colors, typography } from '../theme';

// ─── Screen Imports ─────────────────────────────────────
// Onboarding
import { SplashScreen } from '../screens/onboarding/SplashScreen';
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

// Viral
import { DuoWingmanScreen } from '../screens/viral/DuoWingmanScreen';
import { DoubleDateScreen } from '../screens/viral/DoubleDateScreen';
import { HeatMapScreen } from '../screens/viral/HeatMapScreen';

// Wallet
import { TokenVaultScreen } from '../screens/wallet/TokenVaultScreen';
import { ProfileLedgerScreen } from '../screens/wallet/ProfileLedgerScreen';

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: undefined;
  VibeCheck: { vibeId: string; partnerName: string };
  Unmasking: { vibeId: string };
  Commitment: { vibeId: string };
  LockStatus: { vibeId: string; partnerName: string };
  CalendarSync: { matchId: string };
  VenueSelector: { matchId: string };
  ReservationLocker: { matchId: string; venueId: string };
  DoubleDate: { roomId: string };
  HeatMap: undefined;
};

export type OnboardingStackParamList = {
  Splash: undefined;
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
  DuoWingman: undefined;
  TokenVault: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();
const OnboardingStack = createStackNavigator<OnboardingStackParamList>();
const PreferencesStack = createStackNavigator<PreferencesStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();

const screenOptions = {
  headerShown: false,
  cardStyle: { backgroundColor: colors.background },
  gestureEnabled: true,
};

function AuthNavigator() {
  return (
    <OnboardingStack.Navigator screenOptions={screenOptions}>
      <OnboardingStack.Screen name="Splash" component={SplashScreen} />
      <OnboardingStack.Screen name="Identity" component={IdentityScreen} />
      <OnboardingStack.Screen name="Location" component={LocationPermissionScreen} />
      <OnboardingStack.Screen name="Photos" component={PhotoUploadScreen} />
      <OnboardingStack.Screen name="PoseVerification" component={PoseVerificationScreen} />
      <OnboardingStack.Screen name="KYC" component={KYCScreen} />
    </OnboardingStack.Navigator>
  );
}

function PreferencesNavigator() {
  return (
    <PreferencesStack.Navigator screenOptions={screenOptions}>
      <PreferencesStack.Screen name="FilterConstraints" component={FilterConstraintsScreen} />
      <PreferencesStack.Screen name="ValueMatrix" component={ValueMatrixScreen} />
      <PreferencesStack.Screen name="PriorityWeights" component={PriorityWeightingScreen} />
      <PreferencesStack.Screen name="CommCadence" component={CommCadenceScreen} />
    </PreferencesStack.Navigator>
  );
}

function MainTabNavigator() {
  return (
    <MainTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: 1,
          height: 80,
          paddingBottom: 20,
          paddingTop: 10,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: {
          ...typography.caption,
          fontSize: 10,
        },
      }}
    >
      <MainTab.Screen
        name="FlashCountdown"
        component={FlashCountdownScreen}
        options={{ tabBarLabel: 'Flash', tabBarIcon: () => null }}
      />
      <MainTab.Screen
        name="ActiveRadar"
        component={ActiveRadarScreen}
        options={{ tabBarLabel: 'Radar', tabBarIcon: () => null }}
      />
      <MainTab.Screen
        name="DuoWingman"
        component={DuoWingmanScreen}
        options={{ tabBarLabel: 'Duo', tabBarIcon: () => null }}
      />
      <MainTab.Screen
        name="TokenVault"
        component={TokenVaultScreen}
        options={{ tabBarLabel: 'Wallet', tabBarIcon: () => null }}
      />
      <MainTab.Screen
        name="Profile"
        component={ProfileLedgerScreen}
        options={{ tabBarLabel: 'Profile', tabBarIcon: () => null }}
      />
    </MainTab.Navigator>
  );
}

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
      <RootStack.Navigator screenOptions={screenOptions}>
        {showOnboarding ? (
          <RootStack.Screen name="Onboarding" component={AuthNavigator} />
        ) : (
          <>
            <RootStack.Screen name="Main" component={MainTabNavigator} />
            <RootStack.Screen name="VibeCheck" component={VibeCheckScreen} />
            <RootStack.Screen name="Unmasking" component={UnmaskingScreen} />
            <RootStack.Screen name="Commitment" component={CommitmentGateScreen} />
            <RootStack.Screen name="LockStatus" component={LockStatusScreen} />
            <RootStack.Screen name="CalendarSync" component={CalendarSyncScreen} />
            <RootStack.Screen name="VenueSelector" component={VenueSelectorScreen} />
            <RootStack.Screen name="ReservationLocker" component={ReservationLockerScreen} />
            <RootStack.Screen name="DoubleDate" component={DoubleDateScreen} />
            <RootStack.Screen name="HeatMap" component={HeatMapScreen} />
          </>
        )}
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
