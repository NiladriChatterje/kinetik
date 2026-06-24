import React, { useEffect, useRef } from 'react';
import { getNotificationsModule } from '../services/notifications';
import { useNotificationStore } from '../store/notificationStore';

type SubscriptionRef = { remove: () => void } | null;

/**
 * Hook that initializes push notifications.
 * Should be called once at the app root level.
 * Does NOT handle navigation — that's done by NotificationHandler.
 *
 * The notification store handles Expo Go detection internally —
 * push token registration is skipped there.
 *
 * expo-notifications is loaded lazily via require() behind an Expo Go guard
 * to avoid the native-module crash in Expo Go (SDK 53+).
 */
export function useNotifications() {
  const notificationListenerRef = useRef<SubscriptionRef>(null);

  const initialize = useNotificationStore((s) => s.initialize);
  const setLastNotification = useNotificationStore((s) => s.setLastNotification);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications || cancelled) return;

      try {
        // Configure how the app handles incoming notifications
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        // Initialize the notification system
        initialize();

        // Listen for notifications received while app is in foreground
        notificationListenerRef.current = Notifications.addNotificationReceivedListener(
          (notification) => {
            console.log('[notifications] Received in foreground:', notification.request.identifier);
            setLastNotification(notification);
          },
        );
      } catch (error) {
        console.warn('[notifications] Handler/listener setup failed:', error);
      }
    })();

    return () => {
      cancelled = true;
      notificationListenerRef.current?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * This component must be rendered inside a NavigationContainer.
 * It listens for notification taps and navigates accordingly.
 */
export function NotificationHandler(): React.ReactElement | null {
  const responseListenerRef = useRef<SubscriptionRef>(null);
  const setLastNotificationResponse = useNotificationStore((s) => s.setLastNotificationResponse);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications || cancelled) return;

      try {
        // Listen for notification taps (app opened from notification)
        responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
          (response) => {
            const { notification } = response;
            console.log('[notifications] Tapped:', notification.request.identifier);
            setLastNotificationResponse(response);

            // Navigation is handled by deep linking / navigation ref
            // We store the response data for the navigation layer to consume
          },
        );
      } catch (error) {
        console.warn('[notifications] Response listener setup failed:', error);
      }
    })();

    return () => {
      responseListenerRef.current?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/**
 * Show a local notification (useful for in-app events when the backend
 * hasn't sent a push notification yet).
 */
export async function showLocalNotification(title: string, body: string, data?: Record<string, unknown>) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger: null, // Immediately
  });
}

/**
 * Schedule a local notification for a future time.
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  secondsFromNow: number,
  data?: Record<string, unknown>,
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsFromNow,
    },
  });
}

/**
 * Cancel all scheduled local notifications.
 */
export async function cancelAllScheduledNotifications() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get the current notification permissions status.
 */
export async function getNotificationPermissionsStatus() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;

  return await Notifications.getPermissionsAsync();
}
