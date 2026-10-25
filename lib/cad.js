import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendAudit, readAuditRecords, verifyAudit } from './audit.js';
import { VERSION } from './constants.js';
import { sha256Buffer, sha256File, sha256Json, sha256Text } from './hash.js';
import { analyzeAsciiStl, analyzeGcode } from './mesh.js';
import { probeCadRuntime } from './compute.js';
import { findExecutable, runCommandSync } from './process.js';
import { redactText, scanSecrets } from './security.js';
import {
  ensureScienceDir,
  INTERNAL_DIR,
  isPathInside,
  portablePath,
  readJson,
  relativePortable,
  resolvePortableSnapshotPath,
  writeJson,
  writeJsonExclusive,
  writeTextExclusive
} from './storage.js';

export const CAD_PROJECT_SCHEMA_VERSION = 1;
export const CAD_BUILD_SCHEMA_VERSION = 1;
export const CAD_SIMULATION_SCHEMA_VERSION = 1;
export const CAD_SLICE_SCHEMA_VERSION = 1;
export const CAD_REVISION_SCHEMA_VERSION = 1;
export const CAD_ENGINE_VERSION = 'sciencecode-cad-2';

export const MAX_CAD_FILES = 256;
export const MAX_CAD_PARTS = 512;
export const MAX_CAD_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_CAD_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_CAD_RECORD_FILES = 1_024;
export const MAX_CAD_RECORDS = 10_000;
export const MAX_CAD_BUILD_TIMEOUT_MS = 30 * 60 * 1_000;
export const MAX_CAD_SLICE_TIMEOUT_MS = 30 * 60 * 1_000;

const ID_PATTERN = /^cad-[a-z0-9][a-z0-9-]{0,62}$/;
const RECORD_ID_PATTERN = /^(?:cad-build|cad-sim|cad-slice|cad-revision)-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PART_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MODULE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TEXT_EXTENSIONS = new Set(['.scad', '.py', '.json', '.dxf', '.svg', '.obj', '.off', '.amf']);
const EDITABLE_EXTENSIONS = new Set(['.scad', '.py']);
const CAD_EXTENSIONS = new Set([
  '.scad', '.py', '.json', '.stl', '.3mf', '.obj', '.off', '.amf', '.dxf', '.svg',
  '.step', '.stp', '.iges', '.igs', '.brep'
]);
const CAD_ENGINES = new Set(['openscad', 'cadquery']);
const MAX_LABEL = 240;

function cadError(message, code = 'INVALID_CAD_PROJECT', extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function label(value, name, { required = true, maximum = MAX_LABEL } = {}) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (required && !normalized) throw cadError(name + ' is required.');
  if (!normalized) return null;
  if (normalized.length > maximum) throw cadError(name + ' must be ' + maximum + ' characters or fewer.');
  const findings = scanSecrets(normalized);
  if (findings.length) throw cadError('Potential secret detected in ' + name + '.', 'SECRET_DETECTED', { findings });
  return normalized;
}

function boundedNumber(value, name, minimum, maximum, fallback = null) {
  if ((value === undefined || value === null || value === '') && fallback !== null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw cadError(name + ' must be a finite number from ' + minimum + ' through ' + maximum + '.');
  }
  return number;
}

function vector(value, name, { minimum = -1_000_000, maximum = 1_000_000, fallback = null } = {}) {
  const candidate = value === undefined || value === null ? fallback : value;
  if (!Array.isArray(candidate) || candidate.length !== 3) {
    throw cadError(name + ' must contain exactly three numbers.');
  }
  return candidate.map((item, index) => boundedNumber(item, name + '[' + index + ']', minimum, maximum));
}

function safeJsonValue(value, name, depth = 0) {
  if (depth > 8) throw cadError(name + ' is nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > 8_192) throw cadError(name + ' string is too large.');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw cadError(name + ' contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_024) throw cadError(name + ' array is too large.');
    return value.map((item, index) => safeJsonValue(item, name + '[' + index + ']', depth + 1));
  }
  if (plainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > 1_024) throw cadError(name + ' object is too large.');
    return Object.fromEntries(entries.map(([key, item]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw cadError(name + ' contains an unsafe key: ' + key);
      }
      return [key, safeJsonValue(item, name + '.' + key, depth + 1)];
    }));
  }
  throw cadError(name + ' must contain only JSON values.');
}

function normalizeRelativeCadPath(value, name = 'CAD file') {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw cadError(name + ' must be a non-empty project-relative path.', 'INVALID_CAD_PATH');
  }
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:\//.test(normalized)) {
    throw cadError(name + ' must be project-relative: ' + value, 'INVALID_CAD_PATH');
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9_][A-Za-z0-9_. -]{0,127}$/.test(part))) {
    throw cadError(name + ' contains an unsafe path segment: ' + value, 'INVALID_CAD_PATH');
  }
  if (normalized.length > 600) throw cadError(name + ' path is too long.', 'INVALID_CAD_PATH');
  const extension = path.posix.extname(normalized).toLowerCase();
  if (!CAD_EXTENSIONS.has(extension)) {
    throw cadError(name + ' has an unsupported CAD extension: ' + extension, 'UNSUPPORTED_CAD_FORMAT');
  }
  return normalized;
}

function normalizeTransform(value, name) {
  if (value === undefined || value === null) {
    return { translate_mm: [0, 0, 0], rotate_deg: [0, 0, 0], scale: [1, 1, 1] };
  }
  if (!plainObject(value)) throw cadError(name + ' must be an object.');
  return {
    translate_mm: vector(value.translate_mm, name + '.translate_mm', { fallback: [0, 0, 0] }),
    rotate_deg: vector(value.rotate_deg, name + '.rotate_deg', { minimum: -360_000, maximum: 360_000, fallback: [0, 0, 0] }),
    scale: vector(value.scale, name + '.scale', { minimum: 0.000001, maximum: 1_000, fallback: [1, 1, 1] })
  };
}

