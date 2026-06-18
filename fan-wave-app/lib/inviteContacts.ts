import { Alert, Linking } from 'react-native';
import * as Contacts from 'expo-contacts';

/**
 * Shared contact-picker helpers used by the create-private-group flow
 * (`app/(tabs)/groups.tsx`) and the fan-group invite flow
 * (`app/fan-group/[id].tsx`). Centralised so both call sites stay in sync.
 *
 * The actual contact-picker UI lives in each screen as a Modal — this helper
 * owns permissions, fetching, multi-number disambiguation, and SMS dispatch
 * so the call sites don't duplicate that logic.
 */

export type InviteContact = { name: string; phone: string };

/**
 * Request Contacts permission and fetch contacts that have at least one
 * phone number, sorted alphabetically. Returns null if the user denies
 * permission (caller should already have shown the permission Alert).
 */
export async function loadContactsWithPhones(): Promise<
  Contacts.ExistingContact[] | null
> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Contacts permission denied',
      'Enable Contacts access in Settings to invite friends.',
    );
    return null;
  }
  try {
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
    });
    return data
      .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0 && c.name)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch {
    Alert.alert('Could not load contacts', 'Please try again.');
    return null;
  }
}

/**
 * When a contact has multiple phone numbers, prompt the user to pick one.
 * Single-number contacts resolve immediately. Returns null if the user
 * cancels the disambiguation prompt.
 */
export function pickPhoneForContact(
  contact: Contacts.Contact,
): Promise<InviteContact | null> {
  return new Promise((resolve) => {
    const phones = contact.phoneNumbers || [];
    const name = contact.name || 'Unknown';
    if (phones.length === 0) {
      resolve(null);
      return;
    }
    if (phones.length === 1) {
      resolve({ name, phone: phones[0].number || '' });
      return;
    }
    Alert.alert(
      `Pick a number for ${name}`,
      undefined,
      [
        ...phones.map((p) => ({
          text: `${p.label ? `${p.label}: ` : ''}${p.number}`,
          onPress: () => resolve({ name, phone: p.number || '' }),
        })),
        {
          text: 'Cancel',
          style: 'cancel' as const,
          onPress: () => resolve(null),
        },
      ],
    );
  });
}

/**
 * Open the device's native SMS composer pre-filled with the invite body
 * and the supplied recipients. Returns true if the composer opened.
 *
 * Android requires `?body=`; iOS tolerates `?` and also supports `&`.
 * Multi-recipient via comma-separated numbers works on both platforms.
 */
export async function openSmsInvite(
  recipients: InviteContact[],
  body: string,
): Promise<boolean> {
  if (recipients.length === 0) return false;
  const numbers = recipients
    .map((r) => r.phone.replace(/\s+/g, ''))
    .filter(Boolean)
    .join(',');
  if (!numbers) return false;
  const smsUrl = `sms:${numbers}?body=${encodeURIComponent(body)}`;
  try {
    const supported = await Linking.canOpenURL(smsUrl);
    if (!supported) return false;
    await Linking.openURL(smsUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the canonical invite body for a fan group.
 */
export function buildGroupInviteBody(group: {
  id: string;
  name: string;
}): string {
  const link = `https://fansphere.org/group/${group.id}`;
  return `Join my Fan Sphere group "${group.name}": ${link}`;
}
