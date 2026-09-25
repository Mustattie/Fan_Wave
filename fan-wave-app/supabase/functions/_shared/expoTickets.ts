/**
 * Pure classification of Expo push tickets -> per-row queue outcomes.
 *
 * Plain TypeScript on purpose: NO Deno imports or globals, so Jest can import
 * it from __tests__/edgeHelpers.test.ts under the app's tsconfig, and the
 * edge function imports it with a relative path.
 *
 * Expo returns `{ data: ExpoTicket[] }` in the same order as the messages we
 * sent, so ticket[i] describes rows[i]. A short/missing ticket list is treated
 * as a transient failure for the rows it does not cover.
 */

export interface QueueRowForTicket {
  id: string;
  push_token: string;
  retry_count: number;
  max_retries: number;
}

export interface ExpoTicket {
  status: string; // 'ok' | 'error'
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface TicketClassification {
  /** Row ids that Expo accepted (status 'ok'). */
  sent: string[];
  /** Rows that must not be retried (device gone, retries exhausted, ...). */
  dead: Array<{ id: string; reason: string }>;
  /** Rows to schedule for retry with backoff. */
  failed: Array<{ id: string; reason: string }>;
  /** Distinct push tokens Expo reported as DeviceNotRegistered. */
  deadTokens: string[];
}

/** Expo error codes for which a retry can never succeed. */
const TERMINAL_ERRORS = new Set(["DeviceNotRegistered", "MessageTooBig"]);

function ticketReason(ticket: ExpoTicket | undefined): string {
  if (!ticket) return "Expo returned no ticket for this message";
  const code = ticket.details?.error;
  const msg = ticket.message;
  if (code && msg) return `${code}: ${msg}`;
  return code ?? msg ?? "Expo ticket error";
}

export function classifyExpoTickets(
  rows: QueueRowForTicket[],
  tickets: ExpoTicket[],
): TicketClassification {
  const out: TicketClassification = { sent: [], dead: [], failed: [], deadTokens: [] };
  const seenTokens = new Set<string>();

  rows.forEach((row, i) => {
    const ticket = tickets[i];

    if (ticket && ticket.status === "ok") {
      out.sent.push(row.id);
      return;
    }

    const code = ticket?.details?.error;
    const reason = ticketReason(ticket);

    if (code === "DeviceNotRegistered") {
      out.dead.push({ id: row.id, reason });
      if (row.push_token && !seenTokens.has(row.push_token)) {
        seenTokens.add(row.push_token);
        out.deadTokens.push(row.push_token);
      }
      return;
    }

    if (code && TERMINAL_ERRORS.has(code)) {
      out.dead.push({ id: row.id, reason });
      return;
    }

    // MessageRateExceeded is Expo asking us to slow down, not a verdict on
    // the message: always retry with backoff (the backoff doubles per retry,
    // so a persistently throttled row throttles itself).
    if (code === "MessageRateExceeded") {
      out.failed.push({ id: row.id, reason });
      return;
    }

    // InvalidCredentials, unknown codes, missing ticket: retry with backoff
    // until max_retries is reached, then dead-letter.
    const nextRetry = (row.retry_count || 0) + 1;
    const maxRetries = row.max_retries || 3;
    if (nextRetry >= maxRetries) {
      out.dead.push({ id: row.id, reason });
    } else {
      out.failed.push({ id: row.id, reason });
    }
  });

  return out;
}

/** Exponential backoff used by the queue worker: 30s * 2^(retry-1). */
export function backoffSeconds(newRetryCount: number): number {
  return 30 * Math.pow(2, Math.max(0, newRetryCount - 1));
}
