import fs from 'node:fs';
import { createKernelManager } from './kernels.js';
import { resolveInsideRoot } from './storage.js';

function decodeRequest(value) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value ?? ''), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request must be an object');
    return parsed;
  } catch (error) {
    throw Object.assign(new Error('Invalid kernel CLI request: ' + error.message), { code: 'INVALID_ARGUMENT' });
  }
}

let manager;
try {
  const request = decodeRequest(process.argv[2]);
  const source = resolveInsideRoot(request.cwd, request.source);
  const code = fs.readFileSync(source, 'utf8');
  manager = createKernelManager({ cwd: request.cwd, env: process.env });
  const result = await manager.execute({
    language: request.language,
    code,
    timeoutMs: request.timeout_ms,
    chatId: request.chat_id,
    mode: request.mode
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.cell.manifest.status === 'completed' ? 0 : 1;
} catch (error) {
  process.stderr.write('ScienceCode kernel: ' + error.message + '\n');
  process.exitCode = error.code === 'SECRET_DETECTED' ? 3 : 2;
} finally {
  manager?.shutdownAll('cli_complete');
}
