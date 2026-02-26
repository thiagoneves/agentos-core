import fs from 'fs/promises';
import path from 'path';
import { createGunzip } from 'zlib';
import chalk from 'chalk';
import YAML from 'yaml';
import { z } from 'zod';

// ─── Registry Schema ───

export const RegistryModuleSchema = z.object({
  description: z.string(),
  latest: z.string(),
  path: z.string(),
  tags: z.array(z.string()).default([]),
});

export const RegistrySchema = z.object({
  version: z.string(),
  repository: z.string(),
  modules: z.record(z.string(), RegistryModuleSchema),
});

export type Registry = z.infer<typeof RegistrySchema>;
export type RegistryModule = z.infer<typeof RegistryModuleSchema>;

const DEFAULT_REGISTRY_URL =
  'https://raw.githubusercontent.com/thiagoneves/agentos-modules/main/registry.yaml';

const CACHE_FILENAME = 'registry-cache.yaml';

export class RegistryClient {
  private registryUrl: string;
  private cacheDir: string;

  constructor(options: { registryUrl?: string; agentosDir: string }) {
    this.registryUrl = options.registryUrl || DEFAULT_REGISTRY_URL;
    this.cacheDir = options.agentosDir;
  }

  async fetchRegistry(): Promise<Registry> {
    try {
      const response = await fetch(this.registryUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      const raw = YAML.parse(text);
      const registry = RegistrySchema.parse(raw);

      await this.writeCache(text);

      return registry;
    } catch (err) {
      const cached = await this.readCache();
      if (cached) {
        console.log(chalk.yellow('  Using cached registry (network unavailable).'));
        return cached;
      }
      throw new Error(
        `Failed to fetch registry from ${this.registryUrl}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async lookupModule(name: string): Promise<{ module: RegistryModule; repoUrl: string }> {
    const registry = await this.fetchRegistry();
    const mod = registry.modules[name];
    if (!mod) {
      const available = Object.keys(registry.modules).join(', ');
      throw new Error(
        `Module '${name}' not found in registry. Available: ${available}`
      );
    }
    return { module: mod, repoUrl: registry.repository };
  }

  async downloadModule(name: string, targetDir: string): Promise<string> {
    const { module: mod, repoUrl } = await this.lookupModule(name);

    const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) {
      throw new Error(`Cannot parse GitHub owner/repo from: ${repoUrl}`);
    }
    const ownerRepo = match[1].replace(/\.git$/, '');

    // github.com/archive avoids the 60 req/hour API rate limit
    const tarballUrl = `https://github.com/${ownerRepo}/archive/refs/heads/main.tar.gz`;

    console.log(chalk.blue(`  Downloading module '${name}' from registry...`));

    const response = await fetch(tarballUrl, {
      signal: AbortSignal.timeout(60_000),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Failed to download module tarball: HTTP ${response.status}`);
    }

    const modulePath = mod.path.replace(/\/$/, '');
    await this.extractModuleFromTarball(response, modulePath, targetDir);

    return name;
  }

  /**
   * Extracts files matching modulePath from a gzipped tar archive.
   * Uses manual tar parsing (512-byte blocks) to avoid external dependencies.
   */
  private async extractModuleFromTarball(
    response: Response,
    modulePath: string,
    targetDir: string,
  ): Promise<void> {
    const arrayBuffer = await response.arrayBuffer();
    const compressed = Buffer.from(arrayBuffer);

    const decompressed = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = createGunzip();
      gunzip.on('data', (chunk: Buffer) => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks)));
      gunzip.on('error', reject);
      gunzip.end(compressed);
    });

    let offset = 0;
    let filesExtracted = 0;

    while (offset < decompressed.length - 512) {
      const header = decompressed.subarray(offset, offset + 512);

      if (header.every((b: number) => b === 0)) break; // end-of-archive

      const fileName = header.subarray(0, 100).toString('utf8').replace(/\0/g, '');
      const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim();
      const fileSize = parseInt(sizeOctal, 8) || 0;
      const typeFlag = header[156]; // 48='0' regular file, 53='5' directory

      offset += 512;

      // GitHub tarballs have a root prefix like "owner-repo-sha/" — strip it
      const parts = fileName.split('/');
      const relativePath = parts.slice(1).join('/');

      if (relativePath.startsWith(modulePath + '/') || relativePath === modulePath + '/') {
        const localPath = relativePath.substring(modulePath.length + 1);
        if (localPath && typeFlag === 48) {
          const fullPath = path.join(targetDir, localPath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, decompressed.subarray(offset, offset + fileSize));
          filesExtracted++;
        }
      }

      offset += Math.ceil(fileSize / 512) * 512;
    }

    if (filesExtracted === 0) {
      throw new Error(`No files found for module path '${modulePath}' in tarball`);
    }
  }

  // ─── Cache ───

  private get cachePath(): string {
    return path.join(this.cacheDir, CACHE_FILENAME);
  }

  private async writeCache(content: string): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(this.cachePath, content, 'utf8');
    } catch { /* non-fatal */ }
  }

  private async readCache(): Promise<Registry | null> {
    try {
      const content = await fs.readFile(this.cachePath, 'utf8');
      const raw = YAML.parse(content);
      return RegistrySchema.parse(raw);
    } catch {
      return null;
    }
  }
}
