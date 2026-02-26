import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { snapshotCommand } from '../../../src/commands/snapshot.js';

describe('snapshotCommand', () => {
  let tempDir: string;
  let agentosDir: string;
  let originalCwd: () => string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-snapshot-test-'));
    agentosDir = path.join(tempDir, '.agentos');
    originalCwd = process.cwd;
    process.cwd = () => tempDir;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create a snapshot with default label', async () => {
    // Setup minimal state to snapshot
    await fs.mkdir(path.join(agentosDir, 'state'), { recursive: true });
    await fs.writeFile(path.join(agentosDir, 'state', 'current.yaml'), 'status: idle', 'utf8');

    await snapshotCommand('save', {});

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Snapshot saved');
    expect(output).toContain('manual');
  });

  it('should create a snapshot with custom label', async () => {
    await fs.mkdir(path.join(agentosDir, 'state'), { recursive: true });
    await fs.writeFile(path.join(agentosDir, 'state', 'current.yaml'), 'status: idle', 'utf8');

    await snapshotCommand('save', { label: 'pre-deploy' });

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('Snapshot saved');
    expect(output).toContain('pre-deploy');
  });

  it('should list snapshots (empty)', async () => {
    await snapshotCommand('list', {});

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('No snapshots found');
  });

  it('should list snapshots after saving', async () => {
    await fs.mkdir(path.join(agentosDir, 'state'), { recursive: true });
    await fs.writeFile(path.join(agentosDir, 'state', 'current.yaml'), 'status: idle', 'utf8');

    await snapshotCommand('save', { label: 'v1' });
    logSpy.mockClear();
    await snapshotCommand('list', {});

    const output = logSpy.mock.calls.flat().join(' ');
    expect(output).toContain('v1');
  });

  it('should reject unknown action', async () => {
    await snapshotCommand('delete', {});

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Unknown action: delete")
    );
  });
});
