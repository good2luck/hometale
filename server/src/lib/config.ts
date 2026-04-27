import crypto from 'node:crypto';
import { getConfigPath, ensureHometaleStructure } from './hometale-path.js';
import { readJsonFile, writeJsonFile, fileExists } from './fs-utils.js';

export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface Config {
  model: ModelConfig;
  token?: string;
}

function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

const DEFAULT_CONFIG: Config = {
  model: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    baseURL: undefined
  }
};

export async function loadConfig(): Promise<Config> {
  await ensureHometaleStructure();
  const configPath = getConfigPath();

  if (!fileExists(configPath)) {
    const configWithToken = { ...DEFAULT_CONFIG, token: generateToken() };
    await writeJsonFile(configPath, configWithToken);
    return configWithToken;
  }

  const config = await readJsonFile<Config>(configPath);
  if (!config) {
    const configWithToken = { ...DEFAULT_CONFIG, token: generateToken() };
    await writeJsonFile(configPath, configWithToken);
    return configWithToken;
  }

  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Generate token if missing
  if (!mergedConfig.token) {
    mergedConfig.token = generateToken();
    await saveConfig(mergedConfig);
  }

  return mergedConfig;
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureHometaleStructure();
  await writeJsonFile(getConfigPath(), config);
}