function slug(value) {
  const normalized = String(value ?? '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return normalized || 'design';
}

export function makeCadProjectId(name) {
  return 'cad-' + slug(name);
}

function makeRecordId(prefix, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return prefix + '-' + stamp + '-' + crypto.randomBytes(3).toString('hex');
}

export function normalizeCadProjectSpec(value) {
  if (!plainObject(value)) throw cadError('CAD project specification must be an object.');
  const name = label(value.name, 'CAD project name');
  const cadProjectId = String(value.cad_project_id ?? makeCadProjectId(name));
  if (!ID_PATTERN.test(cadProjectId)) {
    throw cadError('CAD project ID must start with cad- and contain lowercase letters, numbers, or hyphens.', 'INVALID_CAD_ID');
  }
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > MAX_CAD_FILES) {
    throw cadError('CAD project files must contain 1 through ' + MAX_CAD_FILES + ' paths.');
  }
  const files = value.files.map((item, index) => normalizeRelativeCadPath(item, 'files[' + index + ']'));
  if (new Set(files).size !== files.length) throw cadError('CAD project file paths must be unique.');
  const requestedEntry = value.entry ?? (value.engine === 'cadquery' ? 'assembly.py' : 'assembly.scad');
  const entry = normalizeRelativeCadPath(requestedEntry, 'CAD entry');
  const entryExtension = path.posix.extname(entry).toLowerCase();
  const engine = String(value.engine ?? (entryExtension === '.py' ? 'cadquery' : 'openscad')).toLowerCase();
  if (!CAD_ENGINES.has(engine)) throw cadError('CAD engine must be openscad or cadquery.', 'UNSUPPORTED_CAD_ENGINE');
  const expectedEntryExtension = engine === 'cadquery' ? '.py' : '.scad';
  if (entryExtension !== expectedEntryExtension) {
    throw cadError('CAD ' + engine + ' entry must use ' + expectedEntryExtension + '.', 'INVALID_CAD_ENTRY');
  }
  if (!files.includes(entry)) throw cadError('CAD entry must be included in files.');
  const inputParts = value.parts ?? [];
  if (!Array.isArray(inputParts) || inputParts.length > MAX_CAD_PARTS) {
    throw cadError('CAD parts must contain at most ' + MAX_CAD_PARTS + ' entries.');
  }
  const parts = inputParts.map((item, index) => {
    if (!plainObject(item)) throw cadError('parts[' + index + '] must be an object.');
    const id = String(item.id ?? '');
    if (!PART_ID_PATTERN.test(id)) throw cadError('Invalid part ID at parts[' + index + '].');
    const source = normalizeRelativeCadPath(item.source, 'parts[' + index + '].source');
    if (!files.includes(source)) throw cadError('Part source is not declared in files: ' + source);
    const sourceExtension = path.posix.extname(source).toLowerCase();
    if (engine === 'openscad' && sourceExtension !== '.scad') throw cadError('OpenSCAD part source must be a .scad file: ' + source);
    if (engine === 'cadquery' && !['.py', '.step', '.stp', '.iges', '.igs', '.brep'].includes(sourceExtension)) {
      throw cadError('CadQuery part source must be Python or a B-rep interchange file: ' + source);
    }
    const moduleName = item.module === undefined || item.module === null ? null : String(item.module);
    if (moduleName !== null && (!MODULE_PATTERN.test(moduleName) || engine !== 'openscad')) {
      throw cadError('OpenSCAD module metadata is invalid for part ' + id + '.');
    }
    const symbolName = item.symbol === undefined || item.symbol === null ? null : String(item.symbol);
    if (symbolName !== null && (!MODULE_PATTERN.test(symbolName) || engine !== 'cadquery')) {
      throw cadError('CadQuery symbol metadata is invalid for part ' + id + '.');
    }
    return {
      id,
      name: label(item.name ?? id, 'Part name'),
      source,
      module: moduleName,
      symbol: symbolName,
      quantity: Math.trunc(boundedNumber(item.quantity ?? 1, 'Part quantity', 1, 10_000)),
      material: label(item.material, 'Part material', { required: false }),
      color: label(item.color, 'Part color', { required: false, maximum: 80 }),
      transform: normalizeTransform(item.transform, 'parts[' + index + '].transform')
    };
  });
  if (new Set(parts.map((item) => item.id)).size !== parts.length) throw cadError('Part IDs must be unique.');
  const parameters = safeJsonValue(value.parameters ?? {}, 'parameters');
  const buildVolume = vector(value.build_volume_mm, 'build_volume_mm', {
    minimum: 0.001,
    maximum: 1_000_000,
    fallback: [250, 210, 220]
  });
  const simulationValue = value.simulation ?? {};
  if (!plainObject(simulationValue)) throw cadError('simulation must be an object.');
  const tessellationValue = value.tessellation ?? {};
  if (!plainObject(tessellationValue)) throw cadError('tessellation must be an object.');
  const normalized = {
    schema_version: CAD_PROJECT_SCHEMA_VERSION,
    cad_project_id: cadProjectId,
    name,
    description: label(value.description, 'CAD project description', { required: false, maximum: 2_000 }),
    context_of_use: label(value.context_of_use ?? 'Exploratory design and virtual print preparation only.', 'Context of use', { maximum: 2_000 }),
    units: 'mm',
    engine,
    entry,
    files,
    parts,
    parameters,
    build_volume_mm: buildVolume,
    tessellation: {
      linear_tolerance_mm: boundedNumber(tessellationValue.linear_tolerance_mm ?? 0.05, 'tessellation.linear_tolerance_mm', 0.000001, 100),
      angular_tolerance_rad: boundedNumber(tessellationValue.angular_tolerance_rad ?? 0.1, 'tessellation.angular_tolerance_rad', 0.000001, Math.PI)
    },
    simulation: {
      density_g_cm3: boundedNumber(simulationValue.density_g_cm3 ?? 1.24, 'simulation.density_g_cm3', 0.000001, 100),
      gravity_m_s2: vector(simulationValue.gravity_m_s2, 'simulation.gravity_m_s2', { minimum: -1_000_000, maximum: 1_000_000, fallback: [0, 0, -9.80665] })
    },
    execution_policy: {
      source_scope: 'declared_files_snapshotted_before_execution',
      dynamic_imports: engine === 'openscad' ? 'disabled_by_static_preflight' : 'python_runtime_imports_recorded_not_blocked',
      os_sandbox: 'not_provided_process_runs_with_user_permissions',
      network: engine === 'cadquery' ? 'not_blocked_by_os' : 'not_requested_by_sciencecode',
      slicer_post_process: 'disabled',
      printer_transmission: 'disabled',
      physical_execution: 'disabled'
    }
  };
  const encoded = JSON.stringify(normalized);
  if (Buffer.byteLength(encoded) > 512 * 1024) throw cadError('CAD project specification is too large.');
  const findings = scanSecrets(encoded);
  if (findings.length) throw cadError('Potential secret detected in CAD project specification.', 'SECRET_DETECTED', { findings });
  return normalized;
}

function defaultFiles() {
  return {
    'assembly.scad': [
      '// ScienceCode editable assembly',
      'use <parts/base.scad>',
      'use <parts/bracket.scad>',
      '',
      'base_part();',
      'translate([32, 0, 4]) bracket_part();',
      ''
    ].join('\n'),
    'parts/base.scad': [
      '// Parametric base plate, dimensions in millimeters',
      'module base_part(length=56, width=34, height=4, corner=3) {',
      '  linear_extrude(height=height)',
      '    offset(r=corner) offset(delta=-corner)',
      '      square([length, width], center=true);',
      '}',
      ''
    ].join('\n'),
    'parts/bracket.scad': [
      '// Parametric L bracket, dimensions in millimeters',
      'module bracket_part(width=20, depth=20, height=28, wall=4) {',
      '  union() {',
      '    cube([width, depth, wall], center=false);',
      '    cube([wall, depth, height], center=false);',
      '  }',
      '}',
      ''
    ].join('\n')
  };
}

function defaultCadQueryFiles() {
  return {
    'assembly.py': [
      'import cadquery as cq',
      'from parts.base import make_base',
      'from parts.bracket import make_bracket',
      '',
      'def build(parameters):',
      '    base = make_base(',
      '        length=parameters.get("base_length_mm", 56),',
      '        width=parameters.get("base_width_mm", 34),',
      '        height=parameters.get("base_height_mm", 4),',
      '    )',
      '    bracket = make_bracket().translate((32, 0, 4))',
      '    assembly = cq.Assembly(name="sciencecode_assembly")',
      '    assembly.add(base, name="base", color=cq.Color("gray"))',
      '    assembly.add(bracket, name="bracket", color=cq.Color(0.27, 0.51, 0.71))',
      '    return assembly',
      ''
    ].join('\n'),
    'parts/__init__.py': '',
    'parts/base.py': [
      'import cadquery as cq',
      '',
      'def make_base(length=56, width=34, height=4, corner=3):',
      '    return (',
      '        cq.Workplane("XY")',
      '        .rect(length, width)',
      '        .extrude(height)',
      '        .edges("|Z")',
      '        .fillet(corner)',
      '    )',
      ''
    ].join('\n'),
    'parts/bracket.py': [
      'import cadquery as cq',
      '',
      'def make_bracket(width=20, depth=20, height=28, wall=4):',
      '    foot = cq.Workplane("XY").box(width, depth, wall, centered=(False, False, False))',
      '    upright = cq.Workplane("XY").box(wall, depth, height, centered=(False, False, False))',
      '    return foot.union(upright)',
      ''
    ].join('\n')
  };
}

export function defaultCadProjectSpec(name = 'Parametric assembly', { engine = 'openscad' } = {}) {
  if (!CAD_ENGINES.has(String(engine))) throw cadError('CAD engine must be openscad or cadquery.', 'UNSUPPORTED_CAD_ENGINE');
  if (engine === 'cadquery') {
    const files = defaultCadQueryFiles();
    return normalizeCadProjectSpec({
      name,
      engine,
      description: 'A multi-file CadQuery assembly editable by a user or the ScienceCode Scientist.',
      entry: 'assembly.py',
      files: Object.keys(files),
      parts: [
        { id: 'base', name: 'Base plate', source: 'parts/base.py', symbol: 'make_base', material: 'PLA' },
        { id: 'bracket', name: 'L bracket', source: 'parts/bracket.py', symbol: 'make_bracket', material: 'PLA', transform: { translate_mm: [32, 0, 4] } }
      ],
      parameters: { base_length_mm: 56, base_width_mm: 34, base_height_mm: 4 },
      build_volume_mm: [250, 210, 220],
      simulation: { density_g_cm3: 1.24 }
    });
  }
  return normalizeCadProjectSpec({
    name,
    engine,
    description: 'A multi-file parametric assembly editable by a user or the ScienceCode Scientist.',
    entry: 'assembly.scad',
    files: Object.keys(defaultFiles()),
    parts: [
      { id: 'base', name: 'Base plate', source: 'parts/base.scad', module: 'base_part', material: 'PLA' },
      { id: 'bracket', name: 'L bracket', source: 'parts/bracket.scad', module: 'bracket_part', material: 'PLA', transform: { translate_mm: [32, 0, 4] } }
    ],
    build_volume_mm: [250, 210, 220],
    simulation: { density_g_cm3: 1.24 }
  });
}

export function initializeCadProject({
  cwd,
  name = 'Parametric assembly',
  cadProjectId,
  engine = 'openscad',
  now = new Date()
}) {
  const base = defaultCadProjectSpec(name, { engine });
  const spec = cadProjectId
    ? normalizeCadProjectSpec({ ...base, cad_project_id: cadProjectId })
    : base;
  return createCadProject({
    cwd, spec, files: engine === 'cadquery' ? defaultCadQueryFiles() : defaultFiles(), now
  });
}

