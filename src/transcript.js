// Keep a readable local transcript without copying provider metadata or image payloads.
export function transcriptMessage(message) {
  if (!['user', 'assistant', 'toolResult'].includes(message.role)) return null;
  const blocks = typeof message.content === 'string'
    ? [{ type: 'text', text: message.content }]
    : (message.content ?? []).map(block => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking };
      if (block.type === 'toolCall') return { type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments };
      if (block.type === 'image') return { type: 'image', mimeType: block.mimeType, dataOmitted: true };
      return { type: block.type ?? 'unknown', dataOmitted: true };
    });
  return {
    role: message.role,
    content: blocks,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.stopReason ? { stopReason: message.stopReason } : {}),
    ...(message.isError ? { isError: true } : {}),
  };
}
