import { create } from 'zustand';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Notification, NotificationResponse } from 'expo-notifications';
import { getNotificationsModule } from '../services/notifications';
import { api } from '../services/api';

interface NotificationState {
  expoPushToken: string | null;
  pushEnabled: boolean;
  flashWindowReminder: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  lastNotification: Notification | null;
  lastNotificationResponse: NotificationResponse | null;

  // Actions
  initialize: () => Promise<void>;
  registerForPushNotifications: () => Promise<string | null>;
  refreshPreferences: () => Promise<void>;
  updatePushEnabled: (enabled: boolean) => Promise<void>;
  updateFlashWindowReminder: (enabled: boolean) => Promise<void>;
  setLastNotification: (notification: Notification | null) => void;
  setLastNotificationResponse: (response: NotificationResponse | null) => void;
  cleanup: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  expoPushToken: null,
  pushEnabled: true,
  flashWindowReminder: true,
  isLoading: true,
  isInitialized: false,
  lastNotification: null,
  lastNotificationResponse: null,

  initialize: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true });

      const Notifications = await getNotificationsModule();

      // Set up notification channels for Android (if module available)
      if (Notifications && Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#000000',
          });

          await Notifications.setNotificationChannelAsync('messages', {
            name: 'Messages',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#000000',
          });

          await Notifications.setNotificationChannelAsync('vibe', {
            name: 'Vibe Check',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#000000',
            sound: 'default',
          });
        } catch {
          console.warn('[notifications] Failed to set up Android channels');
        }
      }

      // Detect Expo Go — remote push notifications are not supported there
      const isExpoGo =
        Constants.executionEnvironment === 'storeClient';

      if (isExpoGo) {
        console.log(
          '[notifications] Running in Expo Go — push notifications require a development build. ' +
            'Local notifications will still work.'
        );
      } else if (Notifications) {
        // Register for push notifications (only in dev builds / production)
        await get().registerForPushNotifications();
      }

      // Load preferences from backend
      await get().refreshPreferences();

      set({ isInitialized: true, isLoading: false });
    } catch (error) {
      console.error('[notifications] Initialization error:', error);
      set({ isLoading: false, isInitialized: true });
    }
  },

  registerForPushNotifications: async () => {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return null;

    try {
      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[notifications] Permission not granted');
        return null;
      }

      // Get the Expo push token
      // In Expo SDK 56+, projectId is required for getExpoPushTokenAsync
      // It is read from the EAS project config (app.json extra.eas.projectId)
      const projectId =
        Constants?.expoConfig?.extra?.eas?.projectId ??
        Constants?.easConfig?.projectId;

      if (!projectId) {
        console.error(
          '[notifications] Project ID not found. Ensure your project is linked to EAS.\n' +
            '  Run `npx eas init` or add `extra.eas.projectId` to app.json'
        );
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      const token = tokenData.data;

      // Send token to backend
      const platform = Platform.OS as 'ios' | 'android' | 'web';
      const response = await api.registerPushToken(token, platform);

      if (response.success) {
        set({ expoPushToken: token });
        console.log('[notifications] Push token registered:', token.slice(0, 20) + '...');
      }

      return token;
    } catch (error) {
      console.error('[notifications] Failed to register for push:', error);
      return null;
    }
  },

  refreshPreferences: async () => {
    try {
      const response = await api.getNotificationPreferences();
      if (response.success && response.data) {
        set({
          pushEnabled: response.data.pushEnabled,
          flashWindowReminder: response.data.flashWindowReminder,
        });
      }
    } catch (error) {
      console.error('[notifications] Failed to load preferences:', error);
    }
  },

  updatePushEnabled: async (enabled: boolean) => {
    try {
      const response = await api.updateNotificationPreferences({ pushEnabled: enabled });
      if (response.success) {
        set({ pushEnabled: enabled });
      }
    } catch (error) {
      console.error('[notifications] Failed to update push preference:', error);
    }
  },

  updateFlashWindowReminder: async (enabled: boolean) => {
    try {
      const response = await api.updateNotificationPreferences({ flashWindowReminder: enabled });
      if (response.success) {
        set({ flashWindowReminder: enabled });
      }
    } catch (error) {
      console.error('[notifications] Failed to update flash window preference:', error);
    }
  },

  setLastNotification: (notification) => set({ lastNotification: notification }),
  setLastNotificationResponse: (response) => set({ lastNotificationResponse: response }),

  cleanup: () => {
    set({
      lastNotification: null,
      lastNotificationResponse: null,
    });
  },
}));
