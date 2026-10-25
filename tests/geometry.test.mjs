import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThreeD } from '../lab/geometry.js';

test('3D parser supports molecular and mesh text formats with bounded geometry', () => {
  const xyz = parseThreeD([
    '3',
    'water',
    'O 0.000 0.000 0.000',
    'H 0.960 0.000 0.000',
    'H -0.240 0.930 0.000'
  ].join('\n'), 'xyz');
  assert.equal(xyz.vertices.length, 3);
  assert.equal(xyz.vertices[0].element, 'O');
  assert.equal(xyz.edges.length, 2);

  const numeric = parseThreeD('0 0 0\n1 0 0\n', 'xyz');
  assert.equal(numeric.vertices.length, 2);

  const obj = parseThreeD([
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'f 1 2 3'
  ].join('\n'), 'obj');
  assert.equal(obj.vertices.length, 3);
  assert.deepEqual(obj.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(obj.faces, [[0, 1, 2]]);

  const pdb = parseThreeD([
    'ATOM      1  N   GLY A   1      11.104  13.207   2.100  1.00 20.00           N  ',
    'ATOM      2  C   GLY A   1      12.250  13.000   2.100  1.00 20.00           C  ',
    'CONECT    1    2'
  ].join('\n'), 'pdb');
  assert.equal(pdb.vertices.length, 2);
  assert.equal(pdb.vertices[0].element, 'N');
  assert.deepEqual(pdb.edges, [[0, 1]]);

  const mol = parseThreeD([
    'ScienceCode molecule',
    '  ScienceCode',
    '',
    '  2  1  0  0  0  0            999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    'M  END'
  ].join('\n'), 'mol');
  assert.equal(mol.vertices.length, 2);
  assert.equal(mol.vertices[1].element, 'O');
  assert.deepEqual(mol.edges, [[0, 1]]);

  const ply = parseThreeD([
    'ply',
    'format ascii 1.0',
    'element vertex 3',
    'property float x',
    'property float y',
    'property float z',
    'element face 1',
    'property list uchar int vertex_indices',
    'end_header',
    '0 0 0',
    '1 0 0',
    '0 1 0',
    '3 0 1 2'
  ].join('\n'), 'ply');
  assert.equal(ply.vertices.length, 3);
  assert.deepEqual(ply.edges, [[0, 1], [1, 2], [2, 0]]);
  assert.deepEqual(ply.faces, [[0, 1, 2]]);

  const scalarPly = parseThreeD([
    'ply',
    'format ascii 1.0',
    'element vertex 3',
    'property float temperature_c',
    'property float z',
    'property float x',
    'property float y',
    'element face 1',
    'property list uchar int vertex_indices',
    'end_header',
    '20 0 0 0',
    '50 0 1 0',
    '80 0 0 1',
    '3 0 1 2'
  ].join('\n'), 'ply');
  assert.deepEqual(
    scalarPly.vertices.map(({ x, y, z, scalar }) => ({ x, y, z, scalar })),
    [
      { x: 0, y: 0, z: 0, scalar: 20 },
      { x: 1, y: 0, z: 0, scalar: 50 },
      { x: 0, y: 1, z: 0, scalar: 80 }
    ]
  );
  assert.deepEqual(scalarPly.scalar, {
    name: 'temperature_c',
    unit: '°C',
    minimum: 20,
    maximum: 80,
    finite_vertices: 3
  });

  const stl = parseThreeD([
    'solid triangle',
    ' facet normal 0 0 1',
    '  outer loop',
    '   vertex 0 0 0',
    '   vertex 1 0 0',
    '   vertex 0 1 0',
    '  endloop',
    ' endfacet',
    'endsolid triangle'
  ].join('\n'), 'stl');
  assert.equal(stl.vertices.length, 3);
  assert.deepEqual(stl.faces, [[0, 1, 2]]);

  const oversized = parseThreeD(
    Array.from({ length: 5002 }, (_, index) => 'v ' + index + ' 0 0').join('\n'),
    'obj'
  );
  assert.equal(oversized.vertices.length, 5000);
  assert.deepEqual(parseThreeD('not geometry', 'ply'), {
    vertices: [], edges: [], faces: []
  });
});
