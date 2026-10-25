const MAX_STL_BYTES = 128 * 1024 * 1024;
const MAX_GCODE_BYTES = 128 * 1024 * 1024;
const MAX_TRIANGLES = 2_000_000;
const COORDINATE_LIMIT = 1_000_000_000;

function meshError(message, code = 'INVALID_MESH') {
  return Object.assign(new Error(message), { code });
}

function finiteVector(values) {
  return values.length === 3 && values.every((value) =>
    Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT);
}

function subtract(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function vertexKey(vertex) {
  return vertex.map((value) => {
    const normalized = Math.abs(value) < 5e-10 ? 0 : value;
    return normalized.toPrecision(12);
  }).join(',');
}

function edgeKey(left, right) {
  const a = vertexKey(left);
  const b = vertexKey(right);
  return a < b ? a + '|' + b : b + '|' + a;
}

function number(value, digits = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function analyzeAsciiStl(value, { maximumBytes = MAX_STL_BYTES } = {}) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text) > maximumBytes) {
    throw meshError('ASCII STL exceeds the ' + maximumBytes + ' byte analysis limit.',
      'MESH_TOO_LARGE');
  }
  if (!/^\s*solid(?:\s|$)/i.test(text)) {
    throw meshError('ScienceCode mesh analysis currently requires an ASCII STL.',
      'UNSUPPORTED_MESH_ENCODING');
  }
  const vertexPattern = /^\s*vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*$/i;
  const vertices = [];
  const edges = new Map();
  const facets = new Set();
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
  let triangles = 0;
  let degenerateTriangles = 0;
  let duplicateTriangles = 0;
  let surfaceArea = 0;
  let signedVolume = 0;
  let centroidX = 0;
  let centroidY = 0;
  let centroidZ = 0;
  let severeOverhangArea = 0;
  let downwardArea = 0;
  const flushTriangle = () => {
    if (vertices.length !== 3) return;
    const [a, b, c] = vertices.splice(0, 3);
    triangles += 1;
    if (triangles > MAX_TRIANGLES) {
      throw meshError('STL exceeds the ' + MAX_TRIANGLES + ' triangle analysis limit.',
        'MESH_TOO_COMPLEX');
    }
    const ab = subtract(b, a);
    const ac = subtract(c, a);
    const normal = cross(ab, ac);
    const twiceArea = Math.hypot(...normal);
    const area = twiceArea / 2;
    if (area <= 1e-12) degenerateTriangles += 1;
    surfaceArea += area;
    const normalZ = twiceArea > 0 ? normal[2] / twiceArea : 0;
    if (normalZ < 0) downwardArea += area;
    if (normalZ < -Math.SQRT1_2) severeOverhangArea += area;
    const tetraVolume = dot(a, cross(b, c)) / 6;
    signedVolume += tetraVolume;
    centroidX += tetraVolume * (a[0] + b[0] + c[0]) / 4;
    centroidY += tetraVolume * (a[1] + b[1] + c[1]) / 4;
    centroidZ += tetraVolume * (a[2] + b[2] + c[2]) / 4;
    for (const point of [a, b, c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
      }
    }
    for (const [left, right] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(left, right);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    const facetKey = [vertexKey(a), vertexKey(b), vertexKey(c)].sort().join('|');
    if (facets.has(facetKey)) duplicateTriangles += 1;
    else facets.add(facetKey);
  };
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(vertexPattern);
    if (!match) continue;
    const point = match.slice(1).map(Number);
    if (!finiteVector(point)) throw meshError('STL contains an invalid vertex coordinate.');
    vertices.push(point);
    if (vertices.length === 3) flushTriangle();
  }
  if (vertices.length) throw meshError('STL contains an incomplete triangle.');
  if (!triangles) throw meshError('STL contains no triangles.');
  const boundaryEdges = [...edges.values()].filter((count) => count === 1).length;
  const manifoldEdges = [...edges.values()].filter((count) => count === 2).length;
  const nonmanifoldEdges = [...edges.values()].filter((count) => count > 2).length;
  const size = bounds.max.map((valueAtAxis, axis) => valueAtAxis - bounds.min[axis]);
  const volume = Math.abs(signedVolume);
  const centroid = Math.abs(signedVolume) > 1e-12
    ? [centroidX / signedVolume, centroidY / signedVolume, centroidZ / signedVolume]
      .map((valueAtAxis) => number(valueAtAxis))
    : null;
  const watertight = boundaryEdges === 0 && nonmanifoldEdges === 0;
  const simple = watertight && degenerateTriangles === 0 && duplicateTriangles === 0 &&
    volume > 1e-9;
  return {
    format: 'ascii_stl',
    units_assumed: 'mm',
    triangles,
    unique_edges: edges.size,
    topology: {
      watertight,
      manifold_edges: manifoldEdges,
      boundary_edges: boundaryEdges,
      nonmanifold_edges: nonmanifoldEdges,
      degenerate_triangles: degenerateTriangles,
      duplicate_triangles: duplicateTriangles
    },
    geometry: {
      bounding_box: {
        min: bounds.min.map((item) => number(item)),
        max: bounds.max.map((item) => number(item)),
        size: size.map((item) => number(item))
      },
      surface_area_mm2: number(surfaceArea),
      signed_volume_mm3: number(signedVolume),
      volume_mm3: number(volume),
      centroid_mm: centroid
    },
    printability_indicators: {
      downward_area_mm2: number(downwardArea),
      severe_overhang_area_mm2: number(severeOverhangArea),
      severe_overhang_area_fraction: surfaceArea > 0
        ? number(severeOverhangArea / surfaceArea) : null,
      orientation_dependent: true
    },
    status: simple ? 'pass' : watertight && volume > 1e-9 ? 'review' : 'fail',
    limitations: [
      'Units are assumed to be millimeters because STL does not encode units.',
      'Overhang indicators use triangle orientation and a 45-degree downward-normal threshold; they do not replace slicer support analysis.',
      'Topology and volume checks do not establish structural, thermal, fatigue, tolerance, material, or print safety.'
    ]
  };
}

