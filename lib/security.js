const SECRET_PATTERNS = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { name: 'provider-token', pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/i },
  { name: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}={0,2}\b/i },
  {
    name: 'credential-assignment',
    pattern: /["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret)["']?\s*[:=]\s*(?:["'][^"']+["']|[^\s,;}]+)/i
  },
  { name: 'url-credentials', pattern: /:\/\/[^\s/:@]+:[^\s/@]+@/ }
];

export function scanSecrets(text) {
  const value = String(text ?? '');
  return SECRET_PATTERNS
    .filter(({ pattern }) => pattern.test(value))
    .map(({ name }) => ({ rule: name }));
}

export function redactText(text) {
  return String(text ?? '')
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      '[REDACTED PRIVATE KEY]'
    )
    // A key split across streamed output blocks, or truncated before its END
    // marker, reaches this function without one. scanSecrets flags the BEGIN
    // marker alone, so redaction has to cover the same case or the material is
    // written out in full.
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/gi,
      '[REDACTED PRIVATE KEY]'
    )
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED TOKEN]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi, '[REDACTED GITHUB TOKEN]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gi, '[REDACTED SLACK TOKEN]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[REDACTED GOOGLE API KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]{16,}={0,2}\b/gi, '$1 [REDACTED]')
    .replace(
      // The value runs to the next *unescaped* quote: a credential containing
      // an escaped quote, as any JSON-encoded value may, would otherwise end
      // the match early and emit its tail verbatim.
      /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret)["']?\s*[:=]\s*)(["'])((?:\\.|(?!\2)[^\\])*)\2/gi,
      '$1$2[REDACTED]$2'
    )
    .replace(
      /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret)["']?\s*[:=]\s*)(?!["'])([^\s,;}"']+)/gi,
      '$1[REDACTED]'
    )
    .replace(/:\/\/[^\s/:@]+:[^\s/@]+@/g, '://[REDACTED]@');
}
