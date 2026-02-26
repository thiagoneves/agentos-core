import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { gzipSync } from 'zlib';
import { ModuleManager } from '../../../src/core/module-manager.js';
import { ConfigManager } from '../../../src/core/config.js';

/** Build a minimal tar archive in memory. */
function buildTar(entries: Array<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const contentBuf = Buffer.from(entry.content, 'utf8');
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'utf8');
    header.write('0000000\0', 108, 8, 'utf8');
    header.write('0000000\0', 116, 8, 'utf8');
    header.write(contentBuf.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8');
    header.write('00000000000\0', 136, 12, 'utf8');
    header[156] = 48;
    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
    blocks.push(header);
    const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
    const contentBlock = Buffer.alloc(paddedSize);
    contentBuf.copy(contentBlock);
    blocks.push(contentBlock);
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

const sampleRegistry = {
  version: '1.0',
  repository: 'https://github.com/thiagoneves/agentos-modules',
  modules: {
    sdlc: {
      description: 'Complete Software Development Lifecycle',
      latest: '1.0.0',
      path: 'sdlc/',
      tags: ['sdlc'],
    },
  },
};

describe('ModuleManager', () => {
  let tempDir: string;
  let manager: ModuleManager;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-module-test-'));
    manager = new ModuleManager(tempDir);
    configManager = new ConfigManager(tempDir);
    await configManager.init({
      project: { name: 'test', state: 'greenfield', output_language: 'English', runner: 'Claude Code', profile: 'solo' },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('install', () => {
    it('should install a module from a local path', async () => {
      const dummyModulePath = path.join(tempDir, 'dummy-module');
      await fs.mkdir(path.join(dummyModulePath, 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(dummyModulePath, 'module.yaml'),
        YAML.stringify({ name: 'dummy', version: '1.0.0', description: 'Test module' })
      );
      await fs.writeFile(path.join(dummyModulePath, 'agents', 'test.md'), '# Test Agent');

      const moduleName = await manager.install(dummyModulePath);
      expect(moduleName).toBe('dummy');

      const installedPath = path.join(tempDir, '.agentos', 'modules', 'dummy');
      const exists = await fs.access(installedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const config = await configManager.load();
      expect(config.modules.installed).toContainEqual(expect.objectContaining({ name: 'dummy' }));

      const lockPath = path.join(tempDir, '.agentos', 'manifest.lock');
      const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
      expect(lockExists).toBe(true);
    });

    it('should copy nested directories', async () => {
      const modPath = path.join(tempDir, 'nested-mod');
      await fs.mkdir(path.join(modPath, 'agents', 'sub'), { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'module.yaml'),
        YAML.stringify({ name: 'nested', version: '1.0.0', description: 'Nested' })
      );
      await fs.writeFile(path.join(modPath, 'agents', 'sub', 'deep.md'), '# Deep agent');

      await manager.install(modPath);

      const deepFile = path.join(tempDir, '.agentos', 'modules', 'nested', 'agents', 'sub', 'deep.md');
      const exists = await fs.access(deepFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should exclude .git and node_modules', async () => {
      const modPath = path.join(tempDir, 'gitmod');
      await fs.mkdir(path.join(modPath, '.git'), { recursive: true });
      await fs.mkdir(path.join(modPath, 'node_modules'), { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'module.yaml'),
        YAML.stringify({ name: 'gitmod', version: '1.0.0', description: 'Git test' })
      );
      await fs.writeFile(path.join(modPath, '.git', 'HEAD'), 'ref: refs/heads/main');
      await fs.writeFile(path.join(modPath, 'node_modules', 'pkg.json'), '{}');

      await manager.install(modPath);

      const gitExists = await fs.access(
        path.join(tempDir, '.agentos', 'modules', 'gitmod', '.git')
      ).then(() => true).catch(() => false);
      expect(gitExists).toBe(false);

      const nmExists = await fs.access(
        path.join(tempDir, '.agentos', 'modules', 'gitmod', 'node_modules')
      ).then(() => true).catch(() => false);
      expect(nmExists).toBe(false);
    });

    it('should update existing module on re-install', async () => {
      const modPath = path.join(tempDir, 'updatable');
      await fs.mkdir(modPath, { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'module.yaml'),
        YAML.stringify({ name: 'updatable', version: '1.0.0', description: 'v1' })
      );
      await manager.install(modPath);

      // Update version
      await fs.writeFile(
        path.join(modPath, 'module.yaml'),
        YAML.stringify({ name: 'updatable', version: '2.0.0', description: 'v2' })
      );
      await manager.install(modPath);

      const config = await configManager.load();
      const mod = config.modules.installed.filter(m => m.name === 'updatable');
      expect(mod).toHaveLength(1);
      expect(mod[0].version).toBe('2.0.0');
    });

    it('should reject install when dependencies are missing', async () => {
      const modPath = path.join(tempDir, 'dependent');
      await fs.mkdir(modPath, { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'module.yaml'),
        YAML.stringify({
          name: 'dependent',
          version: '1.0.0',
          description: 'Depends on core',
          depends_on: [{ name: 'core-module' }],
        })
      );

      await expect(manager.install(modPath)).rejects.toThrow('requires: core-module');
    });

    it('should accept install when dependencies are satisfied', async () => {
      // Install the dependency first
      const corePath = path.join(tempDir, 'core-module');
      await fs.mkdir(corePath, { recursive: true });
      await fs.writeFile(
        path.join(corePath, 'module.yaml'),
        YAML.stringify({ name: 'core-module', version: '1.0.0', description: 'Core' })
      );
      await manager.install(corePath);

      // Now install the dependent module
      const depPath = path.join(tempDir, 'dependent');
      await fs.mkdir(depPath, { recursive: true });
      await fs.writeFile(
        path.join(depPath, 'module.yaml'),
        YAML.stringify({
          name: 'dependent',
          version: '1.0.0',
          description: 'Depends on core',
          depends_on: [{ name: 'core-module' }],
        })
      );

      const name = await manager.install(depPath);
      expect(name).toBe('dependent');
    });

    it('should reject invalid GitHub source format', async () => {
      await expect(manager.install('github:invalid')).rejects.toThrow('Invalid GitHub source');
    });

    it('should handle pack.yaml compatibility', async () => {
      const modPath = path.join(tempDir, 'packmod');
      await fs.mkdir(modPath, { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'pack.yaml'),
        YAML.stringify({
          pack: { name: 'packmod', version: '1.0.0', description: 'Pack format' },
        })
      );

      const name = await manager.install(modPath);
      expect(name).toBe('packmod');
    });
  });

  describe('remove', () => {
    it('should remove an installed module', async () => {
      const dummyModulePath = path.join(tempDir, 'dummy-module');
      await fs.mkdir(dummyModulePath, { recursive: true });
      await fs.writeFile(
        path.join(dummyModulePath, 'module.yaml'),
        YAML.stringify({ name: 'removable', version: '1.0.0', description: 'Test' })
      );
      await manager.install(dummyModulePath);

      await manager.remove('removable');

      const exists = await fs.access(path.join(tempDir, '.agentos', 'modules', 'removable')).then(() => true).catch(() => false);
      expect(exists).toBe(false);

      const config = await configManager.load();
      expect(config.modules.installed.find(m => m.name === 'removable')).toBeUndefined();
    });

    it('should throw when removing non-existent module', async () => {
      await expect(manager.remove('nonexistent')).rejects.toThrow('not installed');
    });
  });

  describe('listInstalled', () => {
    it('should list installed modules', async () => {
      const dummyModulePath = path.join(tempDir, 'dummy-module');
      await fs.mkdir(dummyModulePath, { recursive: true });
      await fs.writeFile(
        path.join(dummyModulePath, 'module.yaml'),
        YAML.stringify({ name: 'listed', version: '2.0.0', description: 'Listed module' })
      );
      await manager.install(dummyModulePath);

      const installed = await manager.listInstalled();
      expect(installed).toHaveLength(1);
      expect(installed[0].name).toBe('listed');
      expect(installed[0].version).toBe('2.0.0');
    });

    it('should return empty array when no modules installed', async () => {
      const installed = await manager.listInstalled();
      expect(installed).toHaveLength(0);
    });

    it('should skip invalid modules', async () => {
      // Create a module directory without a valid manifest
      const invalidPath = path.join(tempDir, '.agentos', 'modules', 'broken');
      await fs.mkdir(invalidPath, { recursive: true });
      await fs.writeFile(path.join(invalidPath, 'not-a-manifest.txt'), 'garbage');

      const installed = await manager.listInstalled();
      expect(installed).toHaveLength(0);
    });
  });

  describe('getAvailableModules', () => {
    it('should return modules from remote registry', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(sampleRegistry),
      }));

      const available = await manager.getAvailableModules();
      expect(available).toHaveLength(1);
      expect(available[0].name).toBe('sdlc');
      expect(available[0].builtin).toBe(false);
    });

    it('should fall back to hardcoded list when registry is unavailable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const available = await manager.getAvailableModules();
      expect(available.length).toBeGreaterThanOrEqual(1);
      expect(available.find(m => m.name === 'sdlc')).toBeDefined();
    });
  });

  describe('install from registry', () => {
    it('should download and install a module from registry when bare name is given', async () => {
      const tarball = gzipSync(buildTar([
        {
          name: 'owner-repo-abc123/sdlc/module.yaml',
          content: YAML.stringify({ name: 'sdlc', version: '1.0.0', description: 'SDLC Module' }),
        },
        { name: 'owner-repo-abc123/sdlc/agents/dev.md', content: '# Dev Agent' },
      ]));

      const fetchMock = vi.fn()
        // First call: fetchRegistry (from getRegistryClient -> lookupModule)
        .mockResolvedValueOnce({
          ok: true,
          text: async () => YAML.stringify(sampleRegistry),
        })
        // Second call: tarball download
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength),
        });
      vi.stubGlobal('fetch', fetchMock);

      const moduleName = await manager.install('sdlc');
      expect(moduleName).toBe('sdlc');

      // Verify module was installed
      const installedPath = path.join(tempDir, '.agentos', 'modules', 'sdlc');
      const exists = await fs.access(installedPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify agents subdir was extracted
      const agentFile = path.join(installedPath, 'agents', 'dev.md');
      const agentExists = await fs.access(agentFile).then(() => true).catch(() => false);
      expect(agentExists).toBe(true);

      // Verify config was updated with source: 'registry'
      const config = await configManager.load();
      const mod = config.modules.installed.find(m => m.name === 'sdlc');
      expect(mod).toBeDefined();
      expect(mod!.source).toBe('registry');
    });

    it('should throw when module not found in registry', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(sampleRegistry),
      }));

      await expect(manager.install('nonexistent')).rejects.toThrow('not found in registry');
    });
  });

  describe('loadManifest', () => {
    it('should load module.yaml', async () => {
      const modPath = path.join(tempDir, 'testmod');
      await fs.mkdir(modPath, { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'module.yaml'),
        YAML.stringify({ name: 'testmod', version: '1.0.0', description: 'Desc' })
      );

      const manifest = await manager.loadManifest(modPath);
      expect(manifest.name).toBe('testmod');
      expect(manifest.version).toBe('1.0.0');
    });

    it('should fall back to pack.yaml', async () => {
      const modPath = path.join(tempDir, 'packmod');
      await fs.mkdir(modPath, { recursive: true });
      await fs.writeFile(
        path.join(modPath, 'pack.yaml'),
        YAML.stringify({ pack: { name: 'packmod', version: '2.0.0', description: 'Pack' } })
      );

      const manifest = await manager.loadManifest(modPath);
      expect(manifest.name).toBe('packmod');
    });

    it('should throw when no manifest found', async () => {
      const modPath = path.join(tempDir, 'empty');
      await fs.mkdir(modPath, { recursive: true });

      await expect(manager.loadManifest(modPath)).rejects.toThrow('No valid module.yaml');
    });
  });
});
