import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type { ModelConfig } from '../lib/config.js';
import type { ChatMessage, LLMResponse } from './types.js';

// ========== 创建 AI SDK Model 实例 ==========

export function createModel(config: ModelConfig) {
  if (config.provider === 'anthropic') {
    const provider = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    } as any);
    return provider.languageModel(config.model);
  }

  // OpenAI 或自定义/国产模型
  const provider = createOpenAICompatible({
    name: config.provider,
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  } as any);
  return provider.chatModel(config.model);
}

// ========== 工具名称修复工具 ==========

/**
 * 尝试修复工具名称（大小写、拼写等）
 */
export function repairToolName(toolName: string, availableTools: string[]): string | null {
  const lowerToolName = toolName.toLowerCase();
  const lowerAvailableTools = new Map(availableTools.map(t => [t.toLowerCase(), t]));

  if (lowerAvailableTools.has(lowerToolName)) {
    const matched = lowerAvailableTools.get(lowerToolName)!;
    if (matched !== toolName) {
      return matched;
    }
    return null;
  }

  for (const [lower, original] of lowerAvailableTools) {
    if (lower.startsWith(lowerToolName) || lowerToolName.startsWith(lower)) {
      return original;
    }
  }

  for (const [lower, original] of lowerAvailableTools) {
    if (lower.includes(lowerToolName) || lowerToolName.includes(lower)) {
      return original;
    }
  }

  return null;
}

// ========== 简单 LLM 调用（用于 memory-summarizer、skills/loader 等） ==========

export async function callLLM(
  config: ModelConfig,
  messages: ChatMessage[]
): Promise<LLMResponse> {
  const model = createModel(config);

  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  const result = await generateText({
    model,
    system: systemMessage,
    messages: nonSystemMessages as any,
  });

  return {
    content: result.text,
    usage: result.usage ? {
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0)
    } : undefined
  };
}
