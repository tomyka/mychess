// One gate run at a time in a working tree. Two runs at once share coverage/
// (one deletes the other's coverage/.tmp) and the db suite's timeouts, so a
// second run waits for the first. The lock is a file holding the holder's pid;
// a lock whose pid is no longer running is taken over.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const LOCK_DIR = join(ROOT, 'node_modules', '.cache', 'ts-quality');
export const LOCK_FILE = join(LOCK_DIR, 'gate.lock');
const POLL_MS = 2000;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
}

function holderOf() {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  } catch {
    return null; // gone meanwhile, or half written
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tryCreate(label) {
  try {
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({
        pid: process.pid,
        label,
        since: new Date().toISOString(),
      }),
      { flag: 'wx' },
    );
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Take the lock, waiting up to `timeoutMs` for another run to finish.
 * Returns null when held, or the reason it could not be taken.
 */
export function acquireGateLock(label, timeoutMs) {
  mkdirSync(LOCK_DIR, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    if (tryCreate(label)) {
      const release = () => {
        if (holderOf()?.pid === process.pid) rmSync(LOCK_FILE, { force: true });
      };
      process.on('exit', release);
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
        process.on(signal, () => process.exit(130));
      return null;
    }
    const holder = holderOf();
    if (holder && !isRunning(holder.pid)) {
      console.log(
        `Taking over a stale gate lock (pid ${holder.pid} is not running).`,
      );
      rmSync(LOCK_FILE, { force: true });
      continue;
    }
    if (Date.now() >= deadline)
      return `Gave up after ${Math.round(timeoutMs / 1000)} s: another gate run (pid ${holder?.pid ?? '?'}, "${holder?.label ?? '?'}", since ${holder?.since ?? '?'}) still holds ${LOCK_FILE}.`;
    if (!announced && holder) {
      console.log(
        `Waiting for another gate run to finish (pid ${holder.pid}, "${holder.label}", since ${holder.since})...`,
      );
      announced = true;
    }
    sleep(POLL_MS);
  }
}
