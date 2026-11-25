import { describe, expect, it } from 'vitest';
import { MESSAGES } from './catalogue';
import { requestConfigFor } from './request';

describe('the request configuration', () => {
  it('renders English, dates in Vilnius time on the server and in the browser alike (#331)', async () => {
    expect(await requestConfigFor()).toEqual({
      locale: 'en',
      messages: MESSAGES,
      timeZone: 'Europe/Vilnius',
    });
  });
});
