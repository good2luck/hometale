/**
 * Micro-compact: 微型压缩
 *
 * 清理消息中旧的 tool_result 内容，保留最近的结果
 */

/**
 * Micro-compact 配置
 */
export interface MicroCompactConfig {
  /** 保留最近的 tool_result 数量，默认 3 */
  keepRecentToolResults?: number;
  /** 不压缩的工具名称列表，默认 ['read_file'] */
  preserveToolNames?: string[];
  /** 小于此长度不压缩（字符数），默认 100 */
  minContentLength?: number;
}

/**
 * 工具调用信息
 */
interface ToolCallInfo {
  msgIndex: number;
  toolName: string;
  content: any;
}

/**
 * Micro-compact：清理旧的 tool_result 内容
 *
 * 策略：
 * 1. 遍历消息中的 tool_result
 * 2. 除最后 N 个外，将内容替换为 "[Previous: used {tool_name}]"
 * 3. 保留 read_file 等参考性工具的完整输出
 * 4. 跳过过短的内容
 *
 * @param messages 消息列表
 * @param config 配置选项
 * @returns 压缩后的消息列表
 */
export function microCompact(
  messages: any[],
  config: MicroCompactConfig = {}
): any[] {
  const {
    keepRecentToolResults = 3,
    preserveToolNames = ['read_file'],
    minContentLength = 100
  } = config;

  // 深拷贝消息列表，避免修改原始数据
  const result = JSON.parse(JSON.stringify(messages));

  // 收集所有的 tool_result
  const toolResults: ToolCallInfo[] = [];

  for (let i = 0; i < result.length; i++) {
    const msg = result[i];

    // 检查是否是带有 content 数组的消息（AI SDK 格式）
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const part = msg.content[j];
        if (part.type === 'tool_result') {
          toolResults.push({
            msgIndex: i,
            toolName: part.toolName || 'unknown',
            content: part.content
          });
        }
      }
    }
  }

  // 如果没有足够多的 tool_result，不需要压缩
  if (toolResults.length <= keepRecentToolResults) {
    return messages;
  }

  // 获取工具名称映射（从 assistant 消息中提取）
  // const toolNameMap = extractToolNameMap(result);  // 暂时不需要使用

  // 清理旧的 tool_result（保留最后 N 个）
  const toCompact = toolResults.slice(0, -keepRecentToolResults);

  for (const item of toCompact) {
    const msg = result[item.msgIndex];
    if (!msg.content || !Array.isArray(msg.content)) {
      continue;
    }

    for (const part of msg.content) {
      if (part.type === 'tool_result') {
        const toolName = part.toolName || 'unknown';

        // 跳过需要保留的工具
        if (preserveToolNames.includes(toolName)) {
          continue;
        }

        // 跳过过短的内容
        const contentStr = typeof part.content === 'string'
          ? part.content
          : JSON.stringify(part.content);

        if (contentStr.length <= minContentLength) {
          continue;
        }

        // 替换为占位符
        part.content = `[Previous: used ${toolName}]`;
      }
    }
  }

  return result;
}