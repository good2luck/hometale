/**
 * Auto-compact: 自动压缩管理器
 *
 * 当 token 数量超过阈值时，自动生成对话总结并压缩
 */

import { estimateTokens } from './token-estimator.js';
import { insertCompactionMarker } from '../../db/message-db.js';
import { callLLM } from '../../agents/llm-client.js';
import type { ModelConfig } from '../../lib/config.js';

/**
 * Auto-compact 配置
 */
export interface AutoCompactConfig {
  /** Token 阈值，默认 50000 */
  tokenThreshold?: number;
  /** 压缩后保留的消息数，默认 5 */
  keepRecentMessages?: number;
  /** 连续失败熔断阈值，默认 3 */
  maxConsecutiveFailures?: number;
  /** 总结最大长度（token），默认 2000 */
  maxSummaryLength?: number;
}

/**
 * 压缩结果
 */
export interface CompactionResult {
  /** 是否执行了压缩 */
  wasCompacted: boolean;
  /** 新的消息列表 */
  newMessages: any[];
  /** 总结内容 */
  summary?: string;
  /** 是否因熔断器而跳过压缩 */
  skippedByCircuitBreaker?: boolean;
}

/**
 * 压缩管理器
 *
 * 负责检测何时需要压缩，并执行压缩操作
 */
export class CompactionManager {
  private config: Required<AutoCompactConfig>;
  private failureCount: number;

  constructor(
    private modelConfig: ModelConfig,
    config: AutoCompactConfig = {}
  ) {
    this.config = {
      tokenThreshold: config.tokenThreshold ?? 50000,
      keepRecentMessages: config.keepRecentMessages ?? 5,
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
      maxSummaryLength: config.maxSummaryLength ?? 2000
    };
    this.failureCount = 0;
  }

  /**
   * 检查并执行压缩
   *
   * @param messages 消息列表
   * @param sessionId 会话 ID
   * @param roleId 角色 ID
   * @returns 压缩结果
   */
  async compactIfNeeded(
    messages: any[],
    sessionId: string,
    roleId: string
  ): Promise<CompactionResult> {
    // 检查熔断器状态
    if (this.isCircuitBreakerOpen()) {
      return {
        wasCompacted: false,
        newMessages: messages,
        skippedByCircuitBreaker: true
      };
    }

    // 检查 token 数量
    const tokenCount = estimateTokens(messages);
    if (tokenCount < this.config.tokenThreshold) {
      return {
        wasCompacted: false,
        newMessages: messages
      };
    }

    console.log(`[CompactionManager] Token count ${tokenCount} exceeds threshold ${this.config.tokenThreshold}, starting compaction`);

    try {
      // 生成总结
      const summary = await this.generateSummary(messages);

      // 插入压缩标记到 DB
      insertCompactionMarker(sessionId, roleId, summary, messages.length);

      // 构建新的消息列表
      const recentCount = Math.min(this.config.keepRecentMessages, messages.length);
      const recentMessages = messages.slice(-recentCount);

      const newMessages = [
        ...recentMessages,
        { role: 'assistant', content: `[COMPRESSED] ${summary}` }
      ];

      // 重置失败计数
      this.failureCount = 0;

      console.log(`[CompactionManager] Compaction completed, summary length: ${summary.length}`);

      return {
        wasCompacted: true,
        newMessages,
        summary
      };

    } catch (error) {
      this.failureCount++;
      console.error(`[CompactionManager] Compaction failed (${this.failureCount}/${this.config.maxConsecutiveFailures}):`, error);

      // 重试最后一次
      if (this.failureCount >= this.config.maxConsecutiveFailures) {
        console.warn('[CompactionManager] Circuit breaker opened, stopping compaction attempts');
      }

      return {
        wasCompacted: false,
        newMessages: messages
      };
    }
  }

  /**
   * 生成对话总结
   *
   * @param messages 消息列表
   * @returns 总结文本
   */
  private async generateSummary(messages: any[]): Promise<string> {
    const conversationText = JSON.stringify(messages, null, 2);

    // 限制输入长度（避免总结 API 本身超限）
    const maxInputLength = 80000; // 约 20000 tokens
    const truncatedText = conversationText.length > maxInputLength
      ? conversationText.slice(-maxInputLength)
      : conversationText;

    const prompt = `总结这段对话，保留以下关键信息：

1. **已完成的工作**：哪些任务已经完成？
2. **当前状态**：现在在做什么？有哪些活跃的文件或工具？
3. **重要决策**：做出了哪些关键决定？
4. **待办事项**：还有哪些任务需要完成？

对话内容（最近部分）：
${truncatedText}

请用简洁、有条理的方式总结，确保重要信息不丢失。`;

    const systemPrompt = '你是对话总结助手。请准确提取对话中的关键信息，用简洁的语言进行总结。';

    const response = await callLLM(this.modelConfig, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]);

    return response.content.trim();
  }

  /**
   * 检查熔断器是否打开
   *
   * @returns 熔断器是否打开
   */
  isCircuitBreakerOpen(): boolean {
    return this.failureCount >= this.config.maxConsecutiveFailures;
  }

  /**
   * 获取当前失败计数
   *
   * @returns 失败次数
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * 重置熔断器
   */
  resetCircuitBreaker(): void {
    this.failureCount = 0;
    console.log('[CompactionManager] Circuit breaker reset');
  }
}