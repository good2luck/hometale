import { useState } from 'react';
import {
  Activity,
  Wrench,
  Terminal,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { ToolCall } from './tool-call';
import { ShellExec } from './shell-exec';
import type { ToolCallMessage, ShellExecMessage } from '../lib/websocket';

interface ActivityLogProps {
  toolCalls: ToolCallMessage[];
  shellExecs: ShellExecMessage[];
  onClear?: () => void;
}

type FilterType = 'all' | 'tool' | 'shell';

export function ActivityLog({ toolCalls, shellExecs, onClear }: ActivityLogProps) {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');

  console.log('[ActivityLog] 渲染, props:', { toolCalls, shellExecs });

  // 合并并排序所有活动（按时间倒序）
  const allActivities = [
    ...toolCalls.map((tc) => ({ type: 'tool' as const, data: tc, time: new Date(tc.timestamp).getTime() })),
    ...shellExecs.map((se) => ({ type: 'shell' as const, data: se, time: new Date(se.timestamp).getTime() }))
  ].sort((a, b) => b.time - a.time);

  const filteredActivities = allActivities.filter((activity) => {
    if (filter === 'all') return true;
    return activity.type === filter;
  });

  const runningCount = allActivities.filter(
    (a) => a.data.data.status === 'started'
  ).length;

  const completedCount = allActivities.filter(
    (a) => a.data.data.status === 'completed'
  ).length;

  const errorCount = allActivities.filter(
    (a) => a.data.data.status === 'error'
  ).length;

  return (
    <div className="border-t" style={{ borderColor: '#F0F0F0' }}>
      {/* Header / Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-black/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ backgroundColor: 'var(--color-primary)' }}>
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                活动日志
              </span>
              {allActivities.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100" style={{ color: 'var(--color-text-muted)' }}>
                  {allActivities.length}
                </span>
              )}
            </div>
            {allActivities.length > 0 && (
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {runningCount > 0 && <span className="text-blue-600">{runningCount} 运行中</span>}
                {completedCount > 0 && <span className="text-green-600">{completedCount} 完成</span>}
                {errorCount > 0 && <span className="text-red-600">{errorCount} 错误</span>}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronUp className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-muted)' }} />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4">
          {/* Toolbar */}
          {allActivities.length > 0 && (
            <div className="flex items-center justify-between mb-3">
              {/* Filter */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                <FilterButton
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                  icon={<Activity className="w-3 h-3" />}
                  label="全部"
                />
                <FilterButton
                  active={filter === 'tool'}
                  onClick={() => setFilter('tool')}
                  icon={<Wrench className="w-3 h-3" />}
                  label="工具"
                />
                <FilterButton
                  active={filter === 'shell'}
                  onClick={() => setFilter('shell')}
                  icon={<Terminal className="w-3 h-3" />}
                  label="Shell"
                />
              </div>

              {/* Clear button */}
              {onClear && (
                <button
                  onClick={onClear}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg hover:bg-red-50 text-red-600 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  清空
                </button>
              )}
            </div>
          )}

          {/* List */}
          {filteredActivities.length === 0 ? (
            <div className="text-center py-8">
              <Activity className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {allActivities.length === 0 ? '暂无活动记录' : '没有匹配的活动记录'}
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {filteredActivities.map((activity) => (
                <div key={activity.data.id}>
                  {activity.type === 'tool' ? (
                    <ToolCall toolCall={activity.data} />
                  ) : (
                    <ShellExec shellExec={activity.data} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function FilterButton({ active, onClick, icon, label }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-all ${
        active
          ? 'bg-white shadow-sm font-medium'
          : 'hover:bg-white/50'
      }`}
      style={{
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)'
      }}
    >
      {icon}
      {label}
    </button>
  );
}
