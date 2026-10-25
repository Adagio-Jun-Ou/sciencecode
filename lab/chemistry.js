export const MAX_CHEMICAL_MOLECULES = 128;
export const MAX_CHEMICAL_ATOMS = 5_000;
export const MAX_CHEMICAL_BONDS = 10_000;

const MASS = {
  H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  NA: 22.99, MG: 24.305, P: 30.974, S: 32.06, CL: 35.45, K: 39.098,
  CA: 40.078, FE: 55.845, BR: 79.904, I: 126.904
};

function boundedInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError('Chemical parser limit must be an integer from 1 through ' + maximum + '.');
  }
  return parsed;
}

function elementName(value) {
  const text = String(value ?? 'C').trim();
  if (text === '*') return '*';
  if (!text) return 'C';
  return text[0].toUpperCase() + text.slice(1).toLowerCase();
}

function bracketAtom(content) {
  const match = String(content).match(/^(?:\d+)?([A-Z][a-z]?|[bcnops]|\*)/);
  if (!match) return null;
  const raw = match[1];
  const chargeMatch = String(content).match(/([+-])(\d+)|(\++)|(-+)/);
  let charge = 0;
  if (chargeMatch?.[1]) charge = (chargeMatch[1] === '+' ? 1 : -1) * Number(chargeMatch[2]);
  else if (chargeMatch?.[3]) charge = chargeMatch[3].length;
  else if (chargeMatch?.[4]) charge = -chargeMatch[4].length;
  const hydrogenMatch = String(content).match(/H(\d*)/);
  return {
    element: elementName(raw),
    label: '[' + content + ']',
    aromatic: raw === raw.toLowerCase() && raw !== '*',
    charge,
    hydrogens: hydrogenMatch ? Number(hydrogenMatch[1] || 1) : 0
  };
}

function placeAtom(atoms, parentIndex, componentIndex, degree = 0) {
  if (!Number.isInteger(parentIndex)) {
    return { x: componentIndex * 3.2, y: 0, direction: 0 };
  }
  const parent = atoms[parentIndex];
  const incoming = Number.isFinite(parent.direction) ? parent.direction : 0;
  let direction;
  if (degree === 0) direction = incoming;
  else if (degree === 1) direction = incoming + (atoms.length % 2 ? 0.52 : -0.52);
  else {
    const branch = Math.ceil((degree - 1) / 2);
    direction = incoming + (degree % 2 ? 1 : -1) * (1.05 + branch * 0.2);
  }
  return {
    x: parent.x + Math.cos(direction) * 1.42,
    y: parent.y + Math.sin(direction) * 1.42,
    direction
  };
}

function chemicalError(message, code = 'INVALID_CHEMICAL') {
  return Object.assign(new Error(message), { code });
}

