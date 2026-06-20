import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, radius } from '../../theme';

interface Props { navigation: any; route: any; }

export const LockStatusScreen: React.FC<Props> = ({ navigation, route }) => {
  const { vibeId, matched } = route.params || {};
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, damping: 10, stiffness: 100, useNativeDriver: true }).start();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.content, { transform: [{ scale: scaleAnim }] }]}>
        <Ionicons name="sparkles-outline" size={80} color={colors.primary} />
        <Text style={styles.title}>It's a Match!</Text>
        <Text style={styles.subtitle}>You both locked it in. The spark is real.</Text>
        <View style={styles.matchInfo}>
          <View style={styles.matchAvatar}>
            <Ionicons name="happy-outline" size={36} color={colors.textMuted} />
          </View>
          <Text style={styles.matchName}>Alex</Text>
          <Text style={styles.matchDetail}>28 - Software Engineer - San Francisco</Text>
        </View>
      </Animated.View>
      <View style={styles.actions}>
        <Button title="Schedule Your Date" onPress={() => navigation.navigate('CalendarSync', { matchId: vibeId })} fullWidth size="lg" icon={<Ionicons name="calendar-outline" size={20} color={colors.textPrimary} />} />
        <Button title="Keep Exploring" onPress={() => navigation.navigate('Main')} variant="ghost" fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.lg },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  matchInfo: { alignItems: 'center' },
  matchAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  matchName: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
  matchDetail: { ...typography.body2, color: colors.textSecondary },
  actions: { padding: spacing.xxl, paddingBottom: spacing.huge },
});
