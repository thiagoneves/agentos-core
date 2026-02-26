import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { gzipSync } from 'zlib';
import YAML from 'yaml';
import { RegistryClient } from '../../../src/core/registry-client.js';

// ─── Helpers ───

const sampleRegistry = {
  version: '1.0',
  repository: 'https://github.com/thiagoneves/agentos-modules',
  modules: {
    sdlc: {
      description: 'Complete Software Development Lifecycle',
      latest: '1.0.0',
      path: 'sdlc/',
      tags: ['sdlc', 'agile'],
    },
    'data-eng': {
      description: 'Data Engineering Pipeline',
      latest: '0.5.0',
      path: 'data-eng/',
      tags: ['data'],
    },
  },
};

/** Build a minimal tar archive in memory. Each entry is { name, content }. */
function buildTar(entries: Array<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const contentBuf = Buffer.from(entry.content, 'utf8');
    const header = Buffer.alloc(512);

    // File name (bytes 0-99)
    header.write(entry.name, 0, 100, 'utf8');
    // File mode (bytes 100-107)
    header.write('0000644\0', 100, 8, 'utf8');
    // Owner ID (bytes 108-115)
    header.write('0000000\0', 108, 8, 'utf8');
    // Group ID (bytes 116-123)
    header.write('0000000\0', 116, 8, 'utf8');
    // File size in octal (bytes 124-135)
    header.write(contentBuf.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8');
    // Mtime (bytes 136-147)
    header.write('00000000000\0', 136, 12, 'utf8');
    // Type flag: '0' = regular file (byte 156)
    header[156] = 48; // ASCII '0'
    // Checksum placeholder: spaces (bytes 148-155)
    header.fill(0x20, 148, 156);

    // Compute checksum (sum of all bytes in header, treating checksum field as spaces)
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');

    blocks.push(header);

    // File content + padding to 512-byte boundary
    const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
    const contentBlock = Buffer.alloc(paddedSize);
    contentBuf.copy(contentBlock);
    blocks.push(contentBlock);
  }

  // End-of-archive: two zero blocks
  blocks.push(Buffer.alloc(1024));

  return Buffer.concat(blocks);
}

function buildGzippedTarball(entries: Array<{ name: string; content: string }>): Buffer {
  return gzipSync(buildTar(entries));
}

