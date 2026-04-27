import type { ToolCall, ToolResult, ToolCallInfo } from '../../agents/types.js';

/**
 * 过滤工具调用信息，移除敏感内容（如文件内容）
 * 只返回可以展示给前端的信息
 */
export function filterToolCallForFrontend(toolCall: ToolCall): ToolCallInfo {
  const info: ToolCallInfo = { tool: toolCall.name };

  switch (toolCall.name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file':
    case 'list_dir':
      info.path = toolCall.args.path;
      break;
    case 'search_files':
      info.pattern = toolCall.args.pattern;
      if (toolCall.args.path) {
        info.path = toolCall.args.path;
      }
      break;
    case 'run_bash':
      // 仅记录命令前20字符，避免敏感信息泄露
      info.command = toolCall.args.command.slice(0, 20) + (toolCall.args.command.length > 20 ? '...' : '');
      if (toolCall.args.cwd) {
        info.path = toolCall.args.cwd;
      }
      break;
  }

  return info;
}

/**
 * 过滤工具执行结果，移除敏感内容
 */
export function filterToolResultForFrontend(toolResult: ToolResult): ToolCallInfo {
  const info: ToolCallInfo = { tool: toolResult.name };

  // 从 toolResult 中提取 path 等信息需要存储原始 args
  // 这里做简化处理
  return info;
}

/**
 * 判断一个工具结果是否包含错误
 */
export function isToolResultError(toolResult: ToolResult): boolean {
  return !toolResult.success || toolResult.result.startsWith('[ERROR]');
}
