import readline from 'node:readline';
import chalk from 'chalk';
import {
  loadConfig,
  ensureHometaleStructure,
  listRoles,
  getRole,
  createRole,
  guessRoleInfo,
  runFamilyAgent,
  appendConversation,
  type Role
} from '@hometale/server';
import crypto from 'node:crypto';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let currentRole: Role | null = null;
let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function selectOrCreateRole(): Promise<Role> {
  const roles = await listRoles();

  if (roles.length === 0) {
    console.log(chalk.yellow('\n还没有角色，请告诉我你是谁...\n'));
    return await promptForNewRole();
  }

  console.log(chalk.cyan('\n已有角色:'));
  roles.forEach((role: Role, idx: number) => {
    console.log(`  ${idx + 1}. ${role.avatar} ${role.name}`);
  });
  console.log(`  ${roles.length + 1}. 创建新角色\n`);

  const answer = await question(chalk.blue('请选择 (1-' + (roles.length + 1) + '): '));
  const choice = parseInt(answer.trim());

  if (choice >= 1 && choice <= roles.length) {
    return roles[choice - 1];
  } else if (choice === roles.length + 1) {
    return await promptForNewRole();
  } else {
    console.log(chalk.red('无效选择'));
    return await selectOrCreateRole();
  }
}

async function promptForNewRole(): Promise<Role> {
  const nameAnswer = await question(chalk.blue('你的角色叫什么? (如: 爸爸, 妈妈, 小明): '));
  const name = nameAnswer.trim();

  const guessed = guessRoleInfo(name);
  let id: string, avatar: string;

  if (guessed) {
    id = guessed.id;
    avatar = guessed.avatar;
  } else {
    id = name.toLowerCase().replace(/\s+/g, '-');
    const avatarAnswer = await question(chalk.blue('选择一个头像 (emoji): '));
    avatar = avatarAnswer.trim() || '😊';
  }

  const robotIdentityAnswer = await question(
    chalk.blue('希望我如何称呼你? (默认: 你是' + name + '的贴心助手): ')
  );
  const robotIdentity = robotIdentityAnswer.trim() || `你是${name}的贴心助手，帮助处理日常事务，关心家人。`;

  const role: Role = {
    id,
    name,
    avatar,
    robotIdentity,
    createdAt: new Date().toISOString().split('T')[0]
  };

  await createRole(role);
  console.log(chalk.green(`\n✅ 角色 ${name} 已创建!\n`));

  return role;
}

function printMessage(role: 'user' | 'assistant', content: string) {
  if (role === 'user') {
    console.log(chalk.blue('\n你: ') + content);
  } else {
    console.log(chalk.green('\n🤖 智能体: ') + content);
  }
}

async function handleUserMessage(input: string) {
  if (!currentRole) return;

  const config = await loadConfig();

  if (input.toLowerCase().includes('我是') || input.toLowerCase().includes('我叫')) {
    const guessed = guessRoleInfo(input);
    if (guessed) {
      let role = await getRole(guessed.id);
      if (!role) {
        role = {
          id: guessed.id,
          name: guessed.name,
          avatar: guessed.avatar,
          robotIdentity: `你是${guessed.name}的贴心助手，帮助处理日常事务，关心家人。`,
          createdAt: new Date().toISOString().split('T')[0]
        };
        await createRole(role);
      }
      currentRole = role;
      conversationHistory = [];
      console.log(chalk.green(`\n✅ 切换到角色: ${role.avatar} ${role.name}\n`));
      return;
    }
  }

  printMessage('user', input);
  conversationHistory.push({ role: 'user', content: input });

  process.stdout.write(chalk.gray('\n思考中...'));

  try {
    const result = await runFamilyAgent(
      config.model,
      currentRole.id,
      input,
      conversationHistory
    );
    const response = result.response;

    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);

    printMessage('assistant', response);
    conversationHistory.push({ role: 'assistant', content: response });

    const conversationId = crypto.randomBytes(8).toString('hex');
    const timestamp = new Date().toISOString();
    await appendConversation(currentRole.id, conversationId, [
      { role: 'user', content: input, timestamp },
      { role: 'assistant', content: response, timestamp }
    ]);
  } catch (error: any) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.error(chalk.red('\n❌ 错误: ' + error.message));
  }
}

export async function startChat() {
  await ensureHometaleStructure();

  console.log(chalk.cyan('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.cyan('║     HomeTale - 家的故事 (CLI)         ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════╝\n'));

  currentRole = await selectOrCreateRole();

  console.log(chalk.cyan(`\n╭─────────────────────────────────────────╮`));
  console.log(chalk.cyan(`│  当前角色: ${currentRole.avatar} ${currentRole.name}`));
  console.log(chalk.cyan(`│  输入 /quit 或 /exit 退出`));
  console.log(chalk.cyan(`│  输入 "我是爸爸" 切换角色`));
  console.log(chalk.cyan(`╰─────────────────────────────────────────╯\n`));

  while (true) {
    const input = await question(chalk.blue('\n> '));
    const trimmed = input.trim();

    if (!trimmed) continue;

    if (trimmed.toLowerCase() === '/quit' || trimmed.toLowerCase() === '/exit') {
      console.log(chalk.yellow('\n👋 再见!\n'));
      process.exit(0);
    }

    await handleUserMessage(trimmed);
  }
}
