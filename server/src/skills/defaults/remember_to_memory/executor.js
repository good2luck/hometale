import { updateLongTermMemory } from '../../memory/memory-manager.js';

export async function execute(params, context) {
  const content = params.content;

  if (!content || !content.trim()) {
    throw new Error('请提供要记录的内容');
  }

  const now = new Date();
  const timestamp = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit'
  });

  const memoryEntry = `- ${timestamp}: ${content.trim()}`;

  await updateLongTermMemory(context.roleId, memoryEntry);

  return `已记录到长期记忆：${content.trim()}`;
}
