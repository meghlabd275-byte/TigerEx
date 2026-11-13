/**
 * Delivery channel for verification codes sent by SMS.
 *
 * Delivery goes to a carrier gateway over HTTPS. The endpoint, credential and
 * sender id are operator configuration; when any is missing the sender is
 * absent and every dependent flow fails closed, so a code is never reported as
 * sent when no provider could carry it.
 *
 * The transport is deliberately provider-neutral (a JSON webhook): it does not
 * depend on a specific carrier's SDK, so a deployment points it at whichever
 * gateway it has contracted with.
 */

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

let cachedSender: SmsSender | null | undefined;

function buildSender(): SmsSender | null {
  const url = process.env.TIGEREX_SMS_WEBHOOK_URL;
  const key = process.env.TIGEREX_SMS_API_KEY;
  if (!url || !key) return null;

  const from = process.env.TIGEREX_SMS_FROM || 'TigerEx';
  const authHeader = process.env.TIGEREX_SMS_AUTH_HEADER || 'Authorization';
  // Default to a bearer token; a provider that expects a bare key or a custom
  // scheme sets TIGEREX_SMS_AUTH_SCHEME (an empty value sends the key alone).
  const scheme = process.env.TIGEREX_SMS_AUTH_SCHEME ?? 'Bearer ';

  return {
    async send(to: string, text: string) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [authHeader]: `${scheme}${key}`,
        },
        body: JSON.stringify({ to, from, text }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error(`SMS provider responded with HTTP ${response.status}`);
      }
    },
  };
}

export function getSmsSender(): SmsSender | null {
  if (cachedSender === undefined) {
    cachedSender = buildSender();
  }
  return cachedSender;
}

/** Reset the cached sender; used by tests that change the environment. */
export function resetSmsSender(): void {
  cachedSender = undefined;
}