export function parseSmiles(value, options = {}) {
  const smiles = String(value ?? '').trim();
  const maxAtoms = boundedInteger(options.maxAtoms, MAX_CHEMICAL_ATOMS, MAX_CHEMICAL_ATOMS);
  const maxBonds = boundedInteger(options.maxBonds, MAX_CHEMICAL_BONDS, MAX_CHEMICAL_BONDS);
  if (!smiles) throw chemicalError('SMILES input is empty.');
  if (smiles.length > 65_536) throw chemicalError('SMILES input exceeds 65,536 characters.', 'CHEMICAL_TOO_LARGE');
  const atoms = [];
  const bonds = [];
  const warnings = [];
  const branches = [];
  const rings = new Map();
  const degrees = [];
  let current = null;
  let pending = { order: null, stereo: null };
  let component = 0;

  function addAtom(atom) {
    if (atoms.length >= maxAtoms) throw chemicalError('Chemical atom limit reached.', 'CHEMICAL_TOO_LARGE');
    const position = placeAtom(atoms, current, component, degrees[current] ?? 0);
    const index = atoms.length;
    atoms.push({ index, ...atom, ...position });
    if (Number.isInteger(current)) {
      if (bonds.length >= maxBonds) throw chemicalError('Chemical bond limit reached.', 'CHEMICAL_TOO_LARGE');
      bonds.push({
        index: bonds.length,
        from: current,
        to: index,
        order: pending.order ?? (atoms[current].aromatic && atom.aromatic ? 1.5 : 1),
        stereo: pending.stereo
      });
      degrees[current] = (degrees[current] ?? 0) + 1;
      degrees[index] = 1;
    } else {
      degrees[index] = 0;
    }
    current = index;
    pending = { order: null, stereo: null };
  }

  for (let cursor = 0; cursor < smiles.length;) {
    const character = smiles[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === '[') {
      const close = smiles.indexOf(']', cursor + 1);
      if (close < 0) throw chemicalError('Unclosed bracket atom at character ' + (cursor + 1) + '.');
      const atom = bracketAtom(smiles.slice(cursor + 1, close));
      if (!atom) throw chemicalError('Unsupported bracket atom at character ' + (cursor + 1) + '.');
      addAtom(atom);
      cursor = close + 1;
      continue;
    }
    if (character === '(') {
      if (!Number.isInteger(current)) throw chemicalError('Branch has no preceding atom at character ' + (cursor + 1) + '.');
      branches.push(current);
      cursor += 1;
      continue;
    }
    if (character === ')') {
      if (!branches.length) throw chemicalError('Unmatched branch close at character ' + (cursor + 1) + '.');
      current = branches.pop();
      cursor += 1;
      continue;
    }
    if (character === '.') {
      current = null;
      component += 1;
      pending = { order: null, stereo: null };
      cursor += 1;
      continue;
    }
    if ('-=#:~/\\'.includes(character)) {
      const order = character === '=' ? 2 : character === '#' ? 3 : character === ':' ? 1.5 : 1;
      pending = { order, stereo: '/\\'.includes(character) ? character : null };
      cursor += 1;
      continue;
    }
    let ringLabel = null;
    if (/\d/.test(character)) {
      ringLabel = character;
      cursor += 1;
    } else if (character === '%' && /^%\d{2}/.test(smiles.slice(cursor))) {
      ringLabel = smiles.slice(cursor + 1, cursor + 3);
      cursor += 3;
    }
    if (ringLabel !== null) {
      if (!Number.isInteger(current)) throw chemicalError('Ring closure has no atom.');
      if (rings.has(ringLabel)) {
        const saved = rings.get(ringLabel);
        rings.delete(ringLabel);
        if (saved.atom === current) throw chemicalError('Ring closure cannot connect an atom to itself.');
        if (bonds.length >= maxBonds) throw chemicalError('Chemical bond limit reached.', 'CHEMICAL_TOO_LARGE');
        bonds.push({
          index: bonds.length,
          from: saved.atom,
          to: current,
          order: pending.order ?? saved.order ??
            (atoms[saved.atom].aromatic && atoms[current].aromatic ? 1.5 : 1),
          stereo: pending.stereo ?? saved.stereo
        });
        degrees[saved.atom] = (degrees[saved.atom] ?? 0) + 1;
        degrees[current] = (degrees[current] ?? 0) + 1;
      } else {
        rings.set(ringLabel, { atom: current, ...pending });
      }
      pending = { order: null, stereo: null };
      continue;
    }
    let token = null;
    if ((character === 'C' && smiles[cursor + 1] === 'l') ||
        (character === 'B' && smiles[cursor + 1] === 'r')) {
      token = smiles.slice(cursor, cursor + 2);
      cursor += 2;
    } else if (/[A-Z]/.test(character)) {
      const candidate = smiles.slice(cursor).match(/^[A-Z][a-z]?/)[0];
      if (!['B', 'C', 'N', 'O', 'P', 'S', 'F', 'I'].includes(candidate)) {
        throw chemicalError('Element ' + candidate + ' must use bracket notation at character ' + (cursor + 1) + '.');
      }
      token = candidate;
      cursor += candidate.length;
    } else if (/[bcnops]/.test(character)) {
      token = character;
      cursor += 1;
    } else if (character === '*') {
      token = '*';
      cursor += 1;
    }
    if (token !== null) {
      const aromatic = token === token.toLowerCase() && token !== '*';
      addAtom({
        element: elementName(token),
        label: elementName(token),
        aromatic,
        charge: 0,
        hydrogens: 0
      });
      continue;
    }
    warnings.push('Ignored unsupported token ' + JSON.stringify(character) + ' at character ' + (cursor + 1) + '.');
    cursor += 1;
  }
  if (branches.length) throw chemicalError(branches.length + ' branch group(s) were not closed.');
  if (rings.size) throw chemicalError(rings.size + ' ring closure(s) were not completed.');
  if (!atoms.length) throw chemicalError('No atoms were parsed from SMILES input.');
  return { smiles, atoms, bonds, warnings };
}

