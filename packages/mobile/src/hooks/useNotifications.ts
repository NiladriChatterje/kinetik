import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getNotificationsModule } from '../services/notifications';
import { useNotificationStore } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';

/**
 * Where a push leads. The server sends `screen` and, for one chat, the
 * match: a single unread chat opens that chat, several unread chats open
 * the list, a like opens Likes.
 */
function openFromNotification(navigation: any, data: Record<string, unknown> | undefined): void {
  if (!data || !useAuthStore.getState().isAuthenticated) return;
  if (data.screen === 'Chat' && typeof data.matchId === 'string') {
    navigation.navigate('Chat', {
      matchId: data.matchId,
      partnerName: typeof data.partnerName === 'string' ? data.partnerName : 'Chat',
      partnerId: typeof data.partnerId === 'string' ? data.partnerId : undefined,
    });
  } else if (data.screen === 'ChatList') {
    navigation.navigate('ChatList');
  } else if (data.screen === 'Likes') {
    navigation.navigate('Likes');
  }
}

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
  const registerForPush = useNotificationStore((s) => s.registerForPushNotifications);
  const refreshPreferences = useNotificationStore((s) => s.refreshPreferences);
  const resetPreferences = useNotificationStore((s) => s.resetPreferences);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id);

  // The token and the push preference are stored per account on the server,
  // so register the token and load the saved preference for each signed-in
  // account, not once at launch before anyone has signed in. Loading it here
  // keeps the Settings toggle true to the account: before this it showed the
  // default (on) whatever the server held, so a tap meant to turn pushes on
  // could turn them off. Signed out, the toggle goes back to the default.
  useEffect(() => {
    if (isAuthenticated && userId) {
      registerForPush();
      refreshPreferences();
    } else {
      resetPreferences();
    }
  }, [isAuthenticated, userId, registerForPush, refreshPreferences, resetPreferences]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications || cancelled) return;

      try {
        // A push is for an app that is not on screen. In the foreground the
        // sockets already update the badges and whatever screen is open, so
        // nothing is shown and no sound plays; closed or in the background,
        // the phone shows it as usual. (Expo runs this handler only for a
        // foregrounded app; the state is checked rather than assumed.)
        Notifications.setNotificationHandler({
          handleNotification: async () => {
            const onScreen = AppState.currentState === 'active';
            return {
              shouldShowAlert: !onScreen,
              shouldPlaySound: !onScreen,
              shouldSetBadge: true,
              shouldShowBanner: !onScreen,
              shouldShowList: !onScreen,
            };
          },
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
  const navigation = useNavigation<any>();

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
            openFromNotification(navigation, notification.request.content.data as Record<string, unknown>);
          },
        );

        // A tap that launched the app from cold: the listener above was not
        // yet attached when it happened
        const launched = await Notifications.getLastNotificationResponseAsync();
        if (launched && !cancelled) {
          openFromNotification(navigation, launched.notification.request.content.data as Record<string, unknown>);
        }
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