function parseCoordinate(line, name) {
  const match = line.match(new RegExp('(?:^|\\s)' + name + '(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))', 'i'));
  return match ? Number(match[1]) : null;
}

function parseCommentValue(lines, pattern) {
  const line = lines.find((candidate) => pattern.test(candidate));
  return line ? line.slice(line.indexOf('=') + 1).trim() : null;
}

export function analyzeGcode(value, { maximumBytes = MAX_GCODE_BYTES } = {}) {
  const text = String(value ?? '');
  const bytes = Buffer.byteLength(text);
  if (bytes > maximumBytes) {
    throw Object.assign(new Error('G-code exceeds the ' + maximumBytes + ' byte analysis limit.'), {
      code: 'GCODE_TOO_LARGE'
    });
  }
  const lines = text.split(/\r?\n/);
  const commandCounts = {};
  const riskyCommands = {};
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
  const current = { X: 0, Y: 0, Z: 0, E: 0 };
  let positionAbsolute = true;
  let extrusionAbsolute = true;
  let positiveExtrusionMoves = 0;
  let motionMoves = 0;
  let layerChanges = 0;
  let toolChanges = 0;
  const dangerous = new Set([
    'M104', 'M109', 'M140', 'M190', 'M141', 'M191',
    'G28', 'G29', 'G30', 'G32', 'M3', 'M4', 'M5', 'M42'
  ]);
  for (const raw of lines) {
    if (/^;\s*(?:LAYER_CHANGE|LAYER:)/i.test(raw)) layerChanges += 1;
    const line = raw.split(';', 1)[0].trim();
    if (!line) continue;
    const match = line.match(/^([GMT]\d+)(?:\s|$)/i);
    if (!match) continue;
    const command = match[1].toUpperCase();
    commandCounts[command] = (commandCounts[command] ?? 0) + 1;
    if (dangerous.has(command)) riskyCommands[command] = (riskyCommands[command] ?? 0) + 1;
    if (command === 'G90') positionAbsolute = true;
    if (command === 'G91') positionAbsolute = false;
    if (command === 'M82') extrusionAbsolute = true;
    if (command === 'M83') extrusionAbsolute = false;
    if (command === 'T0' || /^T\d+$/.test(command)) toolChanges += 1;
    if (command === 'G92') {
      for (const axis of ['X', 'Y', 'Z', 'E']) {
        const coordinate = parseCoordinate(line, axis);
        if (coordinate !== null) current[axis] = coordinate;
      }
      continue;
    }
    if (!['G0', 'G1', 'G2', 'G3'].includes(command)) continue;
    motionMoves += 1;
    for (const [axisIndex, axis] of ['X', 'Y', 'Z'].entries()) {
      const coordinate = parseCoordinate(line, axis);
      if (coordinate === null) continue;
      const next = positionAbsolute ? coordinate : current[axis] + coordinate;
      current[axis] = next;
      bounds.min[axisIndex] = Math.min(bounds.min[axisIndex], next);
      bounds.max[axisIndex] = Math.max(bounds.max[axisIndex], next);
    }
    const extrusion = parseCoordinate(line, 'E');
    if (extrusion !== null) {
      const delta = extrusionAbsolute ? extrusion - current.E : extrusion;
      if (delta > 1e-8) positiveExtrusionMoves += 1;
      current.E = extrusionAbsolute ? extrusion : current.E + extrusion;
    }
  }
  const coordinateBounds = bounds.min[0] === Infinity ? null : {
    min: bounds.min.map((item) => number(item)),
    max: bounds.max.map((item) => number(item)),
    size: bounds.max.map((item, index) => number(item - bounds.min[index]))
  };
  const heaterCommands = ['M104', 'M109', 'M140', 'M190', 'M141', 'M191']
    .reduce((total, command) => total + (commandCounts[command] ?? 0), 0);
  const homingCommands = ['G28', 'G29', 'G30', 'G32']
    .reduce((total, command) => total + (commandCounts[command] ?? 0), 0);
  const spindleCommands = ['M3', 'M4', 'M5']
    .reduce((total, command) => total + (commandCounts[command] ?? 0), 0);
  return {
    bytes,
    lines: lines.length,
    layers: layerChanges,
    motion_moves: motionMoves,
    positive_extrusion_moves: positiveExtrusionMoves,
    tool_changes: toolChanges,
    coordinate_bounds_mm: coordinateBounds,
    command_counts: commandCounts,
    physical_command_indicators: {
      heater_commands: heaterCommands,
      homing_or_leveling_commands: homingCommands,
      spindle_commands: spindleCommands,
      fan_commands: (commandCounts.M106 ?? 0) + (commandCounts.M107 ?? 0),
      risky_commands: riskyCommands
    },
    slicer_comments: {
      estimated_printing_time: parseCommentValue(lines, /^;\s*estimated printing time .*=/i),
      filament_used_mm: parseCommentValue(lines, /^;\s*filament used \[mm\]\s*=/i),
      filament_used_g: parseCommentValue(lines, /^;\s*total filament used \[g\]\s*=/i),
      layer_height: parseCommentValue(lines, /^;\s*layer_height\s*=/i),
      fill_density: parseCommentValue(lines, /^;\s*fill_density\s*=/i),
      gcode_flavor: parseCommentValue(lines, /^;\s*gcode_flavor\s*=/i)
    },
    preview_only_invariants: {
      no_positive_extrusion: positiveExtrusionMoves === 0,
      no_heater_commands: heaterCommands === 0,
      no_homing_or_leveling: homingCommands === 0,
      no_spindle_commands: spindleCommands === 0,
      pass: positiveExtrusionMoves === 0 && heaterCommands === 0 &&
        homingCommands === 0 && spindleCommands === 0
    },
    physical_control_data: true,
    interpretation: 'G-code is machine-control data. Analysis does not validate printer compatibility or authorize transmission or execution.'
  };
}
