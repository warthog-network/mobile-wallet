import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'warthogAutoLockMinutes';

/** Same choices as the browser wallet. This app starts the timer when it leaves the foreground. */
export const AUTO_LOCK_CHOICES = [1, 5, 15, 30, 60] as const;

export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];

export function isAutoLockMinutes(value: number): value is AutoLockMinutes {
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(value);
}

export async function loadAutoLockMinutes(): Promise<AutoLockMinutes> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const minutes = Number(raw);
    if (isAutoLockMinutes(minutes)) return minutes;
  } catch {
    /* keep the default */
  }
  return 5;
}

export async function saveAutoLockMinutes(minutes: AutoLockMinutes): Promise<void> {
  await AsyncStorage.setItem(KEY, String(minutes));
}
