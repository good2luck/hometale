import inquirer from 'inquirer';
import {
  loadConfig,
  saveConfig,
  ensureHometaleStructure,
  type Config
} from '@hometale/server';
import {
  initGateway,
  loadRegisteredAccounts,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
  saveWeixinAccount,
  DEFAULT_BASE_URL
} from '@hometale/server';
import { getStatus, getPort } from './lib/daemon.js';

export { loadConfig } from '@hometale/server';

async function setupWeixinLogin() {
  console.log('\n📱 配置微信登录\n');

  await initGateway();
  loadRegisteredAccounts();

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl: DEFAULT_BASE_URL,
    verbose: true,
  });

  if (!startResult.qrcodeUrl) {
    console.error('获取二维码失败:', startResult.message);
    return;
  }

  console.log('\n=== 微信扫码登录 ===');
  console.log('用微信扫描下方二维码:\n');

  try {
    const qrcodeTerminal = await import('qrcode-terminal');
    await new Promise<void>((resolve) => {
      qrcodeTerminal.default.generate(startResult.qrcodeUrl!, { small: true }, (qr: string) => {
        console.log(qr);
        console.log('\n或者在浏览器中打开以下链接扫描:');
        console.log(startResult.qrcodeUrl!);
        console.log('\n等待扫描和确认...');
        resolve();
      });
    });
  } catch {
    console.log('在浏览器中打开以下链接扫描:');
    console.log(startResult.qrcodeUrl!);
    console.log('\n等待扫描和确认...');
  }

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
    timeoutMs: 480000,
    verbose: true,
    onQrRefresh: (newUrl: string) => {
      console.log('\n二维码已刷新，新链接:');
      console.log(newUrl);
    },
  });

  if (waitResult.connected && waitResult.botToken && waitResult.accountId) {
    const normalizedId = saveWeixinAccount(waitResult.accountId, {
      token: waitResult.botToken,
      baseUrl: waitResult.baseUrl,
      userId: waitResult.userId,
    });

    console.log('\n✅ 微信登录成功!');
    console.log(`账号 ID: ${normalizedId}`);

    // 检查守护进程是否运行
    const daemonStatus = getStatus();
    if (daemonStatus.running) {
      const port = getPort();
      try {
        const resp = await fetch(`http://localhost:${port}/api/weixin/reload`, { method: 'POST' });
        if (resp.ok) {
          console.log('\n已自动加入守护进程轮询');
        }
      } catch {
        console.log('\n守护进程运行中，请手动重启以加载新账号: hometale stop && hometale start');
      }
    } else {
      console.log('\n📱 下一步:');
      console.log('  运行: hometale start');
      console.log('  然后就可以通过微信对话了!');
    }
  } else {
    console.error('\n❌ 登录失败:', waitResult.message);
  }
}

async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  try {
    const url = baseURL.endsWith('/') ? `${baseURL}models` : `${baseURL}/models`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as any;
    if (data && Array.isArray(data.data)) {
      return data.data
        .map((m: any) => m.id)
        .filter((id: string) => typeof id === 'string')
        .sort();
    }

    return [];
  } catch {
    return [];
  }
}

export async function configWizard(existingConfig?: Config): Promise<Config> {
  await ensureHometaleStructure();

  const config = existingConfig || await loadConfig();

  console.log('\n🤖 HomeTale 配置向导\n');

  // 如果已配置模型，询问是否跳过
  let finalConfig = config;

  if (config.model.apiKey) {
    console.log(`当前模型配置:`);
    console.log(`  提供商: ${config.model.provider}`);
    console.log(`  模型: ${config.model.model}`);
    console.log(`  API Key: ${config.model.apiKey.substring(0, 8)}...`);
    if (config.model.baseURL) {
      console.log(`  Base URL: ${config.model.baseURL}`);
    }
    console.log();

    const skipAnswer = await inquirer.prompt([{
      type: 'confirm',
      name: 'skipModel',
      message: '是否跳过模型配置？',
      default: true
    }]);

    if (!skipAnswer.skipModel) {
      finalConfig = await configureModel(config);
    }
  } else {
    finalConfig = await configureModel(config);
  }

  // 询问是否配置微信
  const weixinAnswer = await inquirer.prompt([{
    type: 'confirm',
    name: 'setupWeixin',
    message: '是否配置微信登录? (可以稍后运行 hometale weixin login 配置)',
    default: false
  }]);

  if (weixinAnswer.setupWeixin) {
    await setupWeixinLogin();
  }

  return finalConfig;
}

