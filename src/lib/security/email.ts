import { NextResponse } from 'next/server';

/**
 * Delivery channel for verification codes.
 *
 * Email is delivered over SMTP. When no SMTP transport is configured the
 * sender is absent and every dependent flow fails closed: a code is never
 * reported as sent, and no code is written to logs or returned to a client.
 */
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

let cachedSender: EmailSender | null | undefined;

function buildSender(): EmailSender | null {
  const host = process.env.TIGEREX_SMTP_HOST;
  const user = process.env.TIGEREX_SMTP_USER;
  const pass = process.env.TIGEREX_SMTP_PASSWORD;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.TIGEREX_SMTP_PORT || 587);
  const from = process.env.TIGEREX_SMTP_FROM || user;

  return {
    async send(to: string, subject: string, text: string) {
      // Required lazily so the module loads even when nodemailer is absent.
      const nodemailer = require('nodemailer');
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

export function getEmailSender(): EmailSender | null {
  if (cachedSender === undefined) {
    cachedSender = buildSender();
  }
  return cachedSender;
}

export function emailDeliveryUnavailable() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
        message:
          'Verification email delivery is unavailable until TIGEREX_SMTP_HOST, TIGEREX_SMTP_USER and TIGEREX_SMTP_PASSWORD are configured.',
      },
    },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  );
}