describe('RegistryClient', () => {
  let tempDir: string;
  let client: RegistryClient;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-registry-test-'));
    client = new RegistryClient({
      registryUrl: 'https://example.com/registry.yaml',
      agentosDir: tempDir,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('fetchRegistry', () => {
    it('should fetch and parse registry from URL', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(sampleRegistry),
      }));

      const registry = await client.fetchRegistry();
      expect(registry.version).toBe('1.0');
      expect(registry.modules.sdlc).toBeDefined();
      expect(registry.modules.sdlc.latest).toBe('1.0.0');
      expect(registry.modules['data-eng']).toBeDefined();
    });

    it('should cache registry locally after fetch', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(sampleRegistry),
      }));

      await client.fetchRegistry();

      const cachePath = path.join(tempDir, 'registry-cache.yaml');
      const exists = await fs.access(cachePath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const cached = YAML.parse(await fs.readFile(cachePath, 'utf8'));
      expect(cached.modules.sdlc).toBeDefined();
    });

    it('should fall back to cache when network fails', async () => {
      // Pre-seed cache
      const cachePath = path.join(tempDir, 'registry-cache.yaml');
      await fs.writeFile(cachePath, YAML.stringify(sampleRegistry), 'utf8');

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const registry = await client.fetchRegistry();
      expect(registry.modules.sdlc.latest).toBe('1.0.0');
    });

    it('should fall back to cache when HTTP status is not ok', async () => {
      // Pre-seed cache
      const cachePath = path.join(tempDir, 'registry-cache.yaml');
      await fs.writeFile(cachePath, YAML.stringify(sampleRegistry), 'utf8');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      }));

      const registry = await client.fetchRegistry();
      expect(registry.modules.sdlc).toBeDefined();
    });

    it('should throw when network fails and no cache exists', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      await expect(client.fetchRegistry()).rejects.toThrow('Failed to fetch registry');
    });

    it('should throw when registry has invalid schema', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify({ invalid: true }),
      }));

      await expect(client.fetchRegistry()).rejects.toThrow('Failed to fetch registry');
    });
  });

  describe('lookupModule', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(sampleRegistry),
      }));
    });

    it('should return module info for existing module', async () => {
      const { module: mod, repoUrl } = await client.lookupModule('sdlc');
      expect(mod.latest).toBe('1.0.0');
      expect(mod.path).toBe('sdlc/');
      expect(repoUrl).toBe('https://github.com/thiagoneves/agentos-modules');
    });

    it('should throw with available modules list for unknown module', async () => {
      await expect(client.lookupModule('nonexistent'))
        .rejects.toThrow(/not found in registry.*Available: sdlc, data-eng/);
    });
  });

  describe('downloadModule', () => {
    it('should extract module files from tarball to target directory', async () => {
      const tarball = buildGzippedTarball([
        { name: 'owner-repo-abc123/sdlc/module.yaml', content: 'name: sdlc\nversion: 1.0.0\ndescription: SDLC' },
        { name: 'owner-repo-abc123/sdlc/agents/dev.md', content: '# Developer Agent' },
        { name: 'owner-repo-abc123/other/file.txt', content: 'should be ignored' },
      ]);

      // Mock registry fetch (for lookupModule)
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => YAML.stringify(sampleRegistry),
        })
        // Mock tarball download
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength),
        });
      vi.stubGlobal('fetch', fetchMock);

      const targetDir = path.join(tempDir, 'extracted');
      await fs.mkdir(targetDir, { recursive: true });
      await client.downloadModule('sdlc', targetDir);

      // module.yaml should be extracted
      const manifest = await fs.readFile(path.join(targetDir, 'module.yaml'), 'utf8');
      expect(manifest).toContain('name: sdlc');

      // agents/dev.md should be extracted
      const agent = await fs.readFile(path.join(targetDir, 'agents', 'dev.md'), 'utf8');
      expect(agent).toBe('# Developer Agent');

      // other/file.txt should NOT be extracted
      const otherExists = await fs.access(path.join(targetDir, 'file.txt')).then(() => true).catch(() => false);
      expect(otherExists).toBe(false);
    });

    it('should throw for invalid repository URL', async () => {
      const invalidRegistry = {
        ...sampleRegistry,
        repository: 'https://gitlab.com/some/repo',
      };

      // Override the client's registry URL won't help - we need to mock lookupModule to return a non-github URL
      // Actually, lookupModule calls fetchRegistry which returns the registry
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(invalidRegistry),
      }));

      const targetDir = path.join(tempDir, 'extracted');
      await fs.mkdir(targetDir, { recursive: true });

      // gitlab.com matches the regex, so this won't throw for the URL parsing
      // Let's test with a truly invalid URL
      const brokenRegistry = {
        ...sampleRegistry,
        repository: 'not-a-url',
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        text: async () => YAML.stringify(brokenRegistry),
      }));

      await expect(client.downloadModule('sdlc', targetDir)).rejects.toThrow('Cannot parse GitHub owner/repo');
    });

    it('should throw when tarball download fails', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => YAML.stringify(sampleRegistry),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });
      vi.stubGlobal('fetch', fetchMock);

      const targetDir = path.join(tempDir, 'extracted');
      await fs.mkdir(targetDir, { recursive: true });

      await expect(client.downloadModule('sdlc', targetDir)).rejects.toThrow('Failed to download module tarball');
    });

    it('should throw when no files match module path in tarball', async () => {
      const tarball = buildGzippedTarball([
        { name: 'owner-repo-abc123/other/file.txt', content: 'no matching module' },
      ]);

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => YAML.stringify(sampleRegistry),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength),
        });
      vi.stubGlobal('fetch', fetchMock);

      const targetDir = path.join(tempDir, 'extracted');
      await fs.mkdir(targetDir, { recursive: true });

      await expect(client.downloadModule('sdlc', targetDir)).rejects.toThrow('No files found for module path');
    });
  });
});
