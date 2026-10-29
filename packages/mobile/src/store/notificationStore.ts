import { create } from 'zustand';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Notification, NotificationResponse } from 'expo-notifications';
import { getNotificationsModule } from '../services/notifications';
import { api } from '../services/api';

interface NotificationState {
  expoPushToken: string | null;
  pushEnabled: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  lastNotification: Notification | null;
  lastNotificationResponse: NotificationResponse | null;

  // Actions
  initialize: () => Promise<void>;
  registerForPushNotifications: () => Promise<string | null>;
  refreshPreferences: () => Promise<void>;
  /** Back to the default (on) when nobody is signed in, so the next account never inherits the last one's choice. */
  resetPreferences: () => void;
  updatePushEnabled: (enabled: boolean) => Promise<void>;
  setLastNotification: (notification: Notification | null) => void;
  setLastNotificationResponse: (response: NotificationResponse | null) => void;
  cleanup: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  expoPushToken: null,
  pushEnabled: true,
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
      }
      // The push token is registered by useNotifications once the user is
      // signed in (and again on every sign-in): the server stores it per
      // account, and this runs before any account exists.

      // The saved preference is loaded per account by useNotifications on
      // sign-in; at launch nobody may be signed in yet, so nothing is
      // fetched here and the toggle starts from the default (on).

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
        set({ pushEnabled: response.data.pushEnabled });
      }
    } catch (error) {
      console.error('[notifications] Failed to load preferences:', error);
    }
  },

  resetPreferences: () => set({ pushEnabled: true }),

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


  setLastNotification: (notification) => set({ lastNotification: notification }),
  setLastNotificationResponse: (response) => set({ lastNotificationResponse: response }),

  cleanup: () => {
    set({
      lastNotification: null,
      lastNotificationResponse: null,
    });
  },
}));
