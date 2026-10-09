import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AppState, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { BackButton } from '../../components/common/BackButton';
import { Card } from '../../components/common/Card';
import { useToast } from '../../hooks/useToast';
import { api } from '../../services/api';
import { colors, typography, spacing } from '../../theme';

/**
 * pending      — nothing asked yet
 * denied       — user tapped "Don't allow" but the OS will ask again → Retry
 * blocked      — OS will not show the prompt again → must be enabled in Settings
 * services_off — permission is fine but the phone's location toggle is off
 * granted      — coordinates saved, moving on
 */
type PermissionState = 'pending' | 'granted' | 'denied' | 'blocked' | 'services_off';

export const LocationPermissionScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionState>('pending');
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(null);
  const toast = useToast();
  // Set when we send the user to Settings, so coming back retries automatically
  const awaitingSettingsRef = useRef(false);
  // Pending auto-advance to Photos — cancelled if the user goes back first
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestLocation = async () => {
    setLoading(true);
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // Android after two refusals, or iOS after any refusal, stops showing
        // the prompt — a second "Retry" would silently do nothing.
        setPermissionStatus(canAskAgain ? 'denied' : 'blocked');
        toast.showError('Location needed', 'Required to find matches nearby.');
        return;
      }

      // Permission is granted but the phone-wide location toggle may be off;
      // getCurrentPositionAsync would throw and strand the screen.
      if (!(await Location.hasServicesEnabledAsync())) {
        setPermissionStatus('services_off');
        toast.showError('Location is turned off', 'Turn on location services to continue.');
        return;
      }

      setPermissionStatus('granted');
      const loc = await Location.getCurrentPositionAsync({});
      const res = await api.updateLocation(loc.coords.latitude, loc.coords.longitude);
      const locationName = res?.data?.county || res?.data?.city || [res?.data?.city, res?.data?.region].filter(Boolean).join(', ');
      if (locationName) {
        setResolvedLocation(locationName);
        toast.showSuccess('Location set', `You're in ${locationName}`);
      } else {
        toast.showSuccess('Location enabled', 'Ready to match.');
      }
      await api.updateOnboardingStep('location');
      advanceTimerRef.current = setTimeout(() => navigation.navigate('Photos'), 1200);
    } catch {
      // A GPS fix or the network call failed — let the user try again
      setPermissionStatus('denied');
      toast.showError('Could not get your location', 'Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  };

  // Permanently blocked: only the OS settings page can flip it back on.
  const openSettings = async () => {
    awaitingSettingsRef.current = true;
    await Linking.openSettings();
  };

  // Location services off: Android can raise the system "turn on location"
  // dialog in place; iOS has no such API, so fall back to Settings.
  const turnOnLocationServices = async () => {
    if (Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
        await requestLocation();
      } catch {
        // User dismissed the system dialog — stay on this state, Retry remains
      }
    } else {
      await openSettings();
    }
  };

  // Back from Settings → retry without another tap
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && awaitingSettingsRef.current) {
        awaitingSettingsRef.current = false;
        requestLocation();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.step}>Step 3 of 6</Text>
        <Text style={styles.title}>Enable Location</Text>
        <Text style={styles.subtitle}>We use precise GPS to place you on the local matching grid</Text>

        <Card style={styles.mapPreview}>
          <View style={styles.hexGrid}>
            {Array.from({ length: 19 }).map((_, i) => (
              <View key={i} style={[styles.hexCell, i === 9 && styles.hexActive]} />
            ))}
          </View>
          {resolvedLocation ? (
            <View style={styles.resolvedRow}>
              <Ionicons name="navigate" size={16} color={colors.textPrimary} />
              <Text style={styles.resolvedText}>{resolvedLocation}</Text>
            </View>
          ) : (
            <Text style={styles.mapLabel}>Your location creates a unique hexagonal zone</Text>
          )}
        </Card>

        <View style={styles.permissions}>
          <View style={styles.permissionRow}>
            <Ionicons name="location-outline" size={28} color={colors.textPrimary} />
            <View>
              <Text style={styles.permissionTitle}>Precise GPS</Text>
              <Text style={styles.permissionDesc}>Pinpoints your exact H3 hexagonal cell</Text>
            </View>
          </View>
          <View style={styles.permissionRow}>
            <Ionicons name="sync-outline" size={28} color={colors.textSecondary} />
            <View>
              <Text style={styles.permissionTitle}>Background Updates</Text>
              <Text style={styles.permissionDesc}>Keeps your queue position fresh during windows</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        {permissionStatus === 'granted' ? (
          <>
            <View style={styles.grantedRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.textPrimary} />
              <Text style={styles.grantedText}> Location access granted</Text>
            </View>
            {/* Reached again via back from Photos — the auto-advance already ran */}
            <Button title="Continue" onPress={() => navigation.navigate('Photos')} fullWidth />
          </>
        ) : permissionStatus === 'blocked' ? (
          <>
            <Text style={styles.hint}>Location was turned off for Kinetik. Allow it in Settings, then come back — we will retry for you.</Text>
            <Button title="Open Settings" onPress={openSettings} fullWidth loading={loading} icon={<Ionicons name="settings-outline" size={20} color={colors.textPrimary} />} />
          </>
        ) : permissionStatus === 'services_off' ? (
          <>
            <Text style={styles.hint}>Your phone's location is switched off. Turn it on to find people nearby.</Text>
            <Button title="Turn on location" onPress={turnOnLocationServices} fullWidth loading={loading} icon={<Ionicons name="navigate-outline" size={20} color={colors.textPrimary} />} />
          </>
        ) : permissionStatus === 'denied' ? (
          <>
            <Text style={styles.hint}>No worries — tap Retry and choose Allow when your phone asks.</Text>
            <Button title="Retry" onPress={requestLocation} fullWidth loading={loading} icon={<Ionicons name="refresh-outline" size={20} color={colors.textPrimary} />} />
          </>
        ) : (
          <Button title="Enable Location" onPress={requestLocation} fullWidth loading={loading} icon={<Ionicons name="location-outline" size={20} color={colors.textPrimary} />} />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl },
  step: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  mapPreview: { alignItems: 'center', padding: spacing.xl, marginBottom: spacing.xl },
  hexGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: 200, gap: 4 },
  hexCell: { width: 32, height: 28, backgroundColor: colors.surfaceHighlight, borderRadius: 4, transform: [{ rotate: '30deg' }] },
  hexActive: { backgroundColor: colors.textPrimary },
  mapLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  resolvedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.lg },
  resolvedText: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  permissions: { gap: spacing.lg },
  permissionRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  permissionTitle: { ...typography.body1, color: colors.textPrimary },
  permissionDesc: { ...typography.caption, color: colors.textSecondary },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  grantedRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  grantedText: { ...typography.body1, color: colors.textPrimary, textAlign: 'center' },
});
