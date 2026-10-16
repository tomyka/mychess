import { userInfo } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditEmailHash, disableAccount, grantAdmin } from '../src';
import { cliActor, runAdminCommand } from '../src/bin/admin-command';
import type * as Client from '../src/client';
import { useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';

/** How many connections the command opened, and how many it closed. */
const pools = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock('../src/client', async (importOriginal) => {
  const real = await importOriginal<typeof Client>();
  return {
    ...real,
    createDb: (url: string): Client.DbHandle => {
      const handle = real.createDb(url);
      pools.opened += 1;
      return {
        db: handle.db,
        close: async () => {
          pools.closed += 1;
          await handle.close();
        },
      };
    },
  };
});

const { db, client, url } = useTestDatabase();
const RUTA_HASH = auditEmailHash('ruta@example.lt');
/** Who the commands record as having acted: the OS user running the tests. */
const ACTOR = `cli:${userInfo().username}`;
const argv = process.argv;
let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  pools.opened = 0;
  pools.closed = 0;
  vi.stubEnv('DATABASE_URL', url);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Runs a script body as `node <script> ...args`. */
const runWith = (args: string[], run: () => Promise<void>): Promise<void> => {
  process.argv = ['node', 'admin.mjs', ...args];
  return run();
};

const audit = async (): Promise<unknown> =>
  (
    await client.query(
      'select action, target_email_hash, actor from admin_audit order by id',
    )
  ).rows;

describe('runAdminCommand', () => {
  it('canonicalises the email, grants as the OS user and reports it', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await runWith(['  Ruta@Example.LT '], () =>
      runAdminCommand('admin:grant', 'granted', grantAdmin),
    );
    expect(out).toEqual(['admin: granted ruta@example.lt\n']);
    expect(err).toEqual([]);
    expect(process.exitCode).toBeUndefined();
    expect(pools).toEqual({ opened: 1, closed: 1 });
    expect(await audit()).toEqual([
      { action: 'grant-admin', target_email_hash: RUTA_HASH, actor: ACTOR },
    ]);
  });

  it('closes the connection even when the change throws', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      runWith(['ruta@example.lt'], () =>
        runAdminCommand('admin:grant', 'granted', failing),
      ),
    ).rejects.toThrow('boom');
    expect(pools).toEqual({ opened: 1, closed: 1 });
  });

  it('reports the disable with its own verb', async () => {
    await seedAccount(db, 'a1', 'ruta@example.lt');
    await runWith(['ruta@example.lt'], () =>
      runAdminCommand('admin:disable', 'disabled', disableAccount),
    );
    expect(out).toEqual(['admin: disabled ruta@example.lt\n']);
    expect(await audit()).toEqual([
      {
        action: 'disable-account',
        target_email_hash: RUTA_HASH,
        actor: ACTOR,
      },
    ]);
  });

  it('prints the refusal and exits 1 for an unknown account', async () => {
    await runWith(['nobody@example.lt'], () =>
      runAdminCommand('admin:grant', 'granted', grantAdmin),
    );
    expect(out).toEqual([]);
    expect(err).toEqual(['admin:grant: admin.accountNotFound\n']);
    expect(process.exitCode).toBe(1);
    expect(pools).toEqual({ opened: 1, closed: 1 });
  });

  it('refuses a missing email before touching the database', async () => {
    const change = vi.fn(grantAdmin);
    await runWith([], () => runAdminCommand('admin:disable', 'x', change));
    expect(change).not.toHaveBeenCalled();
    expect(pools).toEqual({ opened: 0, closed: 0 });
    expect(out).toEqual([]);
    expect(err).toEqual(['admin:disable: account.emailInvalid\n']);
    expect(process.exitCode).toBe(1);
  });
});

describe('cliActor', () => {
  it('names the OS user who ran the command', () => {
    expect(cliActor(() => ({ username: 'ruta' }))).toBe('cli:ruta');
  });

  it('falls back to unknown when the OS cannot name the user', () => {
    const throwing = (): { username: string } => {
      throw new Error('no passwd entry');
    };
    expect(cliActor(throwing)).toBe('cli:unknown');
  });

  it('falls back to unknown for an empty user name', () => {
    expect(cliActor(() => ({ username: '' }))).toBe('cli:unknown');
  });

  it('asks the OS by default', () => {
    expect(cliActor()).toBe(ACTOR);
  });
});