function chargeFromMolCode(code) {
  return ({ 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 })[Number(code)] ?? 0;
}

function parseMolBlock(value, options = {}) {
  const lines = String(value ?? '').replace(/\r/g, '').split('\n');
  const maxAtoms = boundedInteger(options.maxAtoms, MAX_CHEMICAL_ATOMS, MAX_CHEMICAL_ATOMS);
  const maxBonds = boundedInteger(options.maxBonds, MAX_CHEMICAL_BONDS, MAX_CHEMICAL_BONDS);
  const counts = lines[3] ?? '';
  const atomCount = Number(counts.slice(0, 3).trim());
  const bondCount = Number(counts.slice(3, 6).trim());
  if (!Number.isInteger(atomCount) || atomCount < 1 || !Number.isInteger(bondCount) || bondCount < 0) {
    throw chemicalError('Only bounded MOL/SDF V2000 records are currently supported.');
  }
  if (atomCount > maxAtoms || bondCount > maxBonds) {
    throw chemicalError('Chemical record exceeds the configured atom or bond limit.', 'CHEMICAL_TOO_LARGE');
  }
  const atoms = [];
  const bonds = [];
  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[4 + index] ?? '';
    const x = Number(line.slice(0, 10));
    const y = Number(line.slice(10, 20));
    const z = Number(line.slice(20, 30));
    if (![x, y, z].every(Number.isFinite)) throw chemicalError('Invalid MOL atom coordinates at atom ' + (index + 1) + '.');
    const element = elementName(line.slice(31, 34));
    atoms.push({
      index, element, label: element, aromatic: false,
      charge: chargeFromMolCode(line.slice(36, 39).trim()), hydrogens: 0,
      x, y, z, direction: 0
    });
  }
  for (let index = 0; index < bondCount; index += 1) {
    const line = lines[4 + atomCount + index] ?? '';
    const from = Number(line.slice(0, 3)) - 1;
    const to = Number(line.slice(3, 6)) - 1;
    const order = Number(line.slice(6, 9).trim()) || 1;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 ||
        from >= atoms.length || to >= atoms.length || from === to) {
      throw chemicalError('Invalid MOL bond at bond ' + (index + 1) + '.');
    }
    bonds.push({ index, from, to, order, stereo: null });
  }
  const properties = {};
  for (let index = 4 + atomCount + bondCount; index < lines.length; index += 1) {
    const property = lines[index].match(/^>\s*<([^>]+)>/);
    if (!property) continue;
    const values = [];
    for (index += 1; index < lines.length && lines[index].trim(); index += 1) values.push(lines[index]);
    if (Object.keys(properties).length < 128) properties[property[1].trim().slice(0, 160)] = values.join('\n').slice(0, 8_192);
  }
  return {
    name: (lines[0] ?? '').trim().slice(0, 240) || 'Untitled molecule',
    atoms,
    bonds,
    properties,
    warnings: []
  };
}

