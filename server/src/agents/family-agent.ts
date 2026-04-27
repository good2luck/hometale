import { streamText, stepCountIs } from 'ai';
import { createModel } from './llm-client.js';
import { SystemPromptBuilder } from './system-prompt-builder.js';
import { getMemoryForAgent } from '../memory/memory-manager.js';
import { getRole } from '../roles/role-manager.js';
import type { ChatMessage, ToolCall, ToolResult } from './types.js';
import type { ModelConfig } from '../lib/config.js';
import { createToolSet, setCurrentRoleId, getAvailableToolNames } from '../agent-core/tools/index.js';
import { getSkillRegistry } from '../skills/index.js';
import { getDisclosureManager } from '../skills/discovery.js';
import { microCompact, CompactionManager } from '../agent-core/context-compact/index.js';
import { getContextMessages } from '../db/message-db.js';

// 初始化 Skill Registry（单例）
let registryInitialized = false;

async function initSkillRegistry() {
  if (registryInitialized) return;
  const registry = getSkillRegistry();
  await registry.initialize();
  registryInitialized = true;
  const skills = registry.getAllSkills();
  console.log('[FamilyAgent] Skill Registry initialized, loaded skills:', skills.map(s => s.id));
}

// Doom Loop 检测阈值
const DOOM_LOOP_THRESHOLD = 3;
const MAX_STEPS = 10;

// 自动压缩配置
const AUTO_COMPACT_CONFIG = {
  tokenThreshold: 50000,
  keepRecentMessages: 5,
  maxConsecutiveFailures: 3,
  maxSummaryLength: 2000
};

// Agent 事件类型
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call_started'; toolCallId: string; name: string; args: any }
  | { type: 'tool_call_completed'; toolCallId: string; name: string; result: any; success: boolean };

