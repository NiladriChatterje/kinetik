import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, spacing, radius } from '../../theme';

interface Props { navigation: any; route: any; }

export const UnmaskingScreen: React.FC<Props> = ({ navigation, route }) => {
  const { vibeId } = route.params || {};
  const revealAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(revealAnim, {
      toValue: 1, duration: 60000, useNativeDriver: false,
    }).start();
  }, []);

  const blurAmount = revealAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [20, 8, 0],
  });

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={['#0A0A0F', '#1a0a1a']} style={StyleSheet.absoluteFill} />
      <Text style={styles.title}>Gradient Unmasking</Text>
      <Text style={styles.subtitle}>Your conversation reveals your match</Text>
      <View style={styles.imageContainer}>
        <Animated.View style={[styles.profileCircle, { opacity: revealAnim }]}>
          <Ionicons name="happy-outline" size={80} color={colors.textMuted} />
        </Animated.View>
      </View>
      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          <Animated.View style={[styles.progressFill, { width: revealAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
        <Text style={styles.progressText}>Image revealing as conversation deepens...</Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.xxl },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  imageContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileCircle: { width: 200, height: 200, borderRadius: 100, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  progressSection: { padding: spacing.xxl, paddingBottom: spacing.huge },
  progressBar: { height: 6, backgroundColor: colors.surfaceHighlight, borderRadius: 3, marginBottom: spacing.md },
  progressFill: { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
  progressText: { ...typography.body2, color: colors.textMuted, textAlign: 'center' },
});
