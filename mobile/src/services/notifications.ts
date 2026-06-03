/**
 * SIVARR Push Notification Service
 * Requires: npx expo install expo-notifications
 */

let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch (_) {
  // expo-notifications not installed — notifications disabled gracefully
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function scheduleDailyBrief(hour = 8, minute = 0): Promise<void> {
  if (!Notifications) return;
  try {
    // Cancel existing daily brief notifications
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.content?.data?.type === 'daily_brief') {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    // Schedule new one
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '✦ Good morning — SIVARR',
        body: "Your daily brief is ready. Let's make today count.",
        data: { type: 'daily_brief' },
        sound: true,
      },
      trigger: {
        hour,
        minute,
        repeats: true,
      },
    });
  } catch { /* fail silently */ }
}

export async function scheduleHabitReminder(hour = 20, minute = 0): Promise<void> {
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.content?.data?.type === 'habit_reminder') {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔥 Habit check-in',
        body: "Have you completed today's habits? Open SIVARR to track them.",
        data: { type: 'habit_reminder' },
        sound: true,
      },
      trigger: {
        hour,
        minute,
        repeats: true,
      },
    });
  } catch { /* fail silently */ }
}

export async function cancelAllNotifications(): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch { /* fail silently */ }
}

export function configureNotificationHandler(): void {
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge:  false,
      }),
    });
  } catch { /* fail silently */ }
}
