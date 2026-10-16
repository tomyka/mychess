import type { Locale } from '@mychess/domain';
import { createTranslator } from 'next-intl';
import { MESSAGES } from '../i18n/locales';
import type { WebEnv } from './env';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  readonly send: (message: MailMessage) => Promise<void>;
}

function mailText(locale: Locale) {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: 'mail',
  });
}

export function magicLinkMail(
  locale: Locale,
  to: string,
  url: string,
): MailMessage {
  const t = mailText(locale);
  return {
    to,
    subject: t('magicLink.subject'),
    text: t('magicLink.body', { url }),
  };
}

export function deletedMail(locale: Locale, to: string): MailMessage {
  const t = mailText(locale);
  return { to, subject: t('deleted.subject'), text: t('deleted.body') };
}

type MailEnv = Pick<
  WebEnv,
  'MAIL_TRANSPORT' | 'MAIL_FROM' | 'MAILPIT_URL' | 'RESEND_API_KEY'
>;

type MailRequest = (message: MailMessage) => [string, RequestInit];

interface MailpitAddress {
  readonly Email: string;
  readonly Name?: string;
}

// Mailpit's From.Email takes a bare address: 'mychess <a@b.lt>' becomes
// { Email: 'a@b.lt', Name: 'mychess' }. Anything else is sent as it is.
function mailpitAddress(from: string): MailpitAddress {
  const sender = from.trim();
  const open = sender.lastIndexOf('<');
  if (open === -1 || !sender.endsWith('>')) return { Email: sender };
  const email = sender.slice(open + 1, -1);
  const name = sender.slice(0, open).trim();
  return name === '' ? { Email: email } : { Email: email, Name: name };
}

const json = { 'content-type': 'application/json' };

function resendRequest(from: string, apiKey: string): MailRequest {
  return (m) => [
    'https://api.resend.com/emails',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, ...json },
      body: JSON.stringify({
        from,
        to: [m.to],
        subject: m.subject,
        text: m.text,
      }),
    },
  ];
}

function mailpitRequest(from: string, mailpitUrl: string): MailRequest {
  return (m) => [
    `${mailpitUrl}/api/v1/send`,
    {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        From: mailpitAddress(from),
        To: [{ Email: m.to }],
        Subject: m.subject,
        Text: m.text,
      }),
    },
  ];
}

// webEnvSchema already demands these; a caller passing an unparsed env is a
// programmer error.
function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`mail: ${name} is not set`);
  return value;
}

function mailRequest(env: MailEnv): MailRequest {
  return env.MAIL_TRANSPORT === 'resend'
    ? resendRequest(
        env.MAIL_FROM,
        required(env.RESEND_API_KEY, 'RESEND_API_KEY'),
      )
    : mailpitRequest(env.MAIL_FROM, required(env.MAILPIT_URL, 'MAILPIT_URL'));
}

/** Resend on staging and production, Mailpit locally and in E2E (R-27). */
export function createMailer(
  env: MailEnv,
  fetchImpl: typeof fetch = fetch,
): Mailer {
  const request = mailRequest(env);
  return {
    send: async (message) => {
      const response = await fetchImpl(...request(message));
      if (!response.ok) {
        throw new Error(
          `mail: ${env.MAIL_TRANSPORT} answered ${String(response.status)}`,
        );
      }
    },
  };
}
