let n = 0;
const base = (extra) => ({
  uuid: `u${++n}`, sessionId: 's1', isSidechain: false,
  timestamp: '2026-07-03T06:50:48.682Z', cwd: 'D:\\develop\\demo-api',
  gitBranch: 'develop', ...extra,
});

export const userLine = (content, extra = {}) =>
  JSON.stringify(base({ type: 'user', message: { role: 'user', content }, ...extra }));

export const assistantToolUse = (name, input, extra = {}) =>
  JSON.stringify(base({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name, input }] },
    ...extra,
  }));

export const assistantText = (text, extra = {}) =>
  JSON.stringify(base({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  }));

export const queueOp = () => JSON.stringify({ type: 'queue-operation', operation: 'enqueue' });
