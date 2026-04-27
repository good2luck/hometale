/**
 * Token 估算工具
 *
 * 提供 token 数量的粗略估算和格式化功能
 */

/**
 * 粗略估算消息列表的 token 数量
 *
 * 规则：~4 字符 = 1 token（中英文混合保守估算）
 * 注意：这是粗略估算，实际 token 数量可能有所不同
 *
 * @param messages 消息列表
 * @returns 估算的 token 数量
 */
export function estimateTokens(messages: any[]): number {
  if (!messages || messages.length === 0) {
    return 0;
  }

  // 将消息列表转换为 JSON 字符串
  const jsonString = JSON.stringify(messages);

  // 粗略估算：1 token ≈ 4 字符
  // 中文字符可能更紧凑，英文字符可能更占用空间
  // 这是一个保守的估算
  return Math.ceil(jsonString.length / 4);
}

/**
 * 估算单个消息的 token 数量
 *
 * @param message 单个消息
 * @returns 估算的 token 数量
 */
export function estimateMessageTokens(message: any): number {
  if (!message) {
    return 0;
  }

  const jsonString = JSON.stringify(message);
  return Math.ceil(jsonString.length / 4);
}

/**
 * 格式化 token 数为可读格式
 *
 * @param tokens token 数量
 * @returns 格式化后的字符串，如 "12.3K", "1.5M"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  } else if (tokens < 1000000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  } else {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
}

/**
 * 检查 token 数量是否接近阈值
 *
 * @param currentTokens 当前 token 数量
 * @param threshold 阈值
 * @param buffer 缓冲区比例（默认 0.8，即达到 80% 时返回 true）
 * @returns 是否接近阈值
 */
export function isNearThreshold(currentTokens: number, threshold: number, buffer: number = 0.8): boolean {
  return currentTokens >= threshold * buffer;
}