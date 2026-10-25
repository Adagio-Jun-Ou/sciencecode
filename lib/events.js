import { redactText } from './security.js';

export const MAX_PUBLIC_RESPONSE_BLOCK_BYTES = 8 * 1024;

export function parseOpenCodeEvents(text) {
  const events = [];
  const invalid = [];
  String(text ?? '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        invalid.push({ line: index + 1, issue: 'not_an_object' });
      } else {
        events.push(event);
      }
    } catch {
      invalid.push({ line: index + 1, issue: 'invalid_json' });
    }
  });
  return { events, invalid };
}

function publicLabel(value, fallback, limit = 240) {
  const clean = redactText(String(value ?? fallback)).replace(/\s+/g, ' ').trim();
  return (clean || fallback).slice(0, limit);
}

function boundedResponseText(value, maximumBytes = MAX_PUBLIC_RESPONSE_BLOCK_BYTES) {
  const source = redactText(String(value ?? ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  const bytes = Buffer.from(source, 'utf8');
  if (bytes.length <= maximumBytes) {
    return { content: source, content_bytes: bytes.length, truncated: false };
  }
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  const content = bytes.subarray(0, end).toString('utf8').trimEnd();
  return {
    content,
    content_bytes: Buffer.byteLength(content, 'utf8'),
    truncated: true
  };
}

/**
 * Convert a raw OpenCode JSON event into the small, safe event contract used
 * by the Lab. Tool inputs and outputs are deliberately excluded. This keeps
 * the work trace useful without turning the activity panel into a credential
 * or dataset exfiltration surface. Completed assistant text blocks are only
 * included when explicitly requested by the live, short-lived job transport;
 * recorded activity remains metadata-only.
 */
export function publicOpenCodeEvent(event, options = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const includeResponseContent = options?.includeResponseContent === true;
  const type = typeof event.type === 'string' ? event.type : 'unknown';
  const timestamp = typeof event.timestamp === 'number' || typeof event.timestamp === 'string'
    ? event.timestamp
    : null;
  if (type === 'tool_use') {
    return {
      type: 'tool',
      timestamp,
      tool: publicLabel(event.part?.tool, 'tool', 64),
      status: publicLabel(event.part?.state?.status, 'unknown', 32),
      title: publicLabel(event.part?.state?.title, 'Tool operation'),
      call_id: publicLabel(event.part?.callID, 'unknown', 96),
      started_at: event.part?.state?.time?.start ?? null,
      finished_at: event.part?.state?.time?.end ?? null
    };
  }
  if (type === 'step_start' || type === 'step_finish') {
    return {
      type: type === 'step_start' ? 'reasoning.started' : 'reasoning.finished',
      timestamp,
      status: type === 'step_start' ? 'running' : 'completed',
      title: type === 'step_start' ? 'Scientific reasoning pass started' : 'Scientific reasoning pass completed'
    };
  }
  if (type === 'text') {
    const result = {
      type: 'response.updated',
      timestamp,
      status: 'running',
      title: 'Synthesizing the research outcome'
    };
    if (!includeResponseContent) return result;
    const bounded = boundedResponseText(
      event.part?.text,
      Number.isSafeInteger(options.maxResponseBytes) && options.maxResponseBytes > 0
        ? Math.min(options.maxResponseBytes, MAX_PUBLIC_RESPONSE_BLOCK_BYTES)
        : MAX_PUBLIC_RESPONSE_BLOCK_BYTES
    );
    if (!bounded.content) return result;
    const partId = publicLabel(event.part?.id, '', 96);
    const messageId = publicLabel(event.part?.messageID ?? event.messageID, '', 96);
    return {
      ...result,
      type: 'response.block',
      title: 'OpenCode completed a response block',
      ...bounded,
      ...(partId ? { part_id: partId } : {}),
      ...(messageId ? { message_id: messageId } : {})
    };
  }
  if (type === 'error') {
    const message = typeof event.error === 'string'
      ? event.error
      : event.error?.data?.message ?? event.error?.message;
    return {
      type: 'engine.error',
      timestamp,
      status: 'failed',
      title: publicLabel(message, 'OpenCode engine error')
    };
  }
  return {
    type: 'engine.' + publicLabel(type, 'event', 64),
    timestamp,
    status: 'recorded',
    title: 'OpenCode event: ' + publicLabel(type, 'unknown', 64)
  };
}

export function summarizeOpenCodeEvents(text) {
  const { events, invalid } = parseOpenCodeEvents(text);
  const types = {};
  const sessions = new Set();
  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : 'unknown';
    types[type] = (types[type] ?? 0) + 1;
    if (typeof event.sessionID === 'string') sessions.add(event.sessionID);
  }
  return {
    count: events.length,
    invalid_lines: invalid,
    types: Object.fromEntries(Object.entries(types).sort(([left], [right]) => left.localeCompare(right))),
    session_ids: [...sessions].sort()
  };
}

export function renderOpenCodeEvents(text) {
  const { events } = parseOpenCodeEvents(text);
  const blocks = [];
  for (const event of events) {
    if (event.type === 'text' && typeof event.part?.text === 'string' && event.part.text.trim()) {
      blocks.push(event.part.text.trim());
    }
    if (event.type === 'error' && !event.part && event.error) {
      const message = typeof event.error === 'string'
        ? event.error
        : event.error?.data?.message ?? event.error?.message;
      if (message) blocks.push(`OpenCode error: ${message}`);
    }
  }
  return blocks.join('\n\n');
}
