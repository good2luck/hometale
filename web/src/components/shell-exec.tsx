import { useState } from 'react';
import {
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Folder
} from 'lucide-react';
import type { ShellExecMessage } from '../lib/websocket';

interface ShellExecProps {
  shellExec: ShellExecMessage;
}

export function ShellExec({ shellExec }: ShellExecProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<'command' | 'stdout' | 'stderr' | null>(null);
  const { data } = shellExec;

  const getStatusIcon = () => {
    switch (data.status) {
      case 'started':
        return <Clock className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'completed':
        return data.exitCode === 0
          ? <CheckCircle2 className="w-4 h-4 text-green-500" />
          : <XCircle className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Terminal className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    switch (data.status) {
      case 'started':
        return 'border-blue-200 bg-blue-50';
      case 'completed':
        return data.exitCode === 0
          ? 'border-green-200 bg-green-50'
          : 'border-yellow-200 bg-yellow-50';
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
        return data.exitCode === 0
          ? 'bg-green-100 text-green-700'
          : 'bg-yellow-100 text-yellow-700';
      case 'error':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusText = () => {
    if (data.status === 'completed' && data.exitCode !== undefined) {
      return `退出码: ${data.exitCode}`;
    }
    return data.status === 'started' ? '运行中' : data.status === 'completed' ? '完成' : '错误';
  };

  const formatDuration = () => {
    if (data.durationMs === undefined) return null;
    if (data.durationMs < 1000) {
      return `${data.durationMs}ms`;
    }
    return `${(data.durationMs / 1000).toFixed(2)}s`;
  };

  const fullCommand = [data.command, ...(data.args || [])].join(' ');

  const copyToClipboard = async (text: string, type: 'command' | 'stdout' | 'stderr') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  return (
    <div className={`border rounded-xl p-4 mb-3 ${getStatusColor()}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-900 shadow-sm">
            <Terminal className="w-5 h-5 text-green-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                {data.command}
              </h4>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${getStatusBadgeColor()}`}>
                {getStatusText()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span>{new Date(data.startTime).toLocaleTimeString()}</span>
              {formatDuration() && <span>· {formatDuration()}</span>}
              {data.cwd && (
                <span className="flex items-center gap-1">
                  <Folder className="w-3 h-3" />
                  {data.cwd}
                </span>
              )}
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
          {/* Command */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                完整命令
              </span>
              <button
                onClick={() => copyToClipboard(fullCommand, 'command')}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-black/5 transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {copied === 'command' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'command' ? '已复制' : '复制'}
              </button>
            </div>
            <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto">
              <code className="text-sm text-green-400 font-mono">
                $ {fullCommand}
              </code>
            </div>
          </div>

          {/* Stdout */}
          {data.stdout && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  标准输出 (stdout)
                </span>
                <button
                  onClick={() => copyToClipboard(data.stdout!, 'stdout')}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-black/5 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {copied === 'stdout' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'stdout' ? '已复制' : '复制'}
                </button>
              </div>
              <div className="bg-gray-900 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto">
                <pre className="text-sm text-gray-100 font-mono whitespace-pre-wrap">
                  {data.stdout}
                </pre>
              </div>
            </div>
          )}

          {/* Stderr */}
          {data.stderr && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-700">
                  错误输出 (stderr)
                </span>
                <button
                  onClick={() => copyToClipboard(data.stderr!, 'stderr')}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-black/5 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {copied === 'stderr' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied === 'stderr' ? '已复制' : '复制'}
                </button>
              </div>
              <div className="bg-red-950 rounded-lg p-3 overflow-x-auto max-h-60 overflow-y-auto">
                <pre className="text-sm text-red-200 font-mono whitespace-pre-wrap">
                  {data.stderr}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