async function configureModel(existingConfig: Config): Promise<Config> {
  const providerAnswer = await inquirer.prompt([{
    type: 'list',
    name: 'provider',
    message: '选择模型提供商:',
    choices: [
      { name: 'OpenAI', value: 'openai' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: '自定义 (支持国产模型)', value: 'custom' }
    ],
    default: existingConfig.model.provider
  }]);

  const apiKeyAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'apiKey',
    message: '输入 API Key:',
    default: existingConfig.model.apiKey || undefined
  }]);

  const baseURLAnswer = await inquirer.prompt([{
    type: 'input',
    name: 'baseURL',
    message: providerAnswer.provider === 'custom'
      ? '输入 Base URL (例如: https://api.example.com/v1):'
      : '输入 Base URL (可选，直接回车跳过):',
    default: existingConfig.model.baseURL || undefined
  }]);

  let selectedModel = existingConfig.model.model;
  let defaultModel: string;

  switch (providerAnswer.provider) {
    case 'openai':
      defaultModel = 'gpt-4o';
      break;
    case 'anthropic':
      defaultModel = 'claude-3-5-sonnet-20241022';
      break;
    case 'custom':
    default:
      defaultModel = 'gpt-4o';
  }

  if (providerAnswer.provider === 'openai' || providerAnswer.provider === 'custom') {
    const baseURLForFetch = baseURLAnswer.baseURL || 'https://api.openai.com/v1';
    console.log('\n🔍 正在获取模型列表...');
    const models = await fetchModels(baseURLForFetch, apiKeyAnswer.apiKey);

    if (models.length > 0) {
      const modelChoices = [
        ...models.map(m => ({ name: m, value: m })),
        new inquirer.Separator(),
        { name: '手动输入模型名称...', value: '__custom__' }
      ];

      const modelSelectAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'model',
        message: '选择模型:',
        choices: modelChoices,
        default: existingConfig.model.model || defaultModel
      }]);

      if (modelSelectAnswer.model === '__custom__') {
        const customModelAnswer = await inquirer.prompt([{
          type: 'input',
          name: 'model',
          message: '输入模型名称:',
          default: defaultModel
        }]);
        selectedModel = customModelAnswer.model;
      } else {
        selectedModel = modelSelectAnswer.model;
      }
    } else {
      console.log('⚠️  无法获取模型列表，请手动输入\n');
      const modelAnswer = await inquirer.prompt([{
        type: 'input',
        name: 'model',
        message: '输入模型名称:',
        default: existingConfig.model.model || defaultModel
      }]);
      selectedModel = modelAnswer.model;
    }
  } else {
    const modelAnswer = await inquirer.prompt([{
      type: 'input',
      name: 'model',
      message: '输入模型名称:',
      default: existingConfig.model.model || defaultModel
    }]);
    selectedModel = modelAnswer.model;
  }

  const newConfig: Config = {
    model: {
      provider: providerAnswer.provider,
      apiKey: apiKeyAnswer.apiKey,
      model: selectedModel,
      baseURL: baseURLAnswer.baseURL || undefined
    }
  };

  await saveConfig(newConfig);
  console.log('\n✅ 配置已保存!\n');

  return newConfig;
}

export async function checkConfig(): Promise<Config> {
  const config = await loadConfig();

  if (!config.model.apiKey) {
    console.log('⚠️  首次使用，需要配置模型...\n');
    return await configWizard(config);
  }

  return config;
}
