import {
  buildCadProject,
  simulateCadBuild,
  sliceCadBuild
} from './cad.js';

const MAX_REQUEST_BYTES = 128 * 1024;

function fail(message, code = 'INVALID_CAD_WORKER_REQUEST') {
  throw Object.assign(new Error(message), { code });
}

function decodeRequest(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_REQUEST_BYTES * 2) {
    fail('CAD worker request is missing or too large.');
  }
  let buffer;
  try { buffer = Buffer.from(value, 'base64url'); } catch { fail('CAD worker request encoding is invalid.'); }
  if (buffer.length > MAX_REQUEST_BYTES) fail('CAD worker request is too large.');
  let request;
  try { request = JSON.parse(buffer.toString('utf8')); } catch { fail('CAD worker request JSON is invalid.'); }
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('CAD worker request must be an object.');
  return request;
}

function publicResult(result) {
  return {
    manifest: result.manifest,
    manifest_sha256: result.manifest_sha256,
    verification: result.verification,
    ...(result.review ? { review: result.review } : {})
  };
}

try {
  const request = decodeRequest(process.argv[2]);
  let result;
  if (request.operation === 'build') {
    result = buildCadProject({
      cwd: process.cwd(),
      cadProjectId: request.cad_project_id,
      timeoutMs: request.timeout_ms
    });
  } else if (request.operation === 'simulate') {
    result = simulateCadBuild({
      cwd: process.cwd(),
      buildId: request.build_id,
      densityGcm3: request.density_g_cm3,
      maximumSevereOverhangFraction: request.maximum_severe_overhang_fraction
    });
  } else if (request.operation === 'slice') {
    result = sliceCadBuild({
      cwd: process.cwd(),
      buildId: request.build_id,
      mode: request.mode,
      profilePath: request.profile_path,
      acknowledgePhysicalRisk: request.acknowledge_physical_risk,
      settings: request.settings,
      timeoutMs: request.timeout_ms
    });
  } else {
    fail('Unsupported CAD worker operation: ' + String(request.operation ?? ''));
  }
  process.stdout.write(JSON.stringify({ ok: true, result: publicResult(result) }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: { code: error.code ?? 'CAD_WORKER_ERROR', message: error.message }
  }) + '\n');
  process.exitCode = 1;
}