export function createCadProjectFromSpecFile({
  cwd,
  specPath,
  now = new Date()
}) {
  const project = path.resolve(cwd);
  const specFile = resolvePortableSnapshotPath(project, specPath);
  const specStat = fs.lstatSync(specFile, { throwIfNoEntry: false });
  if (!specStat?.isFile() || specStat.isSymbolicLink()) {
    throw cadError('CAD project specification must be a regular project file.', 'INVALID_CAD_DESCRIPTOR');
  }
  if (specStat.size > 512 * 1024) {
    throw cadError('CAD project specification is too large.', 'INVALID_CAD_DESCRIPTOR');
  }
  const projectReal = fs.realpathSync(project);
  const specReal = fs.realpathSync(specFile);
  if (!isPathInside(projectReal, specReal)) {
    throw cadError('CAD project specification escapes the project root.', 'INVALID_CAD_PATH');
  }
  const descriptor = normalizeCadProjectSpec(readJson(specReal));
  const sourceRoot = path.dirname(specReal);
  const sourceRootReal = fs.realpathSync(sourceRoot);
  const files = {};
  let totalBytes = 0;
  for (const relative of descriptor.files) {
    const source = resolvePortableSnapshotPath(sourceRoot, relative);
    const stat = fs.lstatSync(source, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw cadError('Declared CAD import source is missing or unsafe: ' + relative, 'CAD_SOURCE_NOT_FOUND');
    }
    const sourceReal = fs.realpathSync(source);
    if (!isPathInside(sourceRootReal, sourceReal)) {
      throw cadError('Declared CAD import source escapes the specification directory: ' + relative, 'INVALID_CAD_PATH');
    }
    if (stat.size > MAX_CAD_FILE_BYTES) {
      throw cadError('CAD import source exceeds the per-file size limit: ' + relative, 'CAD_SOURCE_TOO_LARGE');
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_CAD_SOURCE_BYTES) {
      throw cadError('CAD import source tree exceeds the aggregate size limit.', 'CAD_SOURCE_TOO_LARGE');
    }
    files[relative] = fs.readFileSync(sourceReal);
  }
  const created = createCadProject({ cwd: project, spec: descriptor, files, now });
  const importedFrom = relativePortable(project, specReal);
  const importAudit = appendAudit(project, {
    type: 'cad.project.imported',
    cad_project_id: descriptor.cad_project_id,
    specification: importedFrom,
    specification_sha256: sha256File(specReal),
    source_sha256: sha256Json(created.files)
  });
  return { ...created, imported_from: importedFrom, import_audit: importAudit };
}

function projectRegistryDirectory(cwd, cadProjectId) {
  if (!ID_PATTERN.test(String(cadProjectId ?? ''))) throw cadError('Invalid CAD project ID.', 'INVALID_CAD_ID');
  return path.join(path.resolve(cwd), INTERNAL_DIR, 'cad-projects', cadProjectId);
}

function loadRegistry(cwd, cadProjectId) {
  const file = path.join(projectRegistryDirectory(cwd, cadProjectId), 'manifest.json');
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw cadError('CAD project not found: ' + cadProjectId, 'CAD_PROJECT_NOT_FOUND');
  }
  const registry = readJson(file);
  if (registry.schema_version !== CAD_PROJECT_SCHEMA_VERSION || registry.cad_project_id !== cadProjectId) {
    throw cadError('CAD project registry is invalid: ' + cadProjectId, 'INVALID_CAD_REGISTRY');
  }
  return { registry, file };
}

function resolveProjectRoot(cwd, registry) {
  const project = path.resolve(cwd);
  const root = resolvePortableSnapshotPath(project, registry.project_path);
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw cadError('CAD project directory is unavailable or unsafe.', 'INVALID_CAD_PATH');
  const realProject = fs.realpathSync(project);
  const realRoot = fs.realpathSync(root);
  if (!isPathInside(realProject, realRoot)) throw cadError('CAD project directory escapes the project root.', 'INVALID_CAD_PATH');
  return root;
}

function loadDescriptor(cwd, registry) {
  const root = resolveProjectRoot(cwd, registry);
  const descriptorFile = path.join(root, 'sciencecode.cad.json');
  const stat = fs.lstatSync(descriptorFile, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) throw cadError('CAD descriptor is unavailable or unsafe.', 'INVALID_CAD_DESCRIPTOR');
  const storedDescriptor = readJson(descriptorFile);
  const descriptor = normalizeCadProjectSpec(storedDescriptor);
  const registeredHashMatches = sha256Json(descriptor) === registry.descriptor_sha256 ||
    sha256Json(storedDescriptor) === registry.descriptor_sha256;
  if (descriptor.cad_project_id !== registry.cad_project_id || !registeredHashMatches) {
    throw cadError('CAD descriptor differs from the registered project contract.', 'CAD_DESCRIPTOR_MODIFIED');
  }
  return { root, descriptor, descriptorFile };
}

function assertRegularInside(root, relative) {
  const target = resolvePortableSnapshotPath(root, relative);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw cadError('Declared CAD source is missing or not a regular file: ' + relative, 'CAD_SOURCE_NOT_FOUND');
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (!isPathInside(realRoot, realTarget)) throw cadError('CAD source escapes its project through a link: ' + relative, 'INVALID_CAD_PATH');
  if (stat.size > MAX_CAD_FILE_BYTES) throw cadError('CAD source exceeds the per-file size limit: ' + relative, 'CAD_SOURCE_TOO_LARGE');
  return { target, stat };
}

function stripScadComments(text) {
  let output = '';
  let mode = 'code';
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (mode === 'line') {
      if (char === '\n') { mode = 'code'; output += '\n'; } else output += ' ';
      continue;
    }
    if (mode === 'block') {
      if (char === '*' && next === '/') { output += '  '; index += 1; mode = 'code'; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      output += char;
      if (char === '\\' && next !== undefined) { output += next; index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { output += '  '; index += 1; mode = 'line'; continue; }
    if (char === '/' && next === '*') { output += '  '; index += 1; mode = 'block'; continue; }
    if (char === '"' || char === "'") quote = char;
    output += char;
  }
  if (mode === 'block') throw cadError('OpenSCAD source contains an unterminated block comment.', 'INVALID_SCAD_SOURCE');
  return output;
}

function decodeScadString(value) {
  try { return JSON.parse('"' + value.replace(/"/g, '\\"') + '"'); } catch { return value; }
}

function normalizeReference(sourceFile, raw) {
  const reference = String(raw).trim().replace(/\\/g, '/');
  if (!reference || reference.startsWith('/') || /^[A-Za-z]:\//.test(reference)) {
    throw cadError('OpenSCAD reference must be project-relative in ' + sourceFile + ': ' + raw, 'UNSAFE_CAD_REFERENCE');
  }
  const segments = reference.split('/');
  if (segments.some((item) => !item || item === '.' || item === '..')) {
    throw cadError('OpenSCAD references may not contain dot or parent segments in ' + sourceFile + ': ' + raw, 'UNSAFE_CAD_REFERENCE');
  }
  const combined = path.posix.join(path.posix.dirname(sourceFile), reference);
  return normalizeRelativeCadPath(combined, 'OpenSCAD reference');
}

function inspectScadReferences(sourceFile, text, declared) {
  const code = stripScadComments(text);
  const references = [];
  let masked = code;
  const includePattern = /\b(include|use)\s*<([^>\r\n]+)>/gi;
  masked = masked.replace(includePattern, (whole, kind, raw) => {
    const resolved = normalizeReference(sourceFile, raw);
    if (!declared.has(resolved)) throw cadError(kind + ' references undeclared CAD file: ' + resolved, 'UNDECLARED_CAD_REFERENCE');
    references.push({ kind: kind.toLowerCase(), path: resolved });
    return ' '.repeat(whole.length);
  });
  if (/\b(?:include|use)\b/i.test(masked)) {
    throw cadError('OpenSCAD include/use declarations must use a static <declared/path.scad> in ' + sourceFile + '.', 'DYNAMIC_CAD_REFERENCE');
  }
  const importPattern = /\b(import|surface)\s*\(([^)]*)\)/gi;
  let importCount = 0;
  masked = masked.replace(importPattern, (whole, kind, args) => {
    importCount += 1;
    const named = args.match(/\bfile\s*=\s*"((?:\\.|[^"\\])*)"/i);
    const positional = args.match(/^\s*"((?:\\.|[^"\\])*)"/);
    const match = named ?? positional;
    if (!match) throw cadError(kind + ' requires a static quoted file path in ' + sourceFile + '.', 'DYNAMIC_CAD_REFERENCE');
    const resolved = normalizeReference(sourceFile, decodeScadString(match[1]));
    if (!declared.has(resolved)) throw cadError(kind + ' references undeclared CAD file: ' + resolved, 'UNDECLARED_CAD_REFERENCE');
    references.push({ kind: kind.toLowerCase(), path: resolved });
    return ' '.repeat(whole.length);
  });
  const leftoverImports = (masked.match(/\b(?:import|surface)\s*\(/gi) ?? []).length;
  if (leftoverImports > 0 || importCount > 1_024) {
    throw cadError('OpenSCAD imports must be statically inspectable in ' + sourceFile + '.', 'DYNAMIC_CAD_REFERENCE');
  }
  return references;
}

function inspectProjectSources(cwd, registry) {
  const { root, descriptor } = loadDescriptor(cwd, registry);
  const declared = new Set(descriptor.files);
  const sources = [];
  const references = [];
  let totalBytes = 0;
  for (const relative of descriptor.files) {
    const { target, stat } = assertRegularInside(root, relative);
    totalBytes += stat.size;
    if (totalBytes > MAX_CAD_SOURCE_BYTES) throw cadError('CAD source tree exceeds the aggregate size limit.', 'CAD_SOURCE_TOO_LARGE');
    const buffer = fs.readFileSync(target);
    const extension = path.posix.extname(relative).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension)) {
      const text = buffer.toString('utf8');
      const findings = scanSecrets(text);
      if (findings.length) throw cadError('Potential secret detected in CAD source: ' + relative, 'SECRET_DETECTED', { findings });
      if (extension === '.scad') references.push(...inspectScadReferences(relative, text, declared).map((item) => ({ source: relative, ...item })));
    }
    sources.push({
      path: relative,
      bytes: stat.size,
      sha256: sha256Buffer(buffer),
      text: TEXT_EXTENSIONS.has(extension),
      editable: EDITABLE_EXTENSIONS.has(extension)
    });
  }
  return { root, descriptor, sources, references, total_bytes: totalBytes };
}

