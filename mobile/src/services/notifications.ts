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
        title: '✦ Good morning from SIVARR',
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

// Registers this device for real server-driven push (org mentions, task
// assignments, etc. — see app.py's send_push()/_send_expo_push()) — distinct
// from the two local scheduled reminders above, which never leave the
// device. Requires a real EAS project id in app.json (still a placeholder
// as of this writing — getExpoPushTokenAsync() will reject until that's
// set), so this fails silently like everything else in this file rather
// than surfacing an error the user can't act on.
export async function registerForPushNotifications(
  subscribe: (expoToken: string) => Promise<any>,
): Promise<void> {
  if (!Notifications) return;
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;
    const projectId = require('expo-constants').default?.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (expoToken) await subscribe(expoToken);
  } catch { /* fail silently — same posture as the rest of this file */ }
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
