import chalk from 'chalk';
import YAML from 'yaml';
import { ConfigManager } from '../core/config.js';
import { errorMessage } from '../core/errors.js';

export const configGetCommand = async (key?: string) => {
  const configManager = new ConfigManager();

  try {
    if (!(await configManager.exists())) {
      console.error(chalk.red('[AgentOS] Not initialized. Run `aos init` first.'));
      return;
    }

    const config = await configManager.load();

    if (!key) {
      console.log(chalk.bold.blue('\n[Config]\n'));
      console.log(YAML.stringify(config));
      return;
    }

    const value = getNestedValue(config as unknown as Record<string, unknown>, key);
    if (value === undefined) {
      console.error(chalk.red(`[AgentOS] Key '${key}' not found in config.`));
      return;
    }

    if (typeof value === 'object') {
      console.log(YAML.stringify(value));
    } else {
      console.log(String(value));
    }
  } catch (err) {
    console.error(chalk.red(`[AgentOS] Failed to read config: ${errorMessage(err)}`));
  }
};

export const configSetCommand = async (key: string, value: string) => {
  const configManager = new ConfigManager();

  try {
    if (!(await configManager.exists())) {
      console.error(chalk.red('[AgentOS] Not initialized. Run `aos init` first.'));
      return;
    }

    const config = await configManager.load();
    const parsed = parseValue(value);
    setNestedValue(config as unknown as Record<string, unknown>, key, parsed);
    await configManager.update(config);

    console.log(chalk.green(`[AgentOS] Set ${key} = ${JSON.stringify(parsed)}`));
  } catch (err) {
    console.error(chalk.red(`[AgentOS] Failed to update config: ${errorMessage(err)}`));
  }
};

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function parseValue(value: string): string | number | boolean | string[] {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  // Handle arrays like "[a,b,c]"
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
  }
  return value;
}
