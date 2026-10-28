import { expect, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { MAILPIT_URL as MAILPIT } from './mailpit-url';

const summarySchema = z.object({ ID: z.string() });
const searchSchema = z.object({ messages: z.array(summarySchema) });
const messageSchema = z.object({ Subject: z.string(), Text: z.string() });

export type Mail = z.infer<typeof messageSchema>;

/**
 * The ids of every message to `to`, newest first. Both Playwright projects
 * share one inbox, so mail is always found by its recipient.
 */
async function idsTo(
  request: APIRequestContext,
  to: string,
): Promise<string[]> {
  const response = await request.get(`${MAILPIT}/api/v1/search`, {
    params: { query: `to:"${to}"` },
  });
  expect(response.ok(), 'Mailpit search answers').toBe(true);
  const { messages } = searchSchema.parse(await response.json());
  return messages.map((message) => message.ID);
}

async function readMail(request: APIRequestContext, id: string): Promise<Mail> {
  const response = await request.get(`${MAILPIT}/api/v1/message/${id}`);
  expect(response.ok(), 'Mailpit message answers').toBe(true);
  return messageSchema.parse(await response.json());
}

/**
 * Runs `send`, then waits for the one new message to `to` it caused, so an
 * older mail to the same address (a previous sign-in) is never read.
 */
export async function nextMailTo(
  request: APIRequestContext,
  to: string,
  send: () => Promise<void>,
): Promise<Mail> {
  const before = new Set(await idsTo(request, to));
  await send();
  let fresh: string | undefined;
  await expect
    .poll(
      async () => {
        fresh = (await idsTo(request, to)).find((id) => !before.has(id));
        return fresh;
      },
      { message: `a new mail to ${to}`, timeout: 15_000 },
    )
    .toBeDefined();
  if (fresh === undefined) throw new Error('expect.poll passed without a mail');
  return readMail(request, fresh);
}

/** The first link in a mail's text. */
export function linkIn(text: string): string {
  const link = /https?:\/\/\S+/.exec(text)?.[0];
  if (link === undefined) throw new Error('no link in the message');
  return link;
}
