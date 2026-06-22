import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { useNotificationStore } from '../../store/notificationStore';
import { colors, typography, spacing, radius } from '../../theme';

type NotificationSetting = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

export const NotificationPreferencesScreen: React.FC = () => {
  const {
    pushEnabled,
    flashWindowReminder,
    updatePushEnabled,
    updateFlashWindowReminder,
    expoPushToken,
  } = useNotificationStore();

  const handlePushToggle = useCallback(
    (value: boolean) => {
      updatePushEnabled(value);
    },
    [updatePushEnabled],
  );

  const handleFlashWindowToggle = useCallback(
    (value: boolean) => {
      updateFlashWindowReminder(value);
    },
    [updateFlashWindowReminder],
  );

  const settings: NotificationSetting[] = [
    {
      key: 'pushEnabled',
      icon: 'notifications-outline',
      title: 'Push Notifications',
      description: 'Receive notifications when the app is closed. Disable this to stop all notifications.',
      value: pushEnabled,
      onChange: handlePushToggle,
    },
    {
      key: 'flashWindow',
      icon: 'flash-outline',
      title: 'Flash Window Reminders',
      description: 'Get notified before a Flash Window is about to start in your area.',
      value: flashWindowReminder,
      onChange: handleFlashWindowToggle,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notifications</Text>
        <Text style={styles.headerSubtitle}>Manage your notification preferences</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.settingsCard}>
          {settings.map((setting, index) => (
            <React.Fragment key={setting.key}>
              <View style={styles.settingRow}>
                <View style={styles.settingIconContainer}>
                  <Ionicons name={setting.icon} size={22} color={colors.textPrimary} />
                </View>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingTitle}>{setting.title}</Text>
                  <Text style={styles.settingDescription}>{setting.description}</Text>
                </View>
                <Switch
                  value={setting.value}
                  onValueChange={setting.onChange}
                  trackColor={{ false: colors.surfaceLight, true: colors.primary }}
                  thumbColor={colors.background}
                  ios_backgroundColor={colors.surfaceLight}
                />
              </View>
              {index < settings.length - 1 && <View style={styles.settingDivider} />}
            </React.Fragment>
          ))}
        </Card>

        <Card style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} style={styles.infoIcon} />
          <Text style={styles.infoText}>
            Notifications are delivered through Expo's push notification service. Messages, vibe checks, and other
            time-sensitive alerts will still arrive even when Kinetik is running in the background.
          </Text>
        </Card>

        {__DEV__ && expoPushToken && (
          <Text style={styles.tokenText} numberOfLines={1} ellipsizeMode="middle">
            Push Token: {expoPushToken}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    ...typography.body2,
    color: colors.textMuted,
  },
  content: {
    padding: spacing.xxl,
    paddingTop: spacing.sm,
    paddingBottom: 100,
  },
  settingsCard: {
    padding: 0,
    marginBottom: spacing.lg,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
  },
  settingTitle: {
    ...typography.body1,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingDescription: {
    ...typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
  },
  settingDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginHorizontal: spacing.lg,
  },
  infoCard: {
    flexDirection: 'row',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  infoIcon: {
    marginTop: 2,
  },
  infoText: {
    ...typography.body2,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 18,
  },
  tokenText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
    opacity: 0.5,
  },
});