function moleculeSummary(molecule) {
  const counts = new Map();
  let mass = 0;
  let massComplete = true;
  for (const atom of molecule.atoms) {
    const key = String(atom.element ?? '*').toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (MASS[key] === undefined) massComplete = false;
    else mass += MASS[key];
  }
  const ordered = [...counts.entries()].sort(([left], [right]) => {
    if (left === 'C') return -1;
    if (right === 'C') return 1;
    if (left === 'H') return -1;
    if (right === 'H') return 1;
    return left.localeCompare(right);
  });
  const formula = ordered.map(([element, count]) =>
    elementName(element) + (count === 1 ? '' : String(count))).join('');
  return {
    formula,
    formula_basis: 'explicit-atoms-only',
    approximate_mass: massComplete && mass > 0 ? Number(mass.toFixed(4)) : null,
    atom_count: molecule.atoms.length,
    bond_count: molecule.bonds.length
  };
}

export function parseChemicalDocument(value, extension, options = {}) {
  const text = String(value ?? '');
  const format = String(extension ?? '').toLowerCase();
  const maxMolecules = boundedInteger(
    options.maxMolecules,
    MAX_CHEMICAL_MOLECULES,
    MAX_CHEMICAL_MOLECULES
  );
  const maxAtoms = boundedInteger(options.maxAtoms, MAX_CHEMICAL_ATOMS, MAX_CHEMICAL_ATOMS);
  const maxBonds = boundedInteger(options.maxBonds, MAX_CHEMICAL_BONDS, MAX_CHEMICAL_BONDS);
  const molecules = [];
  const warnings = [];
  let totalAtoms = 0;
  let totalBonds = 0;

  function addMolecule(molecule) {
    if (molecules.length >= maxMolecules) {
      warnings.push('Only the first ' + maxMolecules + ' molecules were loaded.');
      return false;
    }
    if (totalAtoms + molecule.atoms.length > maxAtoms || totalBonds + molecule.bonds.length > maxBonds) {
      warnings.push('The document was truncated at the configured atom or bond limit.');
      return false;
    }
    totalAtoms += molecule.atoms.length;
    totalBonds += molecule.bonds.length;
    molecules.push({
      index: molecules.length,
      name: molecule.name || 'Molecule ' + (molecules.length + 1),
      properties: molecule.properties ?? {},
      warnings: molecule.warnings ?? [],
      atoms: molecule.atoms,
      bonds: molecule.bonds,
      summary: moleculeSummary(molecule)
    });
    return true;
  }

  if (format === 'mol') {
    addMolecule(parseMolBlock(text, { maxAtoms, maxBonds }));
  } else if (format === 'sdf') {
    const blocks = text.replace(/\r/g, '').split(/^\$\$\$\$\s*$/m).filter((block) => block.trim());
    for (const block of blocks) {
      if (!addMolecule(parseMolBlock(block.replace(/^\n/, ''), {
        maxAtoms: Math.max(1, maxAtoms - totalAtoms),
        maxBonds: Math.max(1, maxBonds - totalBonds)
      }))) break;
    }
  } else if (format === 'smi' || format === 'smiles') {
    const lines = text.replace(/\r/g, '').split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex].trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^(\S+)(?:\s+(.+))?$/);
      try {
        const parsed = parseSmiles(match[1], {
          maxAtoms: Math.max(1, maxAtoms - totalAtoms),
          maxBonds: Math.max(1, maxBonds - totalBonds)
        });
        if (!addMolecule({
          name: match[2]?.trim().slice(0, 240) || 'Molecule ' + (molecules.length + 1),
          properties: { SMILES: match[1] },
          ...parsed
        })) break;
      } catch (error) {
        warnings.push('Line ' + (lineIndex + 1) + ': ' + error.message);
      }
    }
  } else {
    throw chemicalError('Unsupported chemical format: ' + (format || 'unknown') + '.');
  }
  if (!molecules.length) throw chemicalError('No supported molecular records were found.');
  return {
    format,
    molecules,
    warnings,
    stats: {
      molecule_count: molecules.length,
      atom_count: totalAtoms,
      bond_count: totalBonds,
      truncated: warnings.some((warning) => /first|truncated|limit/i.test(warning))
    }
  };
}

