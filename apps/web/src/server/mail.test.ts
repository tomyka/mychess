import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import { createMailer, deletedMail, magicLinkMail } from './mail';

const { lt, en } = MESSAGES;

const message = {
  to: 'ruta@example.lt',
  subject: 'Prisijungimas prie mychess',
  text: 'Nuoroda: https://app/x?token=t',
};

function okFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{}', { status: 200 }));
}

function sentBody(fetchMock: ReturnType<typeof okFetch>): unknown {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('expected a JSON string body');
  return JSON.parse(body);
}

// The request fetch was called with, the body left out (sentBody reads it).
function sentRequest(fetchMock: ReturnType<typeof okFetch>) {
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  return { url, method: init?.method, headers: init?.headers };
}

const mailpit = {
  MAIL_TRANSPORT: 'mailpit',
  MAIL_FROM: 'mychess <noreply@mychess.test>',
  MAILPIT_URL: 'http://mp:8025',
} as const;

const resend = {
  MAIL_TRANSPORT: 'resend',
  MAIL_FROM: 'mychess <noreply@mychess.lt>',
  RESEND_API_KEY: 're_x',
} as const;

describe('magicLinkMail', () => {
  it('writes the link into a Lithuanian message from the catalogue', () => {
    expect(
      magicLinkMail('lt', 'ruta@example.lt', 'https://app/x?token=t'),
    ).toEqual({
      to: 'ruta@example.lt',
      subject: lt.mail.magicLink.subject,
      text: lt.mail.magicLink.body.replace('{url}', 'https://app/x?token=t'),
    });
  });

  it('writes the link into an English message from the catalogue', () => {
    expect(magicLinkMail('en', 'a@b.lt', 'https://app/y')).toEqual({
      to: 'a@b.lt',
      subject: en.mail.magicLink.subject,
      text: en.mail.magicLink.body.replace('{url}', 'https://app/y'),
    });
  });
});

describe('deletedMail', () => {
  it('tells the person in Lithuanian that the account is gone', () => {
    expect(deletedMail('lt', 'ruta@example.lt')).toEqual({
      to: 'ruta@example.lt',
      subject: lt.mail.deleted.subject,
      text: lt.mail.deleted.body,
    });
  });

  it('tells the person in English that the account is gone', () => {
    expect(deletedMail('en', 'a@b.lt')).toEqual({
      to: 'a@b.lt',
      subject: en.mail.deleted.subject,
      text: en.mail.deleted.body,
    });
  });
});

describe('createMailer with Mailpit', () => {
  it('posts the message as JSON to the send API', async () => {
    const fetchMock = okFetch();
    await createMailer(mailpit, fetchMock).send(message);
    expect(sentRequest(fetchMock)).toEqual({
      url: 'http://mp:8025/api/v1/send',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(sentBody(fetchMock)).toEqual({
      From: { Email: 'noreply@mychess.test', Name: 'mychess' },
      To: [{ Email: 'ruta@example.lt' }],
      Subject: message.subject,
      Text: message.text,
    });
  });

  it('sends a bare sender address without a name', async () => {
    const fetchMock = okFetch();
    await createMailer(
      { ...mailpit, MAIL_FROM: 'noreply@mychess.test' },
      fetchMock,
    ).send(message);
    expect(sentBody(fetchMock)).toMatchObject({
      From: { Email: 'noreply@mychess.test' },
    });
    expect(sentBody(fetchMock)).not.toHaveProperty('From.Name');
  });

  it('trims the sender name and keeps its inner spaces', async () => {
    const fetchMock = okFetch();
    await createMailer(
      { ...mailpit, MAIL_FROM: '  my chess   <a@b.lt> ' },
      fetchMock,
    ).send(message);
    expect(sentBody(fetchMock)).toMatchObject({
      From: { Email: 'a@b.lt', Name: 'my chess' },
    });
  });

  it('sends an address in angle brackets without a name', async () => {
    const fetchMock = okFetch();
    await createMailer({ ...mailpit, MAIL_FROM: '<a@b.lt>' }, fetchMock).send(
      message,
    );
    expect(sentBody(fetchMock)).toEqual(
      expect.objectContaining({ From: { Email: 'a@b.lt' } }),
    );
  });

  it.each([' noreply@mychess.test ', 'a@b.lt>', 'mychess <a@b.lt'])(
    'sends a sender that is not "name <address>", %j, as it is, trimmed',
    async (from) => {
      const fetchMock = okFetch();
      await createMailer({ ...mailpit, MAIL_FROM: from }, fetchMock).send(
        message,
      );
      expect(sentBody(fetchMock)).toMatchObject({
        From: { Email: from.trim() },
      });
      expect(sentBody(fetchMock)).not.toHaveProperty('From.Name');
    },
  );

  it('refuses to start without a Mailpit URL', () => {
    expect(() =>
      createMailer(
        { MAIL_TRANSPORT: 'mailpit', MAIL_FROM: 'a@b.lt' },
        okFetch(),
      ),
    ).toThrow('mail: MAILPIT_URL is not set');
  });

  it('throws when Mailpit refuses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('no', { status: 400 }));
    await expect(
      createMailer(mailpit, fetchMock).send(message),
    ).rejects.toThrow('mail: mailpit answered 400');
  });
});

describe('createMailer with Resend', () => {
  it('posts to Resend with its key', async () => {
    const fetchMock = okFetch();
    await createMailer(resend, fetchMock).send(message);
    expect(sentRequest(fetchMock)).toEqual({
      url: 'https://api.resend.com/emails',
      method: 'POST',
      headers: {
        authorization: 'Bearer re_x',
        'content-type': 'application/json',
      },
    });
    expect(sentBody(fetchMock)).toEqual({
      from: 'mychess <noreply@mychess.lt>',
      to: ['ruta@example.lt'],
      subject: message.subject,
      text: message.text,
    });
  });

  it('refuses to start without a Resend key', () => {
    expect(() =>
      createMailer(
        { MAIL_TRANSPORT: 'resend', MAIL_FROM: 'a@b.lt' },
        okFetch(),
      ),
    ).toThrow('mail: RESEND_API_KEY is not set');
  });

  it('throws when the provider refuses, so the sign-in fails loudly', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('no', { status: 500 }));
    await expect(createMailer(resend, fetchMock).send(message)).rejects.toThrow(
      'mail: resend answered 500',
    );
  });
});
