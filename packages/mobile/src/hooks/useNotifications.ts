import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useNotificationStore } from '../store/notificationStore';

type Subscription = { remove: () => void };

// Configure how notifications are shown when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Hook that initializes push notifications.
 * Should be called once at the app root level.
 * Does NOT handle navigation — that's done by NotificationHandler.
 */
export function useNotifications() {
  const notificationListenerRef = useRef<Subscription | null>(null);

  const initialize = useNotificationStore((s) => s.initialize);
  const setLastNotification = useNotificationStore((s) => s.setLastNotification);

  useEffect(() => {
    // Initialize the notification system
    initialize();

    // Listen for notifications received while app is in foreground
    notificationListenerRef.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[notifications] Received in foreground:', notification.request.identifier);
      setLastNotification(notification);
    });

    return () => {
      // Cleanup listeners using .remove() (removeNotificationSubscription is deprecated)
      notificationListenerRef.current?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * This component must be rendered inside a NavigationContainer.
 * It listens for notification taps and navigates accordingly.
 */
export function NotificationHandler(): React.ReactElement | null {
  const responseListenerRef = useRef<Subscription | null>(null);
  const setLastNotificationResponse = useNotificationStore((s) => s.setLastNotificationResponse);

  useEffect(() => {
    // Listen for notification taps (app opened from notification)
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const { notification } = response;
      console.log('[notifications] Tapped:', notification.request.identifier);
      setLastNotificationResponse(response);

      // Navigation is handled by deep linking / navigation ref
      // We store the response data for the navigation layer to consume
    });

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
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get the current notification permissions status.
 */
export async function getNotificationPermissionsStatus() {
  return await Notifications.getPermissionsAsync();
}