function finiteDimension(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function fitChemicalView(molecule, width = 800, height = 520, padding = 48) {
  const atoms = molecule?.atoms ?? [];
  const canvasWidth = finiteDimension(width, 800);
  const canvasHeight = finiteDimension(height, 520);
  if (!atoms.length) return { center_x: 0, center_y: 0, scale: 1, zoom: 1, pan_x: 0, pan_y: 0 };
  const xs = atoms.map((atom) => Number(atom.x)).filter(Number.isFinite);
  const ys = atoms.map((atom) => Number(atom.y)).filter(Number.isFinite);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const safePadding = Math.max(0, Math.min(Number(padding) || 0, Math.min(canvasWidth, canvasHeight) / 3));
  return {
    center_x: (minX + maxX) / 2,
    center_y: (minY + maxY) / 2,
    scale: Math.max(0.0001, Math.min(
      (canvasWidth - safePadding * 2) / spanX,
      (canvasHeight - safePadding * 2) / spanY
    )),
    zoom: 1,
    pan_x: 0,
    pan_y: 0
  };
}

export function chemicalPointToCanvas(point, view, width, height) {
  const scale = Number(view?.scale ?? 1) * Number(view?.zoom ?? 1);
  return {
    x: finiteDimension(width, 800) / 2 + Number(view?.pan_x ?? 0) +
      (Number(point?.x ?? 0) - Number(view?.center_x ?? 0)) * scale,
    y: finiteDimension(height, 520) / 2 + Number(view?.pan_y ?? 0) -
      (Number(point?.y ?? 0) - Number(view?.center_y ?? 0)) * scale
  };
}

export function chemicalCanvasToPoint(point, view, width, height) {
  const scale = Math.max(1e-12, Number(view?.scale ?? 1) * Number(view?.zoom ?? 1));
  return {
    x: Number(view?.center_x ?? 0) +
      (Number(point?.x ?? 0) - finiteDimension(width, 800) / 2 - Number(view?.pan_x ?? 0)) / scale,
    y: Number(view?.center_y ?? 0) -
      (Number(point?.y ?? 0) - finiteDimension(height, 520) / 2 - Number(view?.pan_y ?? 0)) / scale
  };
}

export function zoomChemicalView(view, factor, anchor, width = 800, height = 520) {
  const multiplier = Number(factor);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return { ...view };
  const point = anchor ?? { x: finiteDimension(width, 800) / 2, y: finiteDimension(height, 520) / 2 };
  const chemical = chemicalCanvasToPoint(point, view, width, height);
  const next = { ...view, zoom: Math.max(0.2, Math.min(8, Number(view?.zoom ?? 1) * multiplier)) };
  const projected = chemicalPointToCanvas(chemical, next, width, height);
  next.pan_x += Number(point.x) - projected.x;
  next.pan_y += Number(point.y) - projected.y;
  return next;
}

export function panChemicalView(view, deltaX, deltaY) {
  return {
    ...view,
    pan_x: Number(view?.pan_x ?? 0) + (Number(deltaX) || 0),
    pan_y: Number(view?.pan_y ?? 0) + (Number(deltaY) || 0)
  };
}

export function nearestChemicalAtom(molecule, point, view, width, height, maximum = 18) {
  let nearest = null;
  for (const atom of molecule?.atoms ?? []) {
    const projected = chemicalPointToCanvas(atom, view, width, height);
    const distance = Math.hypot(projected.x - Number(point?.x ?? 0), projected.y - Number(point?.y ?? 0));
    if (distance <= maximum && (!nearest || distance < nearest.distance)) {
      nearest = { atom, distance, projected };
    }
  }
  return nearest;
}
