import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

/**
 * Write a file atomically using write-to-temp + rename.
 * Prevents corrupted state from partial writes (e.g., process killed mid-write).
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpFile = path.join(dir, `.${path.basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpFile, content, 'utf8');

  try {
    await fs.rename(tmpFile, filePath);
  } catch {
    // Cross-device fallback: copy + unlink
    await fs.copyFile(tmpFile, filePath);
    await fs.unlink(tmpFile).catch(() => {});
  }
}

const activeLocks = new Map<string, Promise<void>>();

/**
 * Execute a read-modify-write operation with a serialization lock.
 * Prevents lost updates when multiple callers write to the same file.
 */
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);

  // Wait for any pending operation on this file
  while (activeLocks.has(key)) {
    await activeLocks.get(key);
  }

  let resolve: () => void;
  const lock = new Promise<void>(r => { resolve = r; });
  activeLocks.set(key, lock);

  try {
    return await fn();
  } finally {
    activeLocks.delete(key);
    resolve!();
  }
}
