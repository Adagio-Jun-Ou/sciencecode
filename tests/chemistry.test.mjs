import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chemicalCanvasToPoint,
  chemicalPointToCanvas,
  fitChemicalView,
  nearestChemicalAtom,
  parseChemicalDocument,
  parseSmiles,
  panChemicalView,
  zoomChemicalView
} from '../lab/chemistry.js';

test('SMILES parsing preserves branches, bond orders, rings, components, and charges', () => {
  const aspirin = parseSmiles('CC(=O)OC1=CC=CC=C1C(=O)O');
  assert.equal(aspirin.atoms.length, 13);
  assert.equal(aspirin.bonds.length, 13);
  assert.equal(aspirin.bonds.filter((bond) => bond.order === 2).length, 5);
  assert.deepEqual(aspirin.warnings, []);

  const salt = parseSmiles('[NH4+].[Cl-]');
  assert.equal(salt.atoms.length, 2);
  assert.equal(salt.bonds.length, 0);
  assert.deepEqual(salt.atoms.map((atom) => atom.charge), [1, -1]);
  assert.deepEqual(salt.atoms.map((atom) => atom.element), ['N', 'Cl']);
  assert.equal(parseSmiles('[Fe++]').atoms[0].charge, 2);
  assert.ok(parseSmiles('c1ccccc1').bonds.every((bond) => bond.order === 1.5));
  assert.throws(() => parseSmiles('Fe'), /bracket notation/);
});

test('SDF parsing loads bounded molecules, properties, coordinates, and bond order', () => {
  const mol = [
    'Carbonyl',
    '  ScienceCode',
    '',
    '  2  1  0  0  0  0            999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  2  0  0  0  0',
    'M  END',
    '>  <IDENTIFIER>',
    'cmpd-001',
    '',
    '$$$$',
    'Amine',
    '  ScienceCode',
    '',
    '  1  0  0  0  0  0            999 V2000',
    '    0.0000    0.0000    0.0000 N   0  3  0  0  0  0  0  0  0  0  0  0',
    'M  END',
    '$$$$'
  ].join('\n');
  const document = parseChemicalDocument(mol, 'sdf');
  assert.equal(document.stats.molecule_count, 2);
  assert.equal(document.stats.atom_count, 3);
  assert.equal(document.molecules[0].properties.IDENTIFIER, 'cmpd-001');
  assert.equal(document.molecules[0].bonds[0].order, 2);
  assert.equal(document.molecules[1].atoms[0].charge, 1);
  assert.equal(document.molecules[0].summary.formula, 'CO');
});

test('chemical documents and transforms are bounded and deterministic', () => {
  const document = parseChemicalDocument('CCO ethanol\nC methane', 'smi', { maxMolecules: 1 });
  assert.equal(document.molecules.length, 1);
  assert.equal(document.stats.truncated, true);
  assert.match(document.warnings[0], /first 1 molecules/);
  assert.throws(() => parseSmiles('CCCC', { maxAtoms: 3 }), /atom limit/i);
  assert.throws(() => parseSmiles('C1CC', {}), /ring closure/i);
});

test('chemical pan, zoom, coordinate conversion, and nearest-atom selection agree', () => {
  const molecule = parseChemicalDocument('CCO ethanol', 'smi').molecules[0];
  const view = fitChemicalView(molecule, 800, 500);
  const source = molecule.atoms[1];
  const canvas = chemicalPointToCanvas(source, view, 800, 500);
  const restored = chemicalCanvasToPoint(canvas, view, 800, 500);
  assert.ok(Math.abs(restored.x - source.x) < 1e-10);
  assert.ok(Math.abs(restored.y - source.y) < 1e-10);
  assert.equal(nearestChemicalAtom(molecule, canvas, view, 800, 500)?.atom.index, 1);
  const zoomed = zoomChemicalView(view, 1.8, canvas, 800, 500);
  const anchored = chemicalPointToCanvas(source, zoomed, 800, 500);
  assert.ok(Math.abs(anchored.x - canvas.x) < 1e-10);
  assert.ok(Math.abs(anchored.y - canvas.y) < 1e-10);
  const panned = panChemicalView(zoomed, 12, -9);
  assert.equal(panned.pan_x, zoomed.pan_x + 12);
  assert.equal(panned.pan_y, zoomed.pan_y - 9);
});
