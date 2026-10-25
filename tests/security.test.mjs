import test from 'node:test';
import assert from 'node:assert/strict';
import { redactText, scanSecrets } from '../lib/security.js';

const PEM_BEGIN = '-----BEGIN RSA PRIVATE KEY-----';
const PEM_END = '-----END RSA PRIVATE KEY-----';

test('quoted credential values are redacted through escaped quotes', () => {
  // A JSON-encoded credential contains an escaped quote; a value scan that
  // stops at the first raw quote emits the rest of the secret verbatim.
  const payload = JSON.stringify({ db: { user: 'sci', password: 'p@ss"w0rd-PRODUCTION-9f3a1c' } });
  const redacted = redactText(payload);
  assert.doesNotMatch(redacted, /PRODUCTION-9f3a1c/);
  assert.match(redacted, /"password":"\[REDACTED\]"/);
  assert.match(redacted, /"user":"sci"/);

  const trailingBackslash = JSON.stringify({ token: 'abc' + String.fromCharCode(92) });
  assert.doesNotMatch(redactText(trailingBackslash), /abc/);
});

test('a private key without its END marker is still redacted', () => {
  // Streamed output is redacted per block, so a key can reach redaction split
  // in half or truncated. scanSecrets flags the BEGIN marker alone.
  const truncated = PEM_BEGIN + '\nSECRETMATERIALAAAA';
  assert.deepEqual(scanSecrets(truncated), [{ rule: 'private-key' }]);
  assert.equal(redactText(truncated), '[REDACTED PRIVATE KEY]');

  const split = redactText(PEM_BEGIN + '\nSECRETMATER') + redactText('IALAAAA\n' + PEM_END);
  assert.doesNotMatch(split, /SECRETMATER/);
});

test('a complete private key is redacted without swallowing following text', () => {
  const value = PEM_BEGIN + '\nabc\n' + PEM_END + '\nrun finished';
  assert.equal(redactText(value), '[REDACTED PRIVATE KEY]\nrun finished');
});

test('token, bearer, and url credential shapes are redacted', () => {
  const samples = [
    ['sk-abcdefghijklmnopqrstuvwx', /\[REDACTED TOKEN\]/],
    ['ghp_abcdefghijklmnopqrstuvwxyz012345', /\[REDACTED GITHUB TOKEN\]/],
    ['xoxb-abcdefghijklmnopqrst', /\[REDACTED SLACK TOKEN\]/],
    ['AIzaabcdefghijklmnopqrstuvwxyz', /\[REDACTED GOOGLE API KEY\]/],
    ['AKIAABCDEFGHIJKLMNOP', /\[REDACTED AWS KEY\]/],
    ['Authorization: Bearer abcdefghijklmnopqrst', /Bearer \[REDACTED\]/],
    ['https://user:secretpw@example.com', /:\/\/\[REDACTED\]@/]
  ];
  for (const [raw, expected] of samples) {
    const redacted = redactText(raw);
    assert.match(redacted, expected, raw);
    assert.ok(scanSecrets(raw).length > 0, raw + ' should be flagged');
  }
});

test('ordinary scientific text is neither flagged nor rewritten', () => {
  const benign = [
    'Observed IC50 of 12.4 nM against the primary target.',
    'The token of a sequence alignment is not a credential.',
    'https://example.com/paper.pdf'
  ];
  for (const value of benign) {
    assert.equal(redactText(value), value, value);
  }
  assert.deepEqual(scanSecrets('Observed IC50 of 12.4 nM.'), []);
});

test('redaction accepts non-string input without throwing', () => {
  assert.equal(redactText(null), '');
  assert.equal(redactText(undefined), '');
  assert.equal(redactText(42), '42');
  assert.deepEqual(scanSecrets(null), []);
});
