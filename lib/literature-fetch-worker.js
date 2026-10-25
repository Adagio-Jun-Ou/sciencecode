// Performs the single explicit HTTPS GET for `sciencecode literature fetch`
// in a subprocess so the synchronous CLI can freeze the exact response bytes.
const url = process.argv[2];
const timeoutMs = Number(process.argv[3]) || 30_000;
const version = process.argv[4] || 'unknown';

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
try {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: controller.signal,
    headers: {
      accept: 'application/json',
      'user-agent': 'sciencecode/' + version +
        ' (reproducibility-first research workbench; mailto:unconfigured@sciencecode.invalid)'
    }
  });
  const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('response declares ' + declaredLength +
      ' bytes, above the ' + MAX_RESPONSE_BYTES + '-byte limit');
  }
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('response exceeded the ' + MAX_RESPONSE_BYTES +
          '-byte limit while streaming');
      }
      chunks.push(Buffer.from(value));
    }
    bytes = Buffer.concat(chunks);
  } else {
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) {
      throw new Error('response exceeded the ' + MAX_RESPONSE_BYTES + '-byte limit');
    }
  }
  process.stdout.write(JSON.stringify({
    ok: response.ok,
    http_status: response.status,
    body_base64: bytes.toString('base64')
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    http_status: null,
    error: String(error?.message ?? error)
  }));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
}
