import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, radius } from '../../theme';

export const LocationPermissionScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [loading, setLoading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'pending' | 'granted' | 'denied'>('pending');

  const requestLocation = async () => {
    setLoading(true);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      setPermissionStatus('granted');
      const loc = await Location.getCurrentPositionAsync({});
      await (await import('../../services/api')).api.updateLocation(loc.coords.latitude, loc.coords.longitude);
      await (await import('../../services/api')).api.updateOnboardingStep('location');
      setTimeout(() => navigation.navigate('Photos'), 800);
    } else {
      setPermissionStatus('denied');
      Alert.alert('Location Required', 'Kinetik needs location access to find matches near you.');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Step 2 of 5</Text>
        <Text style={styles.title}>Enable Location</Text>
        <Text style={styles.subtitle}>We use precise GPS to place you on the local matching grid</Text>

        <Card style={styles.mapPreview}>
          <View style={styles.hexGrid}>
            {Array.from({ length: 19 }).map((_, i) => (
              <View key={i} style={[styles.hexCell, i === 9 && styles.hexActive]} />
            ))}
          </View>
          <Text style={styles.mapLabel}>Your location creates a unique hexagonal zone</Text>
        </Card>

        <View style={styles.permissions}>
          <View style={styles.permissionRow}>
            <Text style={styles.permissionEmoji}>📍</Text>
            <View>
              <Text style={styles.permissionTitle}>Precise GPS</Text>
              <Text style={styles.permissionDesc}>Pinpoints your exact H3 hexagonal cell</Text>
            </View>
          </View>
          <View style={styles.permissionRow}>
            <Text style={styles.permissionEmoji}>🔄</Text>
            <View>
              <Text style={styles.permissionTitle}>Background Updates</Text>
              <Text style={styles.permissionDesc}>Keeps your queue position fresh during windows</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        {permissionStatus === 'granted' ? (
          <Text style={styles.grantedText}>✅ Location access granted</Text>
        ) : (
          <Button title="Enable Location" onPress={requestLocation} fullWidth loading={loading} icon={<Text>📍</Text>} />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xxl },
  step: { ...typography.label, color: colors.primary, marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, marginBottom: spacing.xxl },
  mapPreview: { alignItems: 'center', padding: spacing.xl, marginBottom: spacing.xl },
  hexGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: 200, gap: 4 },
  hexCell: { width: 32, height: 28, backgroundColor: colors.surfaceHighlight, borderRadius: 4, transform: [{ rotate: '30deg' }] },
  hexActive: { backgroundColor: colors.primary },
  mapLabel: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  permissions: { gap: spacing.lg },
  permissionRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  permissionEmoji: { fontSize: 28 },
  permissionTitle: { ...typography.body1, color: colors.textPrimary },
  permissionDesc: { ...typography.caption, color: colors.textSecondary },
  footer: { padding: spacing.xxl, paddingBottom: spacing.huge },
  grantedText: { ...typography.body1, color: colors.success, textAlign: 'center' },
});