// ReAct 模式：使用 AI SDK streamText + maxSteps 运行 Family Agent
export async function* runFamilyAgentStream(
  config: ModelConfig,
  roleId: string,
  userMessage: string,
  _history: ChatMessage[] = [],  // 历史消息现在从 DB 加载
  sessionId?: string
): AsyncGenerator<AgentEvent, { toolCalls: ToolCall[]; toolResults: ToolResult[] }, unknown> {
  // 初始化 Skill Registry
  await initSkillRegistry();
  setCurrentRoleId(roleId);

  // 加载角色信息和家庭记忆
  const role = await getRole(roleId);
  const familyMemories = await getMemoryForAgent(roleId);

  // 从 DB 加载上下文（智能处理压缩标记）
  let messages: ChatMessage[] = [];
  if (sessionId) {
    const dbMessages = getContextMessages(sessionId, {
      baseLimit: 20,
      expandCompressed: false  // 默认不展开
    });
    messages = dbMessages.map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  // 添加用户消息
  messages.push({ role: 'user', content: userMessage });

  // Micro-compact（清理旧的 tool 结果）
  messages = microCompact(messages);

  // Auto-compact（检查 token 阈值）
  const compactionManager = new CompactionManager(config, AUTO_COMPACT_CONFIG);
  const compactResult = await compactionManager.compactIfNeeded(
    messages,
    sessionId!,
    roleId
  );

  if (compactResult.wasCompacted) {
    messages = compactResult.newMessages;
    console.log(`[FamilyAgent] Session ${sessionId} compressed, summary length: ${compactResult.summary?.length}`);
  } else if (compactResult.skippedByCircuitBreaker) {
    console.warn(`[FamilyAgent] Compaction skipped due to circuit breaker`);
  }

  // 使用 ProgressiveDisclosure 按用户消息筛选已披露的 skills
  let disclosedSkillIds: string[] | undefined;
  if (sessionId) {
    const disclosure = getDisclosureManager(sessionId);
    const disclosedSkills = disclosure.getDisclosedSkills(userMessage);
    disclosedSkillIds = disclosedSkills.map(s => s.id);
    console.log(`[FamilyAgent] ProgressiveDisclosure: ${disclosedSkillIds.length}/${getSkillRegistry().getAllSkills().length} skills disclosed`);
  }

  // 创建工具集（只注册已披露的 skills + load_skill 元工具）
  const tools = createToolSet(roleId, disclosedSkillIds);

  // 使用 SystemPromptBuilder 构建模块化系统提示词
  const workdir = process.cwd();

  const promptBuilder = new SystemPromptBuilder({
    workdir,
    disclosedSkillIds
  });

  const fullSystemPrompt = promptBuilder.build(role, familyMemories);

  // 创建 per-turn reminder（独立注入，不混入系统提示词）
  const reminder = promptBuilder.buildReminder(sessionId ? `Session ID: ${sessionId}` : undefined);
  if (reminder) {
    messages.unshift(reminder);
  }

  // 创建 model
  const model = createModel(config);

  // Doom Loop 检测：记录最近的工具调用
  const recentToolCalls: Array<{ name: string; args: string }> = [];

  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];

  try {
    const result = streamText({
      model,
      system: fullSystemPrompt,
      messages: messages as any,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    // 通过 fullStream 获取所有事件（文本、工具调用、工具结果等）
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          yield { type: 'text', content: part.text };
          break;
        }

        case 'tool-call': {
          const tc: any = part;
          const toolName = tc.toolName;
          const toolInput = tc.input || tc.args;

          // Doom Loop 检测
          const argsStr = JSON.stringify(toolInput);
          recentToolCalls.push({ name: toolName, args: argsStr });
          if (recentToolCalls.length > DOOM_LOOP_THRESHOLD) {
            recentToolCalls.shift();
          }

          const isDoomLoop = recentToolCalls.length === DOOM_LOOP_THRESHOLD &&
            recentToolCalls.every(t => t.name === toolName && t.args === argsStr);

          if (isDoomLoop) {
            console.warn('[FamilyAgent] 检测到 Doom Loop，中断连续相同的工具调用');
            yield {
              type: 'tool_call_started',
              toolCallId: tc.toolCallId,
              name: toolName,
              args: toolInput
            };
            const doomLoopMsg = '[DOOM LOOP] 检测到连续重复的工具调用，请换一种方式解决问题。';
            yield {
              type: 'tool_call_completed',
              toolCallId: tc.toolCallId,
              name: toolName,
              result: doomLoopMsg,
              success: false
            };
            allToolCalls.push({ id: tc.toolCallId, name: toolName, args: toolInput });
            allToolResults.push({ toolCallId: tc.toolCallId, name: toolName, result: doomLoopMsg, success: false });
            // 退出循环，不再继续
            return { toolCalls: allToolCalls, toolResults: allToolResults };
          }

          // 记录
          allToolCalls.push({ id: tc.toolCallId, name: toolName, args: toolInput });

          yield {
            type: 'tool_call_started',
            toolCallId: tc.toolCallId,
            name: toolName,
            args: toolInput
          };
          break;
        }

        case 'tool-result': {
          // AI SDK v4 fullStream 的 tool-result 类型依赖 ToolSet 泛型推断，
          // 动态创建的 ToolSet 可能导致 TS 无法识别此 case，用 as any 绕过
          const tr: any = part;
          const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
          const success = !tr.isError;

          allToolResults.push({
            toolCallId: tr.toolCallId,
            name: tr.toolName,
            result: resultStr,
            success
          });

          yield {
            type: 'tool_call_completed',
            toolCallId: tr.toolCallId,
            name: tr.toolName,
            result: resultStr,
            success
          };
          break;
        }

        case 'error': {
          console.error('[FamilyAgent] Stream error:', part.error);
          yield { type: 'text', content: '抱歉，我在处理时遇到了一些问题。请稍后重试。' };
          break;
        }
      }
    }

  } catch (err) {
    console.error('[FamilyAgent] streamText error:', err);
    yield { type: 'text', content: '抱歉，我在处理时遇到了一些问题。请稍后重试。' };
  }

  return {
    toolCalls: allToolCalls,
    toolResults: allToolResults
  };
}

// 兼容旧接口（简化版，非流式）
export async function runFamilyAgent(
  config: ModelConfig,
  roleId: string,
  userMessage: string,
  history: ChatMessage[] = [],
  sessionId?: string
): Promise<AgentRunResult> {
  const stream = runFamilyAgentStream(config, roleId, userMessage, history, sessionId);
  let fullResponse = '';
  let finalResult: { toolCalls: ToolCall[]; toolResults: ToolResult[] } | undefined;

  while (true) {
    const result = await stream.next();
    if (result.done) {
      finalResult = result.value;
      break;
    }
    if (result.value.type === 'text') {
      fullResponse += result.value.content;
    }
  }

  return {
    response: fullResponse,
    toolCalls: finalResult?.toolCalls || [],
    toolResults: finalResult?.toolResults || []
  };
}

// 保留旧接口名
export const getFinalResponseStream = runFamilyAgentStream;

// 带工具调用信息的运行结果
export interface AgentRunResult {
  response: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// 直接暴露工具，供外部调用
export { getAvailableToolNames as getAllTools, setCurrentRoleId };