export function createCadProject({ cwd, spec, files, now = new Date() }) {
  const project = path.resolve(cwd);
  if (!fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) throw cadError('Project directory does not exist.', 'PROJECT_NOT_FOUND');
  const descriptor = normalizeCadProjectSpec(spec ?? defaultCadProjectSpec());
  const providedFiles = files ?? (spec ? {} : defaultFiles());
  if (!plainObject(providedFiles)) throw cadError('CAD file contents must be an object keyed by declared path.');
  const declared = new Set(descriptor.files);
  for (const key of Object.keys(providedFiles)) {
    const normalized = normalizeRelativeCadPath(key);
    if (!declared.has(normalized)) throw cadError('File content was supplied for an undeclared path: ' + normalized);
  }
  for (const relative of descriptor.files) {
    if (!(relative in providedFiles)) throw cadError('Missing initial content for declared CAD file: ' + relative);
    const content = providedFiles[relative];
    if (!(typeof content === 'string' || Buffer.isBuffer(content))) throw cadError('CAD file content must be text or a Buffer: ' + relative);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (buffer.length > MAX_CAD_FILE_BYTES) throw cadError('CAD file exceeds the per-file size limit: ' + relative, 'CAD_SOURCE_TOO_LARGE');
    if (TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) {
      const findings = scanSecrets(buffer.toString('utf8'));
      if (findings.length) throw cadError('Potential secret detected in CAD source: ' + relative, 'SECRET_DETECTED', { findings });
      if (relative.endsWith('.scad')) inspectScadReferences(relative, buffer.toString('utf8'), declared);
    }
  }
  const sourceTotal = Object.values(providedFiles).reduce((sum, content) => sum + (Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content)), 0);
  if (sourceTotal > MAX_CAD_SOURCE_BYTES) throw cadError('CAD source tree exceeds the aggregate size limit.', 'CAD_SOURCE_TOO_LARGE');
  const relativeRoot = portablePath(path.posix.join('cad', descriptor.cad_project_id));
  const root = resolvePortableSnapshotPath(project, relativeRoot);
  if (fs.existsSync(root) || fs.existsSync(projectRegistryDirectory(project, descriptor.cad_project_id))) {
    throw cadError('CAD project already exists: ' + descriptor.cad_project_id, 'CAD_PROJECT_EXISTS');
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const relative of descriptor.files) {
    const target = resolvePortableSnapshotPath(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const content = providedFiles[relative];
    const descriptorFd = fs.openSync(target, 'wx', 0o600);
    try { fs.writeFileSync(descriptorFd, content); fs.fsyncSync(descriptorFd); } finally { fs.closeSync(descriptorFd); }
  }
  writeJsonExclusive(path.join(root, 'sciencecode.cad.json'), descriptor);
  ensureScienceDir(project);
  const registryDir = projectRegistryDirectory(project, descriptor.cad_project_id);
  fs.mkdirSync(registryDir, { recursive: false, mode: 0o700 });
  const registry = {
    schema_version: CAD_PROJECT_SCHEMA_VERSION,
    engine_version: CAD_ENGINE_VERSION,
    sciencecode_version: VERSION,
    cad_project_id: descriptor.cad_project_id,
    created_at: now.toISOString(),
    project_path: relativePortable(project, root),
    descriptor_sha256: sha256Json(descriptor),
    descriptor
  };
  writeJsonExclusive(path.join(registryDir, 'manifest.json'), registry);
  const inspection = inspectProjectSources(project, registry);
  const audit = appendAudit(project, {
    type: 'cad.project.created',
    cad_project_id: descriptor.cad_project_id,
    engine: descriptor.engine,
    descriptor_sha256: registry.descriptor_sha256,
    source_files: inspection.sources.length
  });
  return { registry, descriptor, files: inspection.sources, references: inspection.references, audit };
}

function listRegistryManifests(cwd) {
  const root = path.join(path.resolve(cwd), INTERNAL_DIR, 'cad-projects');
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  if (entries.length > MAX_CAD_RECORDS) throw cadError('CAD project record limit exceeded.', 'CAD_RECORD_LIMIT');
  return entries.filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
    .map((entry) => readJson(path.join(root, entry.name, 'manifest.json')));
}

export function listCadProjects(cwd) {
  return listRegistryManifests(cwd).map((registry) => {
    let current = null;
    let issue = null;
    try { current = inspectProjectSources(cwd, registry); } catch (error) { issue = { code: error.code ?? 'CAD_ERROR', message: error.message }; }
    return {
      cad_project_id: registry.cad_project_id,
      name: registry.descriptor?.name ?? registry.cad_project_id,
      description: registry.descriptor?.description ?? null,
      engine: current?.descriptor?.engine ?? registry.descriptor?.engine ?? 'openscad',
      project_path: registry.project_path,
      created_at: registry.created_at,
      file_count: registry.descriptor?.files?.length ?? 0,
      part_count: registry.descriptor?.parts?.length ?? 0,
      source_sha256: current ? sha256Json(current.sources) : null,
      healthy: Boolean(current),
      issue
    };
  }).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function listRecords(cwd, directoryName, prefix, filter = {}) {
  const root = path.join(path.resolve(cwd), INTERNAL_DIR, directoryName);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  if (entries.length > MAX_CAD_RECORDS) throw cadError('CAD record limit exceeded.', 'CAD_RECORD_LIMIT');
  return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix + '-'))
    .map((entry) => {
      try { return readJson(path.join(root, entry.name, 'manifest.json')); } catch {
        const idField = prefix === 'cad-sim'
          ? 'simulation_id'
          : prefix.replace('cad-', '') + '_id';
        return {
          schema_version: null,
          [idField]: entry.name,
          cad_project_id: null,
          created_at: null,
          status: 'invalid',
          incomplete_record: true
        };
      }
    })
    .filter((manifest) => !filter.cadProjectId || manifest.cad_project_id === filter.cadProjectId)
    .filter((manifest) => !filter.buildId || manifest.build_id === filter.buildId)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

export function getCadProject(cwd, cadProjectId) {
  const { registry } = loadRegistry(cwd, cadProjectId);
  const inspection = inspectProjectSources(cwd, registry);
  return {
    registry,
    descriptor: inspection.descriptor,
    files: inspection.sources,
    references: inspection.references,
    total_bytes: inspection.total_bytes,
    source_sha256: sha256Json(inspection.sources),
    builds: listCadBuilds(cwd, { cadProjectId }),
    simulations: listCadSimulations(cwd, { cadProjectId }),
    slices: listCadSlices(cwd, { cadProjectId })
  };
}

export function readCadFile({ cwd, cadProjectId, file }) {
  const { registry } = loadRegistry(cwd, cadProjectId);
  const { root, descriptor } = loadDescriptor(cwd, registry);
  const relative = normalizeRelativeCadPath(file);
  if (!descriptor.files.includes(relative)) throw cadError('CAD file is not declared: ' + relative, 'UNDECLARED_CAD_REFERENCE');
  if (!TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())) throw cadError('Binary CAD files cannot be opened in the text editor.', 'BINARY_CAD_FILE');
  const { target, stat } = assertRegularInside(root, relative);
  const content = fs.readFileSync(target, 'utf8');
  return {
    cad_project_id: cadProjectId, file: relative, content, bytes: stat.size,
    sha256: sha256Text(content), editable: EDITABLE_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())
  };
}

