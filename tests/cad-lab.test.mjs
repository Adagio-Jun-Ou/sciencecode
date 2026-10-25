import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatSession,
  listInteractions,
  startLab,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Lab exposes a conflict-safe multi-file CAD workspace and AI-visible source edits', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-lab-'));
  const chat = createChatSession({
    cwd: directory,
    title: 'CAD engineering review',
    agent: 'scientist'
  });
  const chatId = chat.manifest.chat_id;
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: null, npu: null, runtime: null })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const mutate = (pathname, body) => fetch(details.url + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: details.url
    },
    body: JSON.stringify(body)
  });

  const cadModule = await fetch(details.url + '/cad.js');
  assert.equal(cadModule.status, 200);
  const cadSource = await cadModule.text();
  assert.match(cadSource, /renderCadWorkspace/);
  assert.match(cadSource, /Save source \+ revision/);
  assert.match(cadSource, /Generate bounded slice/);
  assert.match(cadSource, /openMesh/);
  const cadStyles = await fetch(details.url + '/cad.css');
  assert.equal(cadStyles.status, 200);
  assert.match(await cadStyles.text(), /\.cad-source-workspace/);

  const createdResponse = await mutate('/api/cad/projects', {
    name: 'Fixture assembly',
    cad_project_id: 'cad-fixture-assembly',
    chat_id: chatId,
    note: 'Create an editable multi-file fixture.'
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.project.descriptor.files.length, 3);
  assert.equal(created.project.descriptor.parts.length, 2);
  assert.equal(created.interaction.surface, 'cad');

  const cadQueryResponse = await mutate('/api/cad/projects', {
    name: 'CadQuery fixture',
    cad_project_id: 'cad-cadquery-fixture',
    engine: 'cadquery',
    note: 'Create an editable multi-file Python and STEP environment.'
  });
  assert.equal(cadQueryResponse.status, 201);
  const cadQuery = await cadQueryResponse.json();
  assert.equal(cadQuery.project.descriptor.engine, 'cadquery');
  assert.equal(cadQuery.project.descriptor.entry, 'assembly.py');
  assert.equal(cadQuery.project.descriptor.files.length, 4);
  const pythonSource = await (await fetch(details.url +
    '/api/cad/projects/cad-cadquery-fixture/files/' +
    encodeURIComponent('parts/base.py'))).json();
  assert.equal(pythonSource.editable, true);
  assert.match(pythonSource.content, /def make_base/);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.cad_projects, 2);
  assert.equal(state.counts.healthy_cad_projects, 2);
  assert.ok(state.cad_projects.some((item) =>
    item.cad_project_id === 'cad-cadquery-fixture' && item.engine === 'cadquery'));

  const sourceUrl = '/api/cad/projects/cad-fixture-assembly/files/' +
    encodeURIComponent('parts/base.scad');
  const sourceResponse = await fetch(details.url + sourceUrl);
  assert.equal(sourceResponse.status, 200);
  const source = await sourceResponse.json();
  assert.match(source.content, /module base_part/);

  const editedContent = source.content.replace('length=56', 'length=64');
  const savedResponse = await mutate(sourceUrl, {
    content: editedContent,
    expected_sha256: source.sha256,
    actor: 'lab-test-user',
    chat_id: chatId,
    note: 'Increase the base length for the fixture envelope.'
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.file.changed, true);
  assert.ok(saved.file.revision.revision_id.startsWith('cad-revision-'));
  assert.equal(saved.interaction.action, 'source.edited');

  const conflict = await mutate(sourceUrl, {
    content: editedContent + '\n// stale overwrite\n',
    expected_sha256: source.sha256,
    actor: 'stale-client'
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'CAD_EDIT_CONFLICT');

  const clearedResponse = await mutate(sourceUrl, {
    content: '',
    expected_sha256: saved.file.sha256,
    actor: 'lab-test-user',
    chat_id: chatId,
    note: 'Clear this declared source while replacing its module.'
  });
  assert.equal(clearedResponse.status, 200);
  const cleared = await clearedResponse.json();
  assert.equal(cleared.file.content, '');
  assert.equal(cleared.file.changed, true);

  const traversal = await fetch(details.url +
    '/api/cad/projects/cad-fixture-assembly/files/' +
    encodeURIComponent('../outside.scad'));
  assert.equal(traversal.status, 400);

  const harnessResponse = await fetch(details.url + '/api/chats/' +
    encodeURIComponent(chatId) + '/harness');
  assert.equal(harnessResponse.status, 200);
  const harness = await harnessResponse.json();
  assert.equal(harness.board.cad.projects.length, 2);
  assert.equal(harness.board.cad.safety.printer_transmission, 'disabled');
  assert.equal(harness.board.validation.cad_projects, 2);

  const interactions = listInteractions(directory, chatId);
  assert.deepEqual(interactions.map((item) => item.action), [
    'project.created',
    'source.edited',
    'source.edited'
  ]);
  const lineage = await (await fetch(details.url + '/api/lineage')).json();
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'cad-project' && node.record_id === 'cad-fixture-assembly'));
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'interaction' && node.metadata.surface === 'cad'));
  assert.equal(verifyProject(directory).ok, true);
});
