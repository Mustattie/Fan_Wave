import { supabase } from '@/lib/supabase';
import { AppState, AppStateStatus } from 'react-native';

type EventName =
  | 'app_open' | 'sign_up' | 'sign_in' | 'onboarding_complete'
  | 'group_created' | 'group_joined' | 'watch_party_created' | 'watch_party_rsvp'
  | 'message_sent' | 'moment_created' | 'clip_uploaded' | 'clip_liked' | 'clip_shared'
  | 'content_shared' | 'clip_exported' | 'invite_shared' | 'invite_opened'
  | 'screen_viewed';

interface EventMetadata {
  [key: string]: string | number | boolean | null;
}

interface BufferedEvent {
  user_id: string | null;
  event_name: EventName;
  screen: string | null;
  metadata: EventMetadata;
  created_at: string;
}

let currentUserId: string | null = null;
let eventBuffer: BufferedEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL = 30_000; // 30 seconds
const MAX_BUFFER_SIZE = 50;

export function setAnalyticsUser(userId: string | null) {
  currentUserId = userId;
}

export async function trackEvent(eventName: EventName, screen?: string, metadata?: EventMetadata) {
  eventBuffer.push({
    user_id: currentUserId,
    event_name: eventName,
    screen: screen || null,
    metadata: metadata || {},
    created_at: new Date().toISOString(),
  });

  // Flush immediately if buffer is full
  if (eventBuffer.length >= MAX_BUFFER_SIZE) {
    flushEvents();
  }
}

export async function trackScreenView(screenName: string) {
  return trackEvent('screen_viewed', screenName);
}

async function flushEvents() {
  if (eventBuffer.length === 0) return;

  const batch = eventBuffer.splice(0);
  try {
    await supabase.from('analytics_events').insert(batch);
  } catch {
    // On failure, put events back at the front of the buffer for next flush
    eventBuffer.unshift(...batch);
    // Cap buffer to prevent unbounded growth on persistent failures
    if (eventBuffer.length > MAX_BUFFER_SIZE * 3) {
      eventBuffer = eventBuffer.slice(0, MAX_BUFFER_SIZE * 3);
    }
  }
}

// Start periodic flush timer
export function startAnalyticsFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(flushEvents, FLUSH_INTERVAL);

  // Flush when app goes to background
  AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background' || state === 'inactive') {
      flushEvents();
    }
  });
}

// Stop periodic flush and send remaining events
export function stopAnalyticsFlush() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushEvents();
}