export function writeCadFile({ cwd, cadProjectId, file, content, expectedSha256, actor = 'user', now = new Date() }) {
  const project = path.resolve(cwd);
  const { registry } = loadRegistry(project, cadProjectId);
  const { root, descriptor } = loadDescriptor(project, registry);
  const relative = normalizeRelativeCadPath(file);
  if (!descriptor.files.includes(relative)) throw cadError('CAD file is not declared: ' + relative, 'UNDECLARED_CAD_REFERENCE');
  const extension = path.posix.extname(relative).toLowerCase();
  if (!EDITABLE_EXTENSIONS.has(extension)) throw cadError('Only OpenSCAD and CadQuery Python sources are editable through this API.', 'CAD_FILE_READ_ONLY');
  if (typeof content !== 'string') throw cadError('CAD source content must be text.');
  if (Buffer.byteLength(content) > MAX_CAD_FILE_BYTES) throw cadError('CAD source exceeds the per-file size limit.', 'CAD_SOURCE_TOO_LARGE');
  const findings = scanSecrets(content);
  if (findings.length) throw cadError('Potential secret detected in CAD source.', 'SECRET_DETECTED', { findings });
  if (extension === '.scad') inspectScadReferences(relative, content, new Set(descriptor.files));
  const { target } = assertRegularInside(root, relative);
  const before = fs.readFileSync(target, 'utf8');
  const beforeSha = sha256Text(before);
  if (expectedSha256 !== undefined && expectedSha256 !== null) {
    if (!SHA256_PATTERN.test(String(expectedSha256)) || expectedSha256 !== beforeSha) {
      throw cadError('CAD file changed since it was opened. Reload before saving.', 'CAD_EDIT_CONFLICT', { expected_sha256: expectedSha256, actual_sha256: beforeSha });
    }
  }
  const afterSha = sha256Text(content);
  if (afterSha === beforeSha) return { changed: false, ...readCadFile({ cwd: project, cadProjectId, file: relative }) };
  const revisionId = makeRecordId('cad-revision', now);
  const revisionDir = path.join(project, INTERNAL_DIR, 'cad-revisions', revisionId);
  ensureScienceDir(project);
  fs.mkdirSync(revisionDir, { recursive: false, mode: 0o700 });
  const beforeArtifact = 'before' + extension;
  const afterArtifact = 'after' + extension;
  writeTextExclusive(path.join(revisionDir, beforeArtifact), before);
  writeTextExclusive(path.join(revisionDir, afterArtifact), content);
  const revision = {
    schema_version: CAD_REVISION_SCHEMA_VERSION,
    revision_id: revisionId,
    cad_project_id: cadProjectId,
    created_at: now.toISOString(),
    actor: label(actor, 'CAD edit actor', { maximum: 80 }),
    file: relative,
    before_sha256: beforeSha,
    after_sha256: afterSha,
    artifacts: {
      [beforeArtifact]: { bytes: Buffer.byteLength(before), sha256: beforeSha },
      [afterArtifact]: { bytes: Buffer.byteLength(content), sha256: afterSha }
    }
  };
  writeJsonExclusive(path.join(revisionDir, 'manifest.json'), revision);
  const temporary = target + '.sciencecode-' + crypto.randomBytes(4).toString('hex') + '.tmp';
  writeTextExclusive(temporary, content);
  try { fs.renameSync(temporary, target); } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* temporary file may already be moved */ }
    throw error;
  }
  const audit = appendAudit(project, {
    type: 'cad.file.revised', revision_id: revisionId, cad_project_id: cadProjectId,
    file: relative, before_sha256: beforeSha, after_sha256: afterSha
  });
  return { changed: true, revision, audit, ...readCadFile({ cwd: project, cadProjectId, file: relative }) };
}

function copySourcesToSnapshot(inspection, destination) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const source of inspection.sources) {
    const input = resolvePortableSnapshotPath(inspection.root, source.path);
    const output = resolvePortableSnapshotPath(destination, source.path);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.copyFileSync(input, output, fs.constants.COPYFILE_EXCL);
  }
  writeJsonExclusive(path.join(destination, 'sciencecode.cad.json'), inspection.descriptor);
}

function executableCandidate(value) {
  if (!value) return null;
  const resolved = findExecutable(value);
  if (resolved) return resolved;
  try { return fs.statSync(value).isFile() ? path.resolve(value) : null; } catch { return null; }
}

function firstExecutable(candidates) {
  for (const candidate of candidates) {
    const executable = executableCandidate(candidate);
    if (executable) return executable;
  }
  return null;
}

function toolVersion(executable, runner = runCommandSync) {
  if (!executable) return null;
  const result = runner(executable, ['--version'], { timeout: 15_000, windowsHide: true });
  return redactText(String(result.stdout ?? '') + String(result.stderr ?? '')).trim().split(/\r?\n/)[0] || null;
}

export function detectCadToolchain({ env = process.env, runner = runCommandSync } = {}) {
  const openscad = firstExecutable([
    env.SCIENCECODE_OPENSCAD,
    'openscad.com',
    'openscad',
    process.platform === 'win32' ? 'C:\\Program Files\\OpenSCAD (Nightly)\\openscad.com' : null,
    process.platform === 'win32' ? 'C:\\Program Files\\OpenSCAD\\openscad.com' : null
  ]);
  const prusa = firstExecutable([
    env.SCIENCECODE_PRUSA_SLICER,
    'prusa-slicer-console.exe',
    'prusa-slicer',
    process.platform === 'win32' ? 'C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe' : null
  ]);
  const cadRuntime = probeCadRuntime({ env, runner });
  return {
    openscad: { available: Boolean(openscad), path: openscad, version: toolVersion(openscad, runner) },
    cadquery: {
      available: cadRuntime.healthy,
      path: cadRuntime.healthy ? cadRuntime.paths.python : null,
      adapter: cadRuntime.healthy ? cadRuntime.paths.adapter : null,
      version: cadRuntime.probe?.cadquery_version ?? null,
      ocp_version: cadRuntime.probe?.cadquery_ocp_version ?? null,
      runtime_manifest_sha256: cadRuntime.manifest_sha256 ?? null,
      runtime_home: cadRuntime.paths?.home ?? null,
      error: cadRuntime.error ?? null
    },
    slicer: { available: Boolean(prusa), engine: prusa ? 'PrusaSlicer' : null, path: prusa, version: toolVersion(prusa, runner) },
    policies: {
      printer_transmission: 'disabled',
      slicer_post_process: 'disabled',
      python_os_sandbox: 'not_provided'
    }
  };
}

function parseCadQueryResult(value) {
  const prefix = 'SCIENCECODE_CADQUERY_RESULT_JSON=';
  const lines = String(value ?? '').trim().split(/\r?\n/).reverse();
  const tagged = lines.find((line) => line.startsWith(prefix));
  if (!tagged) throw cadError('CadQuery adapter did not return a result record.', 'INVALID_CADQUERY_RESULT');
  try { return JSON.parse(tagged.slice(prefix.length)); } catch (error) {
    throw cadError('CadQuery adapter returned invalid JSON: ' + error.message, 'INVALID_CADQUERY_RESULT');
  }
}

function cadPythonEnvironment(env, runtimeHome) {
  const output = { ...env };
  for (const name of ['PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'CONDA_PREFIX']) delete output[name];
  output.PYTHONUTF8 = '1';
  output.PYTHONDONTWRITEBYTECODE = '1';
  if (runtimeHome) output.SCIENCECODE_HOME = path.resolve(runtimeHome);
  return output;
}

function walkArtifacts(root, excluded = new Set(['manifest.json'])) {
  const artifacts = {};
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = relativePortable(root, absolute);
      seen += 1;
      if (seen > MAX_CAD_RECORD_FILES) throw cadError('CAD record contains too many files.', 'CAD_RECORD_LIMIT');
      if (entry.isSymbolicLink()) throw cadError('CAD records may not contain symbolic links.', 'INVALID_CAD_RECORD');
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && !excluded.has(relative)) {
        const stat = fs.statSync(absolute);
        artifacts[relative] = { bytes: stat.size, sha256: sha256File(absolute) };
      }
    }
  }
  return Object.fromEntries(Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right)));
}

function compareArtifactMaps(before, after) {
  const differences = [];
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const name of names) {
    if (!before[name]) differences.push({ file: name, issue: 'added_during_execution' });
    else if (!after[name]) differences.push({ file: name, issue: 'removed_during_execution' });
    else if (before[name].sha256 !== after[name].sha256 || before[name].bytes !== after[name].bytes) {
      differences.push({
        file: name, issue: 'modified_during_execution',
        before: before[name], after: after[name]
      });
    }
  }
  return {
    ok: differences.length === 0,
    before_sha256: sha256Json(before),
    after_sha256: sha256Json(after),
    differences
  };
}

function safeToolOutput(result, extra = {}) {
  return {
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    aborted: Boolean(result?.aborted),
    error: result?.error ? { code: result.error.code ?? null, message: redactText(result.error.message) } : null,
    stdout: redactText(String(result?.stdout ?? '')).slice(0, 2_000_000),
    stderr: redactText(String(result?.stderr ?? '')).slice(0, 2_000_000),
    ...extra
  };
}

function loadRecord(cwd, directoryName, id, expectedPrefix) {
  if (!RECORD_ID_PATTERN.test(String(id ?? '')) || !String(id).startsWith(expectedPrefix + '-')) {
    throw cadError('Invalid CAD record ID: ' + String(id ?? ''), 'INVALID_CAD_RECORD_ID');
  }
  const directory = path.join(path.resolve(cwd), INTERNAL_DIR, directoryName, id);
  const file = path.join(directory, 'manifest.json');
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw cadError('CAD record not found: ' + id, 'CAD_RECORD_NOT_FOUND');
  return { directory, manifest: readJson(file), file };
}

