import {
  PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION,
  captureProjectSnapshotPending,
  normalizeProjectSnapshotId,
  verifyProjectSnapshot
} from './project-snapshots.js';
import { redactText } from './security.js';

const MAX_WORKER_REQUEST_BYTES = 8 * 1024;

function workerError(error) {
  const suppliedCode = String(error?.code ?? 'PROJECT_SNAPSHOT_WORKER_FAILED');
  return {
    code: /^[A-Z0-9_]{1,80}$/.test(suppliedCode)
      ? suppliedCode
      : 'PROJECT_SNAPSHOT_WORKER_FAILED',
    message: redactText(String(error?.message ?? error))
  };
}

try {
  const encoded = process.argv[2];
  if (!encoded || process.argv.length !== 3 ||
      Buffer.byteLength(encoded, 'utf8') > MAX_WORKER_REQUEST_BYTES) {
    throw Object.assign(new Error('Snapshot worker requires one bounded request.'), {
      code: 'INVALID_PROJECT_SNAPSHOT_REQUEST'
    });
  }
  const request = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (request?.schema_version !== PROJECT_SNAPSHOT_REPORT_SCHEMA_VERSION ||
      !['capture', 'verify'].includes(request.operation)) {
    throw Object.assign(new Error('Unsupported snapshot worker request.'), {
      code: 'INVALID_PROJECT_SNAPSHOT_REQUEST'
    });
  }
  const snapshotId = normalizeProjectSnapshotId(request.snapshot_id);
  if (request.operation === 'capture') {
    if (Object.keys(request).some((key) => ![
      'schema_version', 'operation', 'snapshot_id'
    ].includes(key))) {
      throw Object.assign(new Error('Unknown snapshot capture request field.'), {
        code: 'INVALID_PROJECT_SNAPSHOT_REQUEST'
      });
    }
    const capture = captureProjectSnapshotPending(process.cwd(), snapshotId);
    process.stdout.write(JSON.stringify({ ok: true, capture }) + '\n');
  } else {
    if (Object.keys(request).some((key) => ![
      'schema_version', 'operation', 'snapshot_id', 'strict'
    ].includes(key)) || typeof request.strict !== 'boolean') {
      throw Object.assign(new Error('Invalid snapshot verification request.'), {
        code: 'INVALID_PROJECT_SNAPSHOT_REQUEST'
      });
    }
    const report = verifyProjectSnapshot(process.cwd(), snapshotId, {
      strict: request.strict
    });
    process.stdout.write(JSON.stringify({ ok: true, report }) + '\n');
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: workerError(error) }) + '\n');
  process.exitCode = 1;
}
