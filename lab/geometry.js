export function parseThreeD(text, extension) {
  const vertices = [];
  const edges = [];
  const faces = [];
  let scalarDescriptor = null;
  const format = String(extension ?? '').toLowerCase();
  const lines = String(text ?? '').split(/\r?\n/);
  if (format === 'obj') {
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v' && parts.length >= 4) {
        vertices.push({ x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]), element: 'C' });
      } else if (parts[0] === 'f' && parts.length >= 3) {
        const face = parts.slice(1).map((value) => Number(value.split('/')[0]) - 1)
          .filter((value) => Number.isInteger(value) && value >= 0);
        for (let index = 0; index < face.length; index += 1) {
          edges.push([face[index], face[(index + 1) % face.length]]);
        }
        for (let index = 1; index + 1 < face.length; index += 1) {
          faces.push([face[0], face[index], face[index + 1]]);
        }
      }
    }
  } else if (format === 'stl') {
    let triangle = [];
    for (const line of lines) {
      const match = line.match(
        /^\s*vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*$/i
      );
      if (!match) continue;
      const point = match.slice(1).map(Number);
      if (!point.every(Number.isFinite)) continue;
      vertices.push({ x: point[0], y: point[1], z: point[2], element: 'MESH' });
      triangle.push(vertices.length - 1);
      if (triangle.length === 3) {
        faces.push(triangle);
        edges.push(
          [triangle[0], triangle[1]],
          [triangle[1], triangle[2]],
          [triangle[2], triangle[0]]
        );
        triangle = [];
      }
    }
  } else if (format === 'pdb') {
    const serials = new Map();
    for (const line of lines) {
      if (line.startsWith('ATOM  ') || line.startsWith('HETATM')) {
        const serial = Number(line.slice(6, 11).trim());
        serials.set(serial, vertices.length);
        vertices.push({
          x: Number(line.slice(30, 38)),
          y: Number(line.slice(38, 46)),
          z: Number(line.slice(46, 54)),
          element: (line.slice(76, 78).trim() || line.slice(12, 14).trim() || 'C').toUpperCase()
        });
      }
    }
    for (const line of lines) {
      if (!line.startsWith('CONECT')) continue;
      const values = line.slice(6).trim().split(/\s+/).map(Number);
      const from = serials.get(values[0]);
      for (const serial of values.slice(1)) {
        const to = serials.get(serial);
        if (Number.isInteger(from) && Number.isInteger(to) && from < to) edges.push([from, to]);
      }
    }
  } else if (format === 'mol' || format === 'sdf') {
    const atomCount = Number(lines[3]?.slice(0, 3).trim());
    const bondCount = Number(lines[3]?.slice(3, 6).trim());
    for (let index = 0; index < atomCount; index += 1) {
      const line = lines[4 + index] ?? '';
      vertices.push({
        x: Number(line.slice(0, 10)),
        y: Number(line.slice(10, 20)),
        z: Number(line.slice(20, 30)),
        element: (line.slice(31, 34).trim() || 'C').toUpperCase()
      });
    }
    for (let index = 0; index < bondCount; index += 1) {
      const line = lines[4 + atomCount + index] ?? '';
      edges.push([Number(line.slice(0, 3)) - 1, Number(line.slice(3, 6)) - 1]);
    }
  } else if (format === 'ply') {
    const headerEnd = lines.findIndex((line) => line.trim() === 'end_header');
    const vertexCount = Number(lines.find((line) => line.startsWith('element vertex '))?.split(/\s+/)[2] ?? 0);
    const faceCount = Number(lines.find((line) => line.startsWith('element face '))?.split(/\s+/)[2] ?? 0);
    const ascii = lines.some((line) => /^format\s+ascii\s+/i.test(line.trim()));
    if (headerEnd >= 0 && ascii && Number.isSafeInteger(vertexCount) &&
        Number.isSafeInteger(faceCount) && vertexCount >= 0 && faceCount >= 0) {
      const vertexProperties = [];
      let activeElement = null;
      for (const headerLine of lines.slice(0, headerEnd + 1)) {
        const parts = headerLine.trim().split(/\s+/);
        if (parts[0]?.toLowerCase() === 'element') {
          activeElement = String(parts[1] ?? '').toLowerCase();
        } else if (parts[0]?.toLowerCase() === 'property' &&
            activeElement === 'vertex' && parts[1]?.toLowerCase() !== 'list') {
          const name = String(parts.at(-1) ?? '').toLowerCase();
          if (/^[a-z][a-z0-9_]{0,63}$/.test(name)) vertexProperties.push(name);
        }
      }
      const propertyIndex = new Map(
        vertexProperties.map((name, index) => [name, index])
      );
      const coordinateIndices = ['x', 'y', 'z'].map((name) => propertyIndex.get(name));
      const scalarName = [
        'temperature_c', 'temperature_k', 'temperature', 'scalar', 'value',
        'stress_mpa', 'stress', 'pressure_pa', 'pressure', 'strain',
        'displacement_mm', 'displacement', 'density'
      ].find((name) => propertyIndex.has(name)) ?? null;
      const scalarUnits = {
        temperature_c: '°C',
        temperature_k: 'K',
        stress_mpa: 'MPa',
        pressure_pa: 'Pa',
        displacement_mm: 'mm'
      };
      if (coordinateIndices.every(Number.isInteger) && scalarName) {
        scalarDescriptor = {
          name: scalarName,
          unit: scalarUnits[scalarName] ?? null
        };
      }
      for (let index = 0; index < vertexCount; index += 1) {
        const parts = (lines[headerEnd + 1 + index] ?? '').trim().split(/\s+/).map(Number);
        if (!coordinateIndices.every(Number.isInteger)) continue;
        vertices.push({
          x: parts[coordinateIndices[0]],
          y: parts[coordinateIndices[1]],
          z: parts[coordinateIndices[2]],
          element: 'C',
          ...(scalarDescriptor
            ? { scalar: parts[propertyIndex.get(scalarDescriptor.name)] }
            : {})
        });
      }
      for (let index = 0; index < faceCount; index += 1) {
        const parts = (lines[headerEnd + 1 + vertexCount + index] ?? '').trim().split(/\s+/).map(Number);
        const face = parts.slice(1, 1 + parts[0]);
        for (let item = 0; item < face.length; item += 1) {
          edges.push([face[item], face[(item + 1) % face.length]]);
        }
        for (let item = 1; item + 1 < face.length; item += 1) {
          faces.push([face[0], face[item], face[item + 1]]);
        }
      }
    }
  } else {
    const start = /^\s*\d+\s*$/.test(lines[0] ?? '') ? 2 : 0;
    for (const line of lines.slice(start)) {
      const parts = line.trim().split(/\s+/);
      const offset = Number.isFinite(Number(parts[0])) ? 0 : 1;
      if (parts.length < offset + 3) continue;
      const x = Number(parts[offset]);
      const y = Number(parts[offset + 1]);
      const z = Number(parts[offset + 2]);
      if ([x, y, z].every(Number.isFinite)) {
        vertices.push({ x, y, z, element: offset ? parts[0].toUpperCase() : 'C' });
      }
    }
  }
  const vertexLimit = format === 'stl' ? 60_000 : format === 'ply' ? 20_000 : 5_000;
  const cleanVertices = vertices.filter((vertex) =>
    [vertex.x, vertex.y, vertex.z].every(Number.isFinite)).slice(0, vertexLimit);
  const cleanEdges = edges.filter(([left, right]) =>
    Number.isInteger(left) && Number.isInteger(right) &&
    left >= 0 && right >= 0 && left < cleanVertices.length && right < cleanVertices.length
  ).slice(0, format === 'stl' ? 90_000 : format === 'ply' ? 60_000 : 12_000);
  const cleanFaces = faces.filter((face) =>
    Array.isArray(face) && face.length === 3 &&
    face.every((index) => Number.isInteger(index) && index >= 0 &&
      index < cleanVertices.length)
  ).slice(0, 20_000);
  if (!cleanEdges.length && cleanVertices.length <= 1200 && ['pdb', 'mol', 'sdf', 'xyz'].includes(format)) {
    const radii = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, P: 1.07, S: 1.05, CL: 1.02 };
    for (let left = 0; left < cleanVertices.length && cleanEdges.length < 8000; left += 1) {
      for (let right = left + 1; right < cleanVertices.length && cleanEdges.length < 8000; right += 1) {
        const a = cleanVertices[left];
        const b = cleanVertices[right];
        const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        const threshold = ((radii[a.element] ?? 0.77) + (radii[b.element] ?? 0.77)) * 1.25;
        if (distance > 0.2 && distance <= threshold) cleanEdges.push([left, right]);
      }
    }
  }
  const result = { vertices: cleanVertices, edges: cleanEdges, faces: cleanFaces };
  if (scalarDescriptor) {
    const values = cleanVertices.map((vertex) => vertex.scalar).filter(Number.isFinite);
    if (values.length) {
      result.scalar = {
        ...scalarDescriptor,
        minimum: Math.min(...values),
        maximum: Math.max(...values),
        finite_vertices: values.length
      };
    }
  }
  return result;
}