export function buildCadProject({ cwd, cadProjectId, timeoutMs = 300_000, now = new Date(), runner = runCommandSync, toolchain, env = process.env }) {
  const project = path.resolve(cwd);
  const timeout = Math.trunc(boundedNumber(timeoutMs, 'CAD build timeout', 1_000, MAX_CAD_BUILD_TIMEOUT_MS));
  const { registry } = loadRegistry(project, cadProjectId);
  const inspection = inspectProjectSources(project, registry);
  const tools = toolchain ?? detectCadToolchain({ env, runner });
  const engine = inspection.descriptor.engine;
  if (engine === 'openscad' && (!tools.openscad?.available || !tools.openscad.path)) {
    throw cadError('OpenSCAD is not available. Install it or set SCIENCECODE_OPENSCAD.', 'OPENSCAD_NOT_FOUND');
  }
  if (engine === 'cadquery' && (!tools.cadquery?.available || !tools.cadquery.path || !tools.cadquery.adapter)) {
    throw cadError('The isolated CadQuery runtime is not ready. Run sciencecode compute setup --profile cad.', 'CADQUERY_RUNTIME_NOT_FOUND');
  }
  ensureScienceDir(project);
  const buildId = makeRecordId('cad-build', now);
  const directory = path.join(project, INTERNAL_DIR, 'cad-builds', buildId);
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  const sourceDirectory = path.join(directory, 'source');
  copySourcesToSnapshot(inspection, sourceDirectory);
  const sourceSnapshotBefore = walkArtifacts(sourceDirectory, new Set());
  const outputFile = path.join(directory, 'assembly.stl');
  const entryFile = resolvePortableSnapshotPath(sourceDirectory, inspection.descriptor.entry);
  const summaryFile = path.join(directory, 'openscad-summary.json');
  const stepFile = path.join(directory, 'assembly.step');
  const parametersFile = path.join(directory, 'cadquery-parameters.json');
  let executable;
  let args;
  let commandEnvironment;
  if (engine === 'openscad') {
    executable = tools.openscad.path;
    args = [
      '--backend=Manifold', '--hardwarnings', '--export-format=asciistl',
      '--summary=all', '--summary-file', summaryFile, '-o', outputFile, entryFile
    ];
    commandEnvironment = { ...env, OPENSCADPATH: sourceDirectory };
  } else {
    executable = tools.cadquery.path;
    writeJsonExclusive(parametersFile, inspection.descriptor.parameters);
    args = [
      '-I', '-B', tools.cadquery.adapter, 'build',
      '--source-root', sourceDirectory,
      '--output-root', directory,
      '--entry', inspection.descriptor.entry,
      '--stl', outputFile,
      '--step', stepFile,
      '--parameters-file', parametersFile,
      '--linear-tolerance', String(inspection.descriptor.tessellation.linear_tolerance_mm),
      '--angular-tolerance', String(inspection.descriptor.tessellation.angular_tolerance_rad)
    ];
    commandEnvironment = cadPythonEnvironment(env, tools.cadquery.runtime_home);
  }
  const started = appendAudit(project, {
    type: 'cad.build.started', build_id: buildId, cad_project_id: cadProjectId,
    source_sha256: sha256Json(inspection.sources), engine,
    tool: engine === 'openscad' ? 'OpenSCAD' : 'CadQuery'
  });
  const result = runner(executable, args, {
    cwd: sourceDirectory,
    env: commandEnvironment,
    timeout,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  let mesh = null;
  let openscadSummary = null;
  let cadqueryReport = null;
  let failure = null;
  if (engine === 'openscad' && fs.statSync(summaryFile, { throwIfNoEntry: false })?.isFile()) {
    try { openscadSummary = readJson(summaryFile); } catch (error) { failure = { code: 'INVALID_OPENSCAD_SUMMARY', message: error.message }; }
  }
  if (engine === 'cadquery') {
    try {
      cadqueryReport = parseCadQueryResult(result.stdout);
      if (cadqueryReport.ok !== true) {
        failure = { code: 'CADQUERY_BUILD_FAILED', message: cadqueryReport.error ?? 'CadQuery adapter reported failure.' };
      }
    } catch (error) {
      failure = { code: error.code ?? 'INVALID_CADQUERY_RESULT', message: error.message };
    }
  }
  const outputExists = fs.statSync(outputFile, { throwIfNoEntry: false })?.isFile();
  const interchangeExists = engine !== 'cadquery' || fs.statSync(stepFile, { throwIfNoEntry: false })?.isFile();
  if (result.error || result.status !== 0 || !outputExists || !interchangeExists) {
    failure = {
      code: result.error?.code ?? (result.status === 0
        ? (engine === 'cadquery' ? 'CADQUERY_OUTPUT_MISSING' : 'OPENSCAD_OUTPUT_MISSING')
        : (engine === 'cadquery' ? 'CADQUERY_BUILD_FAILED' : 'OPENSCAD_FAILED')),
      message: result.error?.message ?? ((engine === 'cadquery' ? 'CadQuery' : 'OpenSCAD') +
        ' exited with status ' + String(result.status) + '.')
    };
  }
  if (!failure && outputExists) {
    try { mesh = analyzeAsciiStl(fs.readFileSync(outputFile, 'utf8')); } catch (error) {
      failure = { code: error.code ?? 'INVALID_MESH', message: error.message };
    }
  }
  let sourceSnapshotIntegrity;
  try {
    sourceSnapshotIntegrity = compareArtifactMaps(
      sourceSnapshotBefore, walkArtifacts(sourceDirectory, new Set())
    );
  } catch (error) {
    sourceSnapshotIntegrity = {
      ok: false,
      before_sha256: sha256Json(sourceSnapshotBefore),
      after_sha256: null,
      differences: [{ issue: error.code ?? 'snapshot_inspection_failed', detail: error.message }]
    };
  }
  if (!sourceSnapshotIntegrity.ok) {
    failure = {
      code: 'CAD_SOURCE_SNAPSHOT_MUTATED',
      message: 'The CAD engine changed the immutable source snapshot during execution.',
      previous_failure: failure
    };
  }
  const activeTool = engine === 'cadquery' ? tools.cadquery : tools.openscad;
  const toolOutput = safeToolOutput(result, {
    engine,
    executable,
    version: activeTool.version,
    arguments: args.map((arg) => path.isAbsolute(arg) ? path.basename(arg) : arg)
  });
  writeJsonExclusive(path.join(directory, 'tool-output.json'), toolOutput);
  writeJsonExclusive(path.join(directory, 'source-snapshot-integrity.json'), sourceSnapshotIntegrity);
  if (mesh) writeJsonExclusive(path.join(directory, 'mesh-report.json'), mesh);
  if (cadqueryReport) writeJsonExclusive(path.join(directory, 'cadquery-report.json'), cadqueryReport);
  const finishedAt = new Date();
  const manifest = {
    schema_version: CAD_BUILD_SCHEMA_VERSION,
    engine_version: CAD_ENGINE_VERSION,
    sciencecode_version: VERSION,
    build_id: buildId,
    cad_project_id: cadProjectId,
    created_at: now.toISOString(),
    finished_at: finishedAt.toISOString(),
    status: !failure && mesh ? 'completed' : 'failed',
    failure,
    engine,
    source_sha256: sha256Json(inspection.sources),
    descriptor_sha256: registry.descriptor_sha256,
    source_files: inspection.sources,
    source_references: inspection.references,
    entry: inspection.descriptor.entry,
    toolchain: engine === 'cadquery' ? { cadquery: tools.cadquery } : { openscad: tools.openscad },
    mesh,
    openscad_summary: openscadSummary,
    cadquery_report: cadqueryReport,
    source_snapshot_integrity: sourceSnapshotIntegrity,
    interchange_artifact: engine === 'cadquery' ? 'assembly.step' : null,
    policy: inspection.descriptor.execution_policy,
    started_audit_hash: started.hash,
    artifacts: walkArtifacts(directory)
  };
  writeJsonExclusive(path.join(directory, 'manifest.json'), manifest);
  const manifestSha = sha256File(path.join(directory, 'manifest.json'));
  const finished = appendAudit(project, {
    type: 'cad.build.finished', build_id: buildId, cad_project_id: cadProjectId,
    status: manifest.status, engine, manifest_sha256: manifestSha,
    mesh_sha256: manifest.artifacts['assembly.stl']?.sha256 ?? null,
    interchange_sha256: manifest.artifacts['assembly.step']?.sha256 ?? null
  });
  return { directory, manifest, manifest_sha256: manifestSha, audit: { started, finished }, verification: verifyCadBuild(project, buildId) };
}

export function listCadBuilds(cwd, options = {}) { return listRecords(cwd, 'cad-builds', 'cad-build', options); }
export function getCadBuild(cwd, buildId) { return loadRecord(cwd, 'cad-builds', buildId, 'cad-build'); }

function verifyArtifacts(directory, manifest) {
  const errors = [];
  let actual = {};
  try { actual = walkArtifacts(directory); } catch (error) { errors.push({ issue: error.code ?? 'artifact_error', detail: error.message }); }
  const expected = manifest.artifacts ?? {};
  for (const [relative, record] of Object.entries(expected)) {
    const observed = actual[relative];
    if (!observed) errors.push({ file: relative, issue: 'missing' });
    else {
      if (observed.sha256 !== record.sha256) errors.push({ file: relative, issue: 'hash_mismatch', expected: record.sha256, actual: observed.sha256 });
      if (observed.bytes !== record.bytes) errors.push({ file: relative, issue: 'size_mismatch', expected: record.bytes, actual: observed.bytes });
    }
  }
  for (const relative of Object.keys(actual)) if (!expected[relative]) errors.push({ file: relative, issue: 'unexpected' });
  return errors;
}

function verifyCadRecord(cwd, directoryName, id, prefix, schemaVersion, finishedEvent) {
  const project = path.resolve(cwd);
  let record;
  try { record = loadRecord(project, directoryName, id, prefix); } catch (error) {
    return { ok: false, id, errors: [{ issue: error.code ?? 'record_error', detail: error.message }] };
  }
  const errors = [];
  if (record.manifest.schema_version !== schemaVersion) errors.push({ issue: 'unsupported_schema' });
  const idField = prefix === 'cad-sim'
    ? 'simulation_id'
    : prefix.replace('cad-', '') + '_id';
  if (record.manifest[idField] !== id) errors.push({ issue: 'id_mismatch', expected: id, actual: record.manifest[idField] });
  errors.push(...verifyArtifacts(record.directory, record.manifest));
  const auditVerification = verifyAudit(project);
  if (!auditVerification.ok) errors.push({ issue: 'audit_invalid', errors: auditVerification.errors });
  else {
    const manifestSha = sha256File(record.file);
    const linked = readAuditRecords(project).some((item) => item.type === finishedEvent && item[idField] === id && item.manifest_sha256 === manifestSha);
    if (!linked) errors.push({ issue: 'audit_link_missing' });
  }
  return {
    ok: errors.length === 0,
    id,
    manifest: record.manifest,
    manifest_sha256: sha256File(record.file),
    errors
  };
}

export function verifyCadBuild(cwd, buildId) {
  return verifyCadRecord(cwd, 'cad-builds', buildId, 'cad-build', CAD_BUILD_SCHEMA_VERSION, 'cad.build.finished');
}

export function simulateCadBuild({ cwd, buildId, densityGcm3, maximumSevereOverhangFraction = 0.15, now = new Date() }) {
  const project = path.resolve(cwd);
  const buildVerification = verifyCadBuild(project, buildId);
  if (!buildVerification.ok) throw cadError('CAD build integrity verification failed.', 'CAD_BUILD_INVALID', { errors: buildVerification.errors });
  const build = buildVerification.manifest;
  if (build.status !== 'completed' || !build.mesh) throw cadError('Only a completed CAD build can be simulated.', 'CAD_BUILD_NOT_COMPLETED');
  const { registry } = loadRegistry(project, build.cad_project_id);
  const density = boundedNumber(densityGcm3 ?? registry.descriptor.simulation.density_g_cm3, 'Material density', 0.000001, 100);
  const threshold = boundedNumber(maximumSevereOverhangFraction, 'Maximum severe overhang fraction', 0, 1);
  const geometry = build.mesh.geometry;
  const size = geometry.bounding_box.size;
  const buildVolume = registry.descriptor.build_volume_mm;
  const fits = size.every((item, index) => item <= buildVolume[index] + 1e-9);
  const topologyPass = build.mesh.topology.watertight && build.mesh.topology.nonmanifold_edges === 0 && build.mesh.topology.degenerate_triangles === 0;
  const overhangPass = (build.mesh.printability_indicators.severe_overhang_area_fraction ?? 1) <= threshold;
  const mass = geometry.volume_mm3 * density / 1_000;
  const verdict = !topologyPass || !fits ? 'fail' : overhangPass ? 'pass' : 'review';
  const report = {
    engine: 'deterministic-mesh-screen',
    engine_version: CAD_ENGINE_VERSION,
    classification: 'geometry_and_printability_screen',
    verdict,
    inputs: {
      build_id: buildId,
      mesh_sha256: build.artifacts['assembly.stl']?.sha256 ?? null,
      density_g_cm3: density,
      build_volume_mm: buildVolume,
      maximum_severe_overhang_fraction: threshold,
      gravity_m_s2: registry.descriptor.simulation.gravity_m_s2
    },
    outputs: {
      volume_mm3: geometry.volume_mm3,
      surface_area_mm2: geometry.surface_area_mm2,
      estimated_mass_g: Number(mass.toFixed(6)),
      centroid_mm: geometry.centroid_mm,
      bounding_box_mm: geometry.bounding_box,
      topology_pass: topologyPass,
      build_volume_dimension_fit: fits,
      overhang_screen_pass: overhangPass,
      severe_overhang_area_fraction: build.mesh.printability_indicators.severe_overhang_area_fraction
    },
    limitations: [
      'This is a deterministic geometry and printability screen, not finite-element analysis or a dynamic physics simulation.',
      'Build-volume fit compares axis dimensions only; it does not select printer placement or validate reachable motion.',
      'Estimated mass assumes uniform density and a closed mesh.',
      'No structural, stress, strain, thermal, fluid, fatigue, tolerance, collision, support, material, or printer safety claim is made.'
    ]
  };
  ensureScienceDir(project);
  const simulationId = makeRecordId('cad-sim', now);
  const directory = path.join(project, INTERNAL_DIR, 'cad-simulations', simulationId);
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  writeJsonExclusive(path.join(directory, 'report.json'), report);
  const manifest = {
    schema_version: CAD_SIMULATION_SCHEMA_VERSION,
    simulation_id: simulationId,
    cad_project_id: build.cad_project_id,
    build_id: buildId,
    created_at: now.toISOString(),
    status: verdict,
    parent_build_manifest_sha256: sha256File(path.join(project, INTERNAL_DIR, 'cad-builds', buildId, 'manifest.json')),
    report,
    artifacts: walkArtifacts(directory)
  };
  writeJsonExclusive(path.join(directory, 'manifest.json'), manifest);
  const manifestSha = sha256File(path.join(directory, 'manifest.json'));
  const audit = appendAudit(project, {
    type: 'cad.simulation.finished', simulation_id: simulationId, cad_project_id: build.cad_project_id,
    build_id: buildId, status: verdict, manifest_sha256: manifestSha
  });
  return { directory, manifest, manifest_sha256: manifestSha, audit, verification: verifyCadSimulation(project, simulationId) };
}

export function listCadSimulations(cwd, options = {}) { return listRecords(cwd, 'cad-simulations', 'cad-sim', options); }
export function getCadSimulation(cwd, simulationId) { return loadRecord(cwd, 'cad-simulations', simulationId, 'cad-sim'); }
export function verifyCadSimulation(cwd, simulationId) {
  return verifyCadRecord(cwd, 'cad-simulations', simulationId, 'cad-sim', CAD_SIMULATION_SCHEMA_VERSION, 'cad.simulation.finished');
}

function validateSlicerProfile(cwd, profilePath) {
  const project = path.resolve(cwd);
  const relative = normalizeProfilePath(profilePath);
  const target = resolvePortableSnapshotPath(project, relative);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
    throw cadError('Slicer profile must be a regular project file no larger than 2 MiB.', 'INVALID_SLICER_PROFILE');
  }
  const realProject = fs.realpathSync(project);
  if (!isPathInside(realProject, fs.realpathSync(target))) throw cadError('Slicer profile escapes the project.', 'INVALID_SLICER_PROFILE');
  const content = fs.readFileSync(target, 'utf8');
  const findings = scanSecrets(content);
  if (findings.length) throw cadError('Potential secret detected in slicer profile.', 'SECRET_DETECTED', { findings });
  const postProcess = content.split(/\r?\n/).map((line) => line.match(/^\s*post_process\s*=\s*(.*?)\s*$/i)?.[1]).find((value) => value !== undefined);
  if (postProcess && postProcess.trim()) throw cadError('Slicer post-processing hooks are disabled.', 'SLICER_POST_PROCESS_DISABLED');
  return { relative, target, content, sha256: sha256Text(content), bytes: stat.size };
}

function normalizeProfilePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw cadError('A project-relative slicer profile path is required.', 'INVALID_SLICER_PROFILE');
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').some((item) => !item || item === '.' || item === '..')) {
    throw cadError('Slicer profile must be project-relative.', 'INVALID_SLICER_PROFILE');
  }
  if (!['.ini', '.config'].includes(path.posix.extname(normalized).toLowerCase())) throw cadError('Slicer profile must use .ini or .config.', 'INVALID_SLICER_PROFILE');
  return normalized;
}

