import { useState } from 'react';
import {
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react';
import type { ToolCallMessage } from '../lib/websocket';

interface ToolCallProps {
  toolCall: ToolCallMessage;
}

export function ToolCall({ toolCall }: ToolCallProps) {
  console.log('[ToolCall] 渲染:', toolCall);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<'input' | 'output' | null>(null);
  const { data } = toolCall;

  const getStatusIcon = () => {
    switch (data.status) {
      case 'started':
        return <Clock className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Wrench className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    switch (data.status) {
      case 'started':
        return 'border-blue-200 bg-blue-50';
      case 'completed':
        return 'border-green-200 bg-green-50';
      case 'error':
        return 'border-red-200 bg-red-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const getStatusBadgeColor = () => {
    switch (data.status) {
      case 'started':
        return 'bg-blue-100 text-blue-700';
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'error':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const formatDuration = () => {
    if (data.durationMs === undefined) return null;
    if (data.durationMs < 1000) {
      return `${data.durationMs}ms`;
    }
    return `${(data.durationMs / 1000).toFixed(2)}s`;
  };

  const copyToClipboard = async (text: string, type: 'input' | 'output') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const formatJson = (obj: any) => {
    try {
      if (obj === undefined || obj === null) {
        return '';
      }
      // 如果已经是字符串，直接返回
      if (typeof obj === 'string') {
        return obj;
      }
      return JSON.stringify(obj, null, 2);
    } catch (err) {
      console.error('[ToolCall] JSON stringify failed:', err);
      return String(obj);
    }
  };

  return (
    <div className={`border rounded-xl p-4 mb-3 ${getStatusColor()}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white shadow-sm">
            <Wrench className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold" style={{ color: 'var(--color-text)' }}>
                {data.toolName}
              </h4>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeColor()}`}>
                {data.status === 'started' ? '运行中' : data.status === 'completed' ? '完成' : '错误'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span>{new Date(data.startTime).toLocaleTimeString()}</span>
              {formatDuration() && <span>· {formatDuration()}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-black/5 transition-colors"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
            )}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                输入参数
              </span>
              <button
                onClick={() => copyToClipboard(formatJson(data.input), 'input')}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-black/5 transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {copied === 'input' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'input' ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="bg-white rounded-lg p-3 text-xs overflow-x-auto border">
              <code>{formatJson(data.input)}</code>
            </pre>
          </div>

          {/* Output */}
          {(data.output !== undefined || data.error) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  {data.error ? '错误信息' : '输出结果'}
                </span>
                <button
                  onClick={() => {
                    const content = data.error || (
                      typeof data.output === 'object' && data.output !== null && 'result' in data.output
                        ? String(data.output.result)
                        : formatJson(data.output)
                    );
                    copyToClipboard(content, 'output');
                  }}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-black/5 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {copied === 'output' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'output' ? '已复制' : '复制'}
                </button>
              </div>
              <pre
                className={`rounded-lg p-3 text-xs overflow-x-auto border ${
                  data.error ? 'bg-red-50 border-red-200' : 'bg-white'
                }`}
              >
                <code className={data.error ? 'text-red-700' : ''}>
                  {data.error || (
                    typeof data.output === 'object' && data.output !== null && 'result' in data.output
                      ? String(data.output.result)
                      : formatJson(data.output)
                  )}
                </code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
