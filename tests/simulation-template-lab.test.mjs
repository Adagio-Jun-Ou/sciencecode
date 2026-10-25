import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChatSession,
  interactionAwarePrompt,
  listInteractions,
  readAuditRecords,
  startLab,
  verifyProject
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Lab installs exact simulation templates without overwriting project files', async (context) => {
  const directory = fs.mkdtempSync(
    path.join(packageRoot, '.test-tmp-0.23-template-')
  );
  const chat = createChatSession({
    cwd: directory,
    title: 'CAD surface model',
    agent: 'cad-engineer'
  });
  const chatId = chat.manifest.chat_id;
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({
      ok: true,
      gpu: { available: false, devices: [] },
      npu: { available: false },
      runtime: null
    })
  });
  const details = await launched.ready;
  context.after(async () => {
    await new Promise((resolve) => launched.server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const install = (name, body, origin = details.url) => fetch(
    details.url + '/api/simulation-templates/' + encodeURIComponent(name),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin
      },
      body: JSON.stringify(body)
    }
  );

  const crossSite = await install('cad-surface-heat', {
    chat_id: chatId
  }, 'https://untrusted.example');
  assert.equal(crossSite.status, 403);
  assert.equal((await crossSite.json()).error.code, 'UNTRUSTED_CHAT_ORIGIN');

  const unknownField = await install('cad-surface-heat', {
    chat_id: chatId,
    target: 'replace-user-file.py'
  });
  assert.equal(unknownField.status, 400);
  assert.equal(
    (await unknownField.json()).error.code,
    'INVALID_SIMULATION_TEMPLATE_REQUEST'
  );

  const installedResponse = await install('cad-surface-heat', {
    chat_id: chatId,
    note: 'Install the bounded surface solver.'
  });
  assert.equal(installedResponse.status, 201);
  const installed = await installedResponse.json();
  assert.deepEqual(
    {
      name: installed.template.name,
      file: installed.template.file,
      created: installed.template.created
    },
    {
      name: 'cad-surface-heat',
      file: 'simulations/cad-surface-heat.py',
      created: true
    }
  );
  assert.match(installed.template.sha256, /^[a-f0-9]{64}$/);
  const target = path.join(directory, 'simulations', 'cad-surface-heat.py');
  assert.match(fs.readFileSync(target, 'utf8'),
    /surface_graph_heat_diffusion_not_volumetric_fea/);

  const reusedResponse = await install('cad-surface-heat', {
    chat_id: chatId
  });
  assert.equal(reusedResponse.status, 200);
  const reused = await reusedResponse.json();
  assert.equal(reused.template.created, false);
  assert.equal(reused.template.sha256, installed.template.sha256);

  const missing = await install('missing-template', {});
  assert.equal(missing.status, 404);
  assert.equal(
    (await missing.json()).error.code,
    'SIMULATION_TEMPLATE_NOT_FOUND'
  );

  fs.appendFileSync(target, '# user-owned modification\n');
  const conflict = await install('cad-surface-heat', { chat_id: chatId });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'EEXIST');
  assert.match(fs.readFileSync(target, 'utf8'), /user-owned modification/);

  assert.deepEqual(
    listInteractions(directory, chatId).map((record) => record.action),
    ['model.template.installed', 'model.template.reused']
  );
  const prompt = interactionAwarePrompt({
    cwd: directory,
    chatId,
    message: 'Run the installed thermal model.'
  }).prompt;
  assert.match(prompt, /model\.template\.reused/);
  assert.match(prompt, /simulations\/cad-surface-heat\.py/);
  assert.deepEqual(
    readAuditRecords(directory)
      .filter((record) => record.type.startsWith('simulation.template_'))
      .map((record) => record.type),
    ['simulation.template_created', 'simulation.template_reused']
  );
  assert.equal(verifyProject(directory).ok, true);
});