function previewSliceArguments(output, input, settings) {
  const layer = boundedNumber(settings.layer_height_mm ?? 0.2, 'Layer height', 0.01, 2);
  const nozzle = boundedNumber(settings.nozzle_diameter_mm ?? 0.4, 'Nozzle diameter', 0.05, 5);
  const filament = boundedNumber(settings.filament_diameter_mm ?? 1.75, 'Filament diameter', 0.1, 10);
  const infill = boundedNumber(settings.infill_percent ?? 15, 'Infill percent', 0, 100);
  const threads = Math.trunc(boundedNumber(settings.threads ?? 2, 'Slicer threads', 1, 8));
  return [
    '--export-gcode', '--output', output, '--gcode-flavor=no-extrusion',
    '--temperature=0', '--first-layer-temperature=0', '--bed-temperature=0', '--first-layer-bed-temperature=0',
    '--start-gcode=; ScienceCode preview only - not printer approved',
    '--end-gcode=; ScienceCode preview end',
    '--layer-height=' + layer, '--first-layer-height=' + layer,
    '--nozzle-diameter=' + nozzle, '--filament-diameter=' + filament,
    '--fill-density=' + infill + '%', '--threads=' + threads, input
  ];
}

export function sliceCadBuild({
  cwd, buildId, mode = 'preview', profilePath, acknowledgePhysicalRisk = false,
  settings = {}, timeoutMs = 300_000, now = new Date(), runner = runCommandSync,
  toolchain, env = process.env
}) {
  const project = path.resolve(cwd);
  if (!['preview', 'printer-profile'].includes(mode)) throw cadError('Slice mode must be preview or printer-profile.', 'INVALID_SLICE_MODE');
  if (!plainObject(settings)) throw cadError('Slice settings must be an object.');
  const timeout = Math.trunc(boundedNumber(timeoutMs, 'Slice timeout', 1_000, MAX_CAD_SLICE_TIMEOUT_MS));
  const buildVerification = verifyCadBuild(project, buildId);
  if (!buildVerification.ok) throw cadError('CAD build integrity verification failed.', 'CAD_BUILD_INVALID', { errors: buildVerification.errors });
  const build = buildVerification.manifest;
  if (build.status !== 'completed') throw cadError('Only completed CAD builds can be sliced.', 'CAD_BUILD_NOT_COMPLETED');
  let profile = null;
  if (mode === 'printer-profile') {
    if (acknowledgePhysicalRisk !== true) throw cadError('Printer-profile slicing requires acknowledgePhysicalRisk=true.', 'PHYSICAL_RISK_ACK_REQUIRED');
    profile = validateSlicerProfile(project, profilePath);
  }
  const tools = toolchain ?? detectCadToolchain({ env, runner });
  if (!tools.slicer?.available || !tools.slicer.path) throw cadError('PrusaSlicer console is not available. Install it or set SCIENCECODE_PRUSA_SLICER.', 'SLICER_NOT_FOUND');
  ensureScienceDir(project);
  const sliceId = makeRecordId('cad-slice', now);
  const directory = path.join(project, INTERNAL_DIR, 'cad-slices', sliceId);
  const inputDirectory = path.join(directory, 'input');
  fs.mkdirSync(inputDirectory, { recursive: true, mode: 0o700 });
  const input = path.join(inputDirectory, 'assembly.stl');
  fs.copyFileSync(path.join(project, INTERNAL_DIR, 'cad-builds', buildId, 'assembly.stl'), input, fs.constants.COPYFILE_EXCL);
  let profileSnapshot = null;
  if (profile) {
    profileSnapshot = path.join(inputDirectory, 'printer-profile.ini');
    fs.copyFileSync(profile.target, profileSnapshot, fs.constants.COPYFILE_EXCL);
  }
  const output = path.join(directory, 'preview.gcode');
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-prusa-'));
  let args;
  if (mode === 'preview') args = ['--datadir', dataDirectory, ...previewSliceArguments(output, input, settings)];
  else args = ['--datadir', dataDirectory, '--load', profileSnapshot, '--export-gcode', '--output', output, input];
  let result;
  try {
    result = runner(tools.slicer.path, args, { cwd: directory, env, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  } finally {
    const resolvedTemp = path.resolve(dataDirectory);
    const tempRoot = path.resolve(os.tmpdir());
    if (isPathInside(tempRoot, resolvedTemp) && path.basename(resolvedTemp).startsWith('sciencecode-prusa-')) {
      try { fs.rmSync(resolvedTemp, { recursive: true, force: true }); } catch { /* isolated slicer cache is non-record state */ }
    }
  }
  let analysis = null;
  let failure = null;
  if (!result.error && result.status === 0 && fs.statSync(output, { throwIfNoEntry: false })?.isFile()) {
    try {
      analysis = analyzeGcode(fs.readFileSync(output, 'utf8'));
      if (mode === 'preview' && !analysis.preview_only_invariants.pass) {
        failure = { code: 'PREVIEW_SAFETY_CHECK_FAILED', message: 'Generated preview contains physical-control commands.' };
      }
    } catch (error) { failure = { code: error.code ?? 'INVALID_GCODE', message: error.message }; }
  } else {
    failure = {
      code: result.error?.code ?? (result.status === 0 ? 'SLICER_OUTPUT_MISSING' : 'SLICER_FAILED'),
      message: result.error?.message ?? ('Slicer exited with status ' + String(result.status) + '.')
    };
  }
  writeJsonExclusive(path.join(directory, 'tool-output.json'), safeToolOutput(result, {
    executable: tools.slicer.path, version: tools.slicer.version,
    arguments: args.map((arg) => path.isAbsolute(arg) ? path.basename(arg) : arg)
  }));
  if (analysis) writeJsonExclusive(path.join(directory, 'gcode-report.json'), analysis);
  const manifest = {
    schema_version: CAD_SLICE_SCHEMA_VERSION,
    engine_version: CAD_ENGINE_VERSION,
    slice_id: sliceId,
    cad_project_id: build.cad_project_id,
    build_id: buildId,
    created_at: now.toISOString(),
    status: failure ? 'failed' : mode === 'preview' ? 'completed_preview' : 'completed_requires_physical_review',
    failure,
    mode,
    acknowledge_physical_risk: mode === 'printer-profile',
    printer_transmission: 'disabled',
    post_process: 'disabled',
    parent_build_manifest_sha256: sha256File(path.join(project, INTERNAL_DIR, 'cad-builds', buildId, 'manifest.json')),
    profile: profile ? { project_path: profile.relative, bytes: profile.bytes, sha256: profile.sha256 } : null,
    settings: mode === 'preview' ? safeJsonValue(settings, 'settings') : null,
    toolchain: { slicer: tools.slicer },
    analysis,
    warning: 'G-code is physical machine-control data. ScienceCode does not transmit it or establish printer, material, motion, thermal, or operator safety.',
    artifacts: walkArtifacts(directory)
  };
  writeJsonExclusive(path.join(directory, 'manifest.json'), manifest);
  const manifestSha = sha256File(path.join(directory, 'manifest.json'));
  const audit = appendAudit(project, {
    type: 'cad.slice.finished', slice_id: sliceId, cad_project_id: build.cad_project_id,
    build_id: buildId, mode, status: manifest.status, manifest_sha256: manifestSha,
    printer_transmission: 'disabled'
  });
  return { directory, manifest, manifest_sha256: manifestSha, audit, verification: verifyCadSlice(project, sliceId) };
}

export function listCadSlices(cwd, options = {}) { return listRecords(cwd, 'cad-slices', 'cad-slice', options); }
export function getCadSlice(cwd, sliceId) { return loadRecord(cwd, 'cad-slices', sliceId, 'cad-slice'); }
export function verifyCadSlice(cwd, sliceId) {
  return verifyCadRecord(cwd, 'cad-slices', sliceId, 'cad-slice', CAD_SLICE_SCHEMA_VERSION, 'cad.slice.finished');
}

export function resolveCadArtifact(cwd, { kind, id, file }) {
  const mapping = {
    build: ['cad-builds', 'cad-build'],
    simulation: ['cad-simulations', 'cad-sim'],
    slice: ['cad-slices', 'cad-slice']
  };
  if (!mapping[kind]) throw cadError('Unsupported CAD artifact kind.', 'INVALID_CAD_ARTIFACT');
  const record = loadRecord(cwd, mapping[kind][0], id, mapping[kind][1]);
  const relative = String(file ?? '').replace(/\\/g, '/');
  if (!record.manifest.artifacts?.[relative]) throw cadError('CAD artifact is not declared by the record: ' + relative, 'CAD_ARTIFACT_NOT_FOUND');
  const target = resolvePortableSnapshotPath(record.directory, relative);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || sha256File(target) !== record.manifest.artifacts[relative].sha256) {
    throw cadError('CAD artifact failed integrity verification.', 'CAD_ARTIFACT_INVALID');
  }
  return target;
}

export function cadInteractionArtifact(cadProjectId, name, url = null) {
  return { kind: 'cad-project', record_id: cadProjectId, name, url };
}

export function cadInteractionPayload(value = {}) {
  if (!plainObject(value)) throw cadError('CAD interaction payload must be an object.');
  return safeJsonValue(value, 'CAD interaction payload');
}
