import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
      <LinearGradient colors={['#0A0A0F', '#1a0010']} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.content, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={styles.matchEmoji}>🎉</Text>
        <Text style={styles.title}>It's a Match!</Text>
        <Text style={styles.subtitle}>You both locked it in. The spark is real.</Text>
        <View style={styles.matchInfo}>
          <View style={styles.matchAvatar}><Text style={styles.avatarEmoji}>😊</Text></View>
          <Text style={styles.matchName}>Alex</Text>
          <Text style={styles.matchDetail}>28 · Software Engineer · San Francisco</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button title="Schedule Your Date" onPress={() => navigation.navigate('CalendarSync', { matchId: vibeId })} fullWidth size="lg" icon={<Text>📅 </Text>} />
        <Button title="Keep Exploring" onPress={() => navigation.navigate('Main')} variant="ghost" fullWidth />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  matchEmoji: { fontSize: 80, marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  matchInfo: { alignItems: 'center' },
  matchAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  avatarEmoji: { fontSize: 36 },
  matchName: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
  matchDetail: { ...typography.body2, color: colors.textSecondary },
  actions: { padding: spacing.xxl, paddingBottom: spacing.huge },
});
