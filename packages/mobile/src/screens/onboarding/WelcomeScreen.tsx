import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../../components/common/Button';
import { useAuthStore } from '../../store/authStore';
import { clearWelcomePending } from '../../services/welcomeNotice';
import { colors, typography, spacing, radius } from '../../theme';

const LOGO = require('../../assets/images/logo.png');

/**
 * Shown once, right after a user finishes onboarding. Start Exploring is the
 * only way past it and closes it for good (see services/welcomeNotice.ts).
 */
export const WelcomeScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const [leaving, setLeaving] = useState(false);

  const handleStart = async () => {
    setLeaving(true);
    const userId = useAuthStore.getState().user?.id;
    if (userId) await clearWelcomePending(userId);
    useAuthStore.getState().setWelcomePending(false);
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.logoIcon}>
          <Image source={LOGO} style={styles.logoImage} resizeMode="contain" />
        </View>

        <Text style={styles.title}>Thank you</Text>
        <Text style={styles.subtitle}>Great to have you here!</Text>

        <View style={styles.noteCard}>
          <View style={styles.noteHeader}>
            <Ionicons name="server-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.noteTitle}>Running on a small budget</Text>
          </View>
          <Text style={styles.noteBody}>
            Kinetik runs on modest servers for now, as the budget doesn't stretch to
            powerful ones yet. Some screens may respond slowly, so thank you for your
            patience, and for supporting the app.
          </Text>
        </View>

        <Text style={styles.closing}>Enjoy meeting new people.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <Button title="Start Exploring" onPress={handleStart} loading={leaving} disabled={leaving} fullWidth size="lg" />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxl,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  logoImage: {
    width: 46,
    height: 46,
    tintColor: colors.textInverse,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body1, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xxl },
  noteCard: {
    alignSelf: 'stretch',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  noteTitle: { ...typography.body1, color: colors.textPrimary, fontWeight: '600' },
  noteBody: { ...typography.body2, color: colors.textSecondary, lineHeight: 20 },
  closing: { ...typography.body1, color: colors.textPrimary, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.xxl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
});
