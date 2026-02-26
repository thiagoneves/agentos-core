import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SnapshotManager } from '../../../src/core/snapshot-manager.js';

describe('SnapshotManager', () => {
  let tempDir: string;
  let manager: SnapshotManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-snap-test-'));
    const agentosDir = path.join(tempDir, '.agentos');

    // Create some state to snapshot
    await fs.mkdir(path.join(agentosDir, 'state', 'sessions'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'memory'), { recursive: true });
    await fs.mkdir(path.join(agentosDir, 'artifacts'), { recursive: true });

    await fs.writeFile(
      path.join(agentosDir, 'state', 'sessions', 'sess-1.json'),
      JSON.stringify({ sessionId: 'sess-1', status: 'running' })
    );
    await fs.writeFile(
      path.join(agentosDir, 'artifacts', 'doc.md'),
      '# My Doc'
    );

    // SnapshotManager uses process.cwd() — we need to override
    // Since SnapshotManager doesn't accept baseDir, we mock cwd
    const origCwd = process.cwd;
    process.cwd = () => tempDir;
    manager = new SnapshotManager();
    process.cwd = origCwd;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create a snapshot with integrity file', async () => {
    const name = await manager.createSnapshot('test');
    expect(name).toContain('test');

    const snapshotPath = path.join(tempDir, '.agentos', 'snapshots', name);
    const integrityExists = await fs.access(path.join(snapshotPath, '.integrity')).then(() => true).catch(() => false);
    expect(integrityExists).toBe(true);

    // Should contain backed up files
    const sessionExists = await fs.access(path.join(snapshotPath, 'state', 'sessions', 'sess-1.json')).then(() => true).catch(() => false);
    expect(sessionExists).toBe(true);
  });

  it('should list snapshots in reverse chronological order', async () => {
    await manager.createSnapshot('first');
    await new Promise(r => setTimeout(r, 10)); // ensure different timestamps
    await manager.createSnapshot('second');

    const list = await manager.listSnapshots();
    expect(list).toHaveLength(2);
    expect(list[0]).toContain('second');
    expect(list[1]).toContain('first');
  });

  it('should rollback to a snapshot successfully', async () => {
    const name = await manager.createSnapshot('before-change');

    // Modify the state
    await fs.writeFile(
      path.join(tempDir, '.agentos', 'state', 'sessions', 'sess-1.json'),
      JSON.stringify({ sessionId: 'sess-1', status: 'MODIFIED' })
    );

    await manager.rollback(name);

    // Should be restored to original
    const content = JSON.parse(
      await fs.readFile(path.join(tempDir, '.agentos', 'state', 'sessions', 'sess-1.json'), 'utf8')
    );
    expect(content.status).toBe('running');
  });

  it('should reject rollback of corrupted snapshot', async () => {
    const name = await manager.createSnapshot('to-corrupt');

    // Corrupt the snapshot by modifying a file
    const snapshotPath = path.join(tempDir, '.agentos', 'snapshots', name);
    await fs.writeFile(
      path.join(snapshotPath, 'state', 'sessions', 'sess-1.json'),
      'CORRUPTED DATA'
    );

    await expect(manager.rollback(name)).rejects.toThrow('integrity check failed');
  });

  it('should throw on rollback to non-existent snapshot', async () => {
    await expect(manager.rollback('does-not-exist')).rejects.toThrow('not found');
  });
});
