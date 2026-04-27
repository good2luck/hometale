export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// 工具调用相关类型
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: string;
  success: boolean;
}

// 前端展示用的工具调用信息（不包含敏感内容）
export interface ToolCallInfo {
  tool: string;
  path?: string;
  pattern?: string;
  command?: string;
  matches?: number;
  entries?: string[];
}
