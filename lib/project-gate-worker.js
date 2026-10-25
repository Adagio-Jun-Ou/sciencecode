import {
  PROJECT_GATE_SCHEMA_VERSION,
  buildProjectGateReport
} from './project-gate.js';
import { redactText } from './security.js';

const MAX_WORKER_REQUEST_BYTES = 8 * 1024;

function workerError(error) {
  const suppliedCode = String(error?.code ?? 'PROJECT_GATE_WORKER_FAILED');
  return {
    code: /^[A-Z0-9_]{1,80}$/.test(suppliedCode)
      ? suppliedCode
      : 'PROJECT_GATE_WORKER_FAILED',
    message: redactText(String(error?.message ?? error))
  };
}

try {
  const encoded = process.argv[2];
  if (!encoded || process.argv.length !== 3) {
    throw Object.assign(new Error('Project gate worker requires one encoded request.'), {
      code: 'INVALID_PROJECT_GATE_REQUEST'
    });
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_WORKER_REQUEST_BYTES) {
    throw Object.assign(new Error('Project gate worker request is too large.'), {
      code: 'INVALID_PROJECT_GATE_REQUEST'
    });
  }
  const request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (request?.schema_version !== PROJECT_GATE_SCHEMA_VERSION) {
    throw Object.assign(new Error('Unsupported project gate worker request.'), {
      code: 'INVALID_PROJECT_GATE_REQUEST'
    });
  }
  const report = buildProjectGateReport(process.cwd(), request.policy);
  process.stdout.write(JSON.stringify({ ok: true, report }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: workerError(error) }) + '\n');
  process.exitCode = 1;
}
