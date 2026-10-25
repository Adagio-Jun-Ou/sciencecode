import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERSION,
  appendAudit,
  createChatSession,
  createKernelManager,
  findExecutable,
  getChatSession,
  getRunManifest,
  listChats,
  listInteractions,
  runExperiment,
  runSimulation,
  sendChatMessageAsync,
  startLab,
  verifyChat,
  verifyProject,
  verifyRun
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = findExecutable(process.platform === 'win32' ? 'python' : 'python3') ??
  findExecutable('python');

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: ['torch==2.12.0+cu130'] },
    probe: {
      python: '3.11.9',
      torch: {
        version: '2.12.0+cu130',
        cuda_runtime: '13.0',
        cuda_available: true
      }
    }
  };
}

function gpu() {
  return {
    available: true,
    backend: 'nvidia',
    executable: 'nvidia-smi',
    devices: [{
      index: 0,
      name: 'NVIDIA GeForce RTX 4090',
      uuid: 'GPU-test',
      memory_total_mib: 16311,
      memory_free_mib: 15000,
      driver_version: '610.47',
      compute_capability: '12.0'
    }],
    error: null
  };
}

test('Lab reuses verified state only while project metadata remains unchanged', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-state-cache-'));
  appendAudit(directory, { type: 'cache.seed' });
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  assert.equal(launched.server.keepAliveTimeout, 65_000);
  assert.equal(launched.server.headersTimeout, 70_000);
  assert.ok(launched.server.headersTimeout > launched.server.keepAliveTimeout);

  const first = await (await fetch(details.url + '/api/state')).json();
  const reused = await (await fetch(details.url + '/api/state')).json();
  assert.equal(first.integrity_cache.hit, false);
  assert.equal(reused.integrity_cache.hit, true);
  assert.equal(reused.integrity_cache.fingerprint, first.integrity_cache.fingerprint);
  assert.equal(reused.audit.ok, true);

  const compactResponse = await fetch(details.url + '/api/state');
  const compactBody = await compactResponse.text();
  const compactState = JSON.parse(compactBody);
  assert.equal(Number(compactResponse.headers.get('content-length')),
    Buffer.byteLength(compactBody));
  assert.ok(Buffer.byteLength(compactBody) < Buffer.byteLength(
    JSON.stringify(compactState, null, 2) + '\n'
  ));

  const created = await fetch(details.url + '/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: details.url },
    body: JSON.stringify({ agent: 'scientist' })
  });
  assert.equal(created.status, 201);
  const afterMutation = await (await fetch(details.url + '/api/state')).json();
  const settled = await (await fetch(details.url + '/api/state')).json();
  assert.equal(afterMutation.integrity_cache.hit, false);
  assert.equal(afterMutation.counts.chats, 1);
  assert.equal(settled.integrity_cache.hit, true);

  const events = path.join(directory, '.sciencecode', 'audit', 'events.jsonl');
  const before = fs.statSync(events);
  const source = fs.readFileSync(events, 'utf8');
  fs.writeFileSync(events, source.replace('cache.seed', 'cache.seee'));
  fs.utimesSync(events, before.atime, before.mtime);
  const tampered = await (await fetch(details.url + '/api/state')).json();
  assert.equal(tampered.integrity_cache.hit, false);
  assert.notEqual(tampered.integrity_cache.fingerprint, settled.integrity_cache.fingerprint);
  assert.equal(tampered.audit.ok, false);
  assert.ok(tampered.audit.errors.some((error) => error.issue === 'hash_mismatch'));

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-cache-link-'));
  fs.symlinkSync(
    outside,
    path.join(directory, '.sciencecode', 'cache-link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const linked = await (await fetch(details.url + '/api/state')).json();
  assert.equal(linked.integrity_cache.hit, false);
  assert.equal(linked.integrity_cache.strategy, 'disabled');
  assert.equal(linked.integrity_cache.fingerprint, null);
});

test('local lab serves verified state and only manifest-bound artifacts', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("lab simulation")\n');
  const simulation = runSimulation({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    seed: 7,
    runtime: runtime(),
    gpuProbe: gpu,
    runner(command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        device: {
          selected: 'cuda:0',
          name: 'NVIDIA GeForce RTX 4090',
          peak_memory_bytes: 1048576
        }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        model: 'Synthetic validation',
        final_statistics: { estimate: 0.125 }
      }));
      fs.writeFileSync(
        path.join(output, 'figure.png'),
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
      );
      fs.writeFileSync(path.join(output, 'workbook.xlsx'), Buffer.from('PK\u0003\u0004fixture'));
      fs.writeFileSync(path.join(output, 'candidates.smi'), 'CCO ethanol\nCC(=O)O acetate\n');
      fs.writeFileSync(path.join(output, 'variants.vcf'), [
        '##fileformat=VCFv4.3',
        '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
        'chr1\t42\trs-lab\tA\tG\t99\tPASS\tDP=30'
      ].join('\n') + '\n');
      fs.writeFileSync(path.join(output, 'report.md'), '# Result\n\nRecorded response: 18%.\n');
      return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
    }
  });

  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const root = await fetch(details.url + '/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await root.text(), /ScienceCode Research Workbench/);

  const workbookModule = await fetch(details.url + '/xlsx.js');
  assert.equal(workbookModule.status, 200);
  assert.equal(workbookModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await workbookModule.text(), /loadXlsxWorkbook/);
  const geometryModule = await fetch(details.url + '/geometry.js');
  assert.equal(geometryModule.status, 200);
  assert.equal(geometryModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await geometryModule.text(), /parseThreeD/);
  const visualizationModule = await fetch(details.url + '/visualization.js');
  assert.equal(visualizationModule.status, 200);
  assert.equal(visualizationModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await visualizationModule.text(), /buildPlotSeries/);
  const lineageModule = await fetch(details.url + '/lineage.js');
  assert.equal(lineageModule.status, 200);
  assert.equal(lineageModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await lineageModule.text(), /layoutLineage/);
  const chemistryModule = await fetch(details.url + '/chemistry.js');
  assert.equal(chemistryModule.status, 200);
  assert.equal(chemistryModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await chemistryModule.text(), /parseChemicalDocument/);
  const genomicsModule = await fetch(details.url + '/genomics.js');
  assert.equal(genomicsModule.status, 200);
  assert.equal(genomicsModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await genomicsModule.text(), /parseGenomeDocument/);
  const manuscriptModule = await fetch(details.url + '/manuscript.js');
  assert.equal(manuscriptModule.status, 200);
  assert.equal(manuscriptModule.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await manuscriptModule.text(), /diffManuscript/);
  const labApplication = await fetch(details.url + '/app.js');
  const labSource = await labApplication.text();
  assert.match(labSource, /openFigureStudio/);
  assert.match(labSource, /openDataPlotStudio/);
  assert.match(labSource, /renderEvidenceTools/);
  assert.match(labSource, /showEvidenceDetail/);
  assert.match(labSource, /saveInteraction\('evidence'/);
  assert.match(labSource, /saveInteraction\('plot', 'view\.saved'/);
  assert.match(labSource, /saveInteraction\('figure', action/);
  assert.match(labSource, /renderNotebookWorkspace/);
  assert.match(labSource, /saveInteraction\('notebook'/);
  assert.match(labSource, /openCodeStudio/);
  assert.match(labSource, /openWorkbookStudio/);
  assert.match(labSource, /openThreeDStudio/);
  assert.match(labSource, /openChemicalStudio/);
  assert.match(labSource, /openGenomeStudio/);
  assert.match(labSource, /openManuscriptStudio/);
  assert.match(labSource, /saveInteraction\('chemical'/);
  assert.match(labSource, /saveInteraction\('genome'/);
  assert.match(labSource, /saveInteraction\('manuscript'/);
  assert.match(labSource, /appendNativeSourceEditor/);
  assert.match(labSource, /renderLineageWorkspace/);
  assert.match(labSource, /saveInteraction\(\s*'lineage'/);
  assert.match(labSource, /function updatePendingResponse/);
  assert.match(labSource, /bounded live preview/);
  const labStyles = await (await fetch(details.url + '/styles.css')).text();
  assert.match(labStyles, /\.plot-viewer/);
  assert.match(labStyles, /\.figure-viewer/);
  assert.match(labStyles, /\.annotation-editor/);
  assert.match(labStyles, /\.evidence-tools/);
  assert.match(labStyles, /\.evidence-reader/);
  assert.match(labStyles, /\.notebook-workspace/);
  assert.match(labStyles, /\.lineage-workspace/);
  assert.match(labStyles, /\.lineage-canvas/);
  assert.match(labStyles, /\.chemical-workspace/);
  assert.match(labStyles, /\.genome-viewer/);
  assert.match(labStyles, /\.manuscript-workspace/);
  assert.match(labStyles, /\.native-source-editor/);
  assert.match(labStyles, /\.live-response-meta/);

  const stateResponse = await fetch(details.url + '/api/state');
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.sciencecode_version, VERSION);
  assert.equal(state.counts.simulations, 1);
  assert.equal(state.counts.verified, 1);
  assert.equal(state.counts.evidence, 0);
  assert.equal(state.simulations[0].summary.model, 'Synthetic validation');
  assert.equal(state.simulations[0].device.selected, 'cuda:0');
  const image = state.simulations[0].artifacts.find((artifact) => artifact.name === 'figure.png');
  assert.ok(image.url.startsWith('/artifact/'));

  const lineageResponse = await fetch(details.url + '/api/lineage');
  assert.equal(lineageResponse.status, 200);
  const lineage = await lineageResponse.json();
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.nodes.some((node) =>
    node.type === 'simulation' && node.record_id === simulation.manifest.simulation_id
  ));
  assert.ok(lineage.edges.some((edge) => edge.relation === 'produced'));

  const imageResponse = await fetch(details.url + image.url);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.ok((await imageResponse.arrayBuffer()).byteLength > 20);

  const workbook = state.simulations[0].artifacts.find((artifact) => artifact.name === 'workbook.xlsx');
  const workbookResponse = await fetch(details.url + workbook.url);
  assert.equal(workbookResponse.status, 200);
  assert.equal(
    workbookResponse.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  assert.equal(workbookResponse.headers.has('content-disposition'), false);

  for (const [name, mediaType] of [
    ['candidates.smi', 'chemical/x-daylight-smiles; charset=utf-8'],
    ['variants.vcf', 'text/plain; charset=utf-8'],
    ['report.md', 'text/markdown; charset=utf-8']
  ]) {
    const scientificArtifact = state.simulations[0].artifacts.find((item) => item.name === name);
    assert.ok(scientificArtifact?.url, name + ' should be recorded');
    const response = await fetch(details.url + scientificArtifact.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), mediaType);
    assert.equal(response.headers.has('content-disposition'), false);
    assert.ok((await response.text()).length > 8);
  }

  const simulationResponse = await fetch(
    details.url + '/api/simulations/' + encodeURIComponent(simulation.manifest.simulation_id)
  );
  const simulationDetail = await simulationResponse.json();
  assert.equal(simulationDetail.verification.ok, true);
  assert.equal(simulationDetail.manifest.seed, 7);

  fs.writeFileSync(path.join(simulation.runDirectory, 'artifacts', 'unrecorded.txt'), 'not in manifest');
  const unrecorded = await fetch(
    details.url + '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) + '/unrecorded.txt'
  );
  assert.equal(unrecorded.status, 404);
  const traversal = await fetch(
    details.url + '/artifact/' + encodeURIComponent(simulation.manifest.simulation_id) + '/%2e%2e/source.py'
  );
  assert.notEqual(traversal.status, 200);
});

test('local lab serves verified experiment aggregates and only manifest-bound experiment files', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-experiment-'));
  fs.writeFileSync(path.join(directory, 'model.py'), 'print("matrix")\n');
  const experiment = runExperiment({
    cwd: directory,
    packageRoot,
    script: 'model.py',
    name: 'Lab matrix',
    hypothesis: 'Alpha changes the estimate.',
    seeds: [3],
    variations: { alpha: [0.1, 0.2] },
    runtime: runtime(),
    gpuProbe: gpu,
    runner(command, args) {
      const output = args[args.indexOf('--output-dir') + 1];
      const parameters = JSON.parse(args[args.indexOf('--parameters-json') + 1]);
      fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
        status: 'completed',
        device: {
          selected: 'cuda:0',
          name: 'NVIDIA GeForce RTX 4090',
          peak_memory_bytes: 1048576
        }
      }));
      fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
        model: 'Lab matrix branch',
        final_statistics: { estimate: parameters.alpha * 10 }
      }));
      return { status: 0, stdout: 'complete\n', stderr: '', signal: null };
    }
  });

  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const stateResponse = await fetch(details.url + '/api/state');
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.counts.experiments, 1);
  assert.equal(state.counts.verified_experiments, 1);
  assert.equal(state.experiments[0].review.verdict, 'pass');
  assert.equal(state.experiments[0].review.numeric_aggregates.estimate.count, 2);
  assert.equal(state.experiments[0].results.length, 2);

  const experimentId = experiment.manifest.experiment_id;
  const detailResponse = await fetch(
    details.url + '/api/experiments/' + encodeURIComponent(experimentId)
  );
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.verification.ok, true);
  assert.equal(detail.plan.hypothesis, 'Alpha changes the estimate.');
  assert.equal(detail.results.results.length, 2);

  const summary = await fetch(
    details.url + '/experiment-artifact/' + encodeURIComponent(experimentId) + '/summary.csv'
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(await summary.text(), /parameter\.alpha/);

  fs.writeFileSync(path.join(experiment.experimentDirectory, 'unrecorded.txt'), 'not in manifest');
  const unrecorded = await fetch(
    details.url + '/experiment-artifact/' + encodeURIComponent(experimentId) + '/unrecorded.txt'
  );
  assert.equal(unrecorded.status, 404);
  const traversal = await fetch(
    details.url + '/experiment-artifact/' + encodeURIComponent(experimentId) + '/%2e%2e/manifest.json'
  );
  assert.notEqual(traversal.status, 200);
});

test('local lab provides same-origin recorded chat creation, continuation, and transcript retrieval', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-chat-'));
  const records = new Map();
  let sentOptions = null;
  const chatProvider = {
    list() {
      return [...records.values()].map((detail) => ({
        chat_id: detail.manifest.chat_id,
        title: detail.manifest.title,
        agent: detail.manifest.agent,
        status: 'active',
        turn_count: detail.turns.length,
        started_at: detail.manifest.started_at,
        updated_at: detail.manifest.updated_at
      }));
    },
    create({ agent }) {
      const detail = {
        manifest: {
          chat_id: 'chat-test-session',
          title: 'New research conversation',
          agent,
          status: 'active',
          turn_count: 0,
          turn_head_sha256: null,
          started_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:00:00.000Z'
        },
        turns: [],
        verification: { ok: true, errors: [] }
      };
      records.set(detail.manifest.chat_id, detail);
      return detail;
    },
    get({ chatId }) {
      const detail = records.get(chatId);
      if (!detail) throw Object.assign(new Error('Chat not found'), { code: 'CHAT_NOT_FOUND' });
      return detail;
    },
    send(options) {
      sentOptions = options;
      const detail = records.get(options.chatId);
      const turn = {
        chat_id: options.chatId,
        turn_index: 1,
        status: 'completed',
        run_id: 'run-chat-test',
        user: { text: options.message },
        assistant: { text: 'A grounded answer.' },
        linked_records: []
      };
      detail.turns.push(turn);
      detail.manifest.turn_count = 1;
      detail.manifest.title = 'Test the evidence';
      detail.manifest.turn_head_sha256 = 'b'.repeat(64);
      return { turn, manifest_sha256: 'c'.repeat(64) };
    }
  };
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() }),
    chatProvider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const root = await fetch(details.url);
  assert.match(await root.text(), /CONVERSATIONAL SCIENCE HARNESS/);
  const createResponse = await fetch(details.url + '/api/chats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: details.url
    },
    body: JSON.stringify({ agent: 'scientist' })
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.manifest.chat_id, 'chat-test-session');

  const messageResponse = await fetch(details.url + '/api/chats/chat-test-session/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: details.url
    },
    body: JSON.stringify({ message: 'Test the evidence.' })
  });
  assert.equal(messageResponse.status, 200);
  const message = await messageResponse.json();
  assert.equal(message.turn.assistant.text, 'A grounded answer.');
  assert.equal(message.chat.verification.ok, true);
  assert.equal(sentOptions.cwd, directory);
  assert.equal(sentOptions.packageRoot, packageRoot);
  assert.match(sentOptions.configDir, /opencode$/);

  const detailResponse = await fetch(details.url + '/api/chats/chat-test-session');
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.turns.length, 1);
  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.chats, 1);
  assert.equal(state.counts.chat_turns, 1);

  const crossOrigin = await fetch(details.url + '/api/chats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://untrusted.example'
    },
    body: '{}'
  });
  assert.equal(crossOrigin.status, 403);
  const wrongType = await fetch(details.url + '/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}'
  });
  assert.equal(wrongType.status, 415);
  const stateMutation = await fetch(details.url + '/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(stateMutation.status, 405);
  assert.equal(stateMutation.headers.get('allow'), 'GET, HEAD');
});

test('local lab runs an asynchronous harness job and records interactive user direction', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-harness-'));
  const created = createChatSession({ cwd: directory, agent: 'scientist' });
  const chatId = created.manifest.chat_id;
  const provider = {
    list({ cwd }) {
      return listChats(cwd);
    },
    get({ cwd, chatId: requested }) {
      return {
        ...getChatSession(cwd, requested),
        verification: verifyChat(cwd, requested)
      };
    },
    async sendAsync(options) {
      if (options.message === 'Trigger a safe failure.') {
        throw Object.assign(new Error('tool failed with token=supersecretvalue123'), {
          code: 'ENGINE_TEST_FAILURE'
        });
      }
      return sendChatMessageAsync({
        ...options,
        opencode: process.execPath,
        scienceCodeHome: path.join(directory, '.engine-home'),
        async runner(command, args, runOptions) {
          const lines = [
            JSON.stringify({ type: 'step_start', sessionID: 'ses_lab_async', part: { type: 'step-start' } }),
            JSON.stringify({
              type: 'tool_use',
              sessionID: 'ses_lab_async',
              part: {
                tool: 'read',
                callID: 'call-lab-read',
                state: {
                  status: 'completed',
                  title: 'Inspect candidate evidence',
                  input: { path: 'private-input.csv' },
                  output: 'private output values'
                }
              }
            }),
            JSON.stringify({
              type: 'text',
              sessionID: 'ses_lab_async',
              part: { type: 'text', text: 'Recorded the user direction and evidence review.' }
            }),
            JSON.stringify({ type: 'step_finish', sessionID: 'ses_lab_async', part: { type: 'step-finish' } })
          ];
          const first = lines.slice(0, 2).join('\n') + '\n';
          const second = lines.slice(2).join('\n') + '\n';
          runOptions.onStdout(first);
          await new Promise((resolve) => setTimeout(resolve, 10));
          runOptions.onStdout(second);
          return { status: 0, signal: null, stderr: '', stdout: first + second, error: null };
        }
      });
    }
  };
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() }),
    chatProvider: provider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const interactionResponse = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/interactions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: details.url },
      body: JSON.stringify({
        surface: 'design',
        action: 'direction.saved',
        artifact: null,
        payload: { note: 'Focus the outcome board on the safer candidate.' }
      })
    }
  );
  assert.equal(interactionResponse.status, 201);
  const interaction = await interactionResponse.json();
  assert.equal(interaction.verification.ok, true);
  assert.equal(interaction.interaction.surface, 'design');

  const plotInteractionResponse = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/interactions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: details.url },
      body: JSON.stringify({
        surface: 'plot',
        action: 'view.saved',
        artifact: {
          kind: 'experiment',
          record_id: 'experiment-plot',
          name: 'screen.csv',
          url: '/experiment-artifact/experiment-plot/screen.csv'
        },
        payload: {
          x_label: 'dose',
          y_label: 'response',
          point_count: 12,
          selected: { row: 4, x: 10, y: 0.62 },
          instruction: 'Review this response point.'
        }
      })
    }
  );
  assert.equal(plotInteractionResponse.status, 201);
  const plotInteraction = await plotInteractionResponse.json();
  assert.equal(plotInteraction.verification.ok, true);
  assert.equal(plotInteraction.interaction.surface, 'plot');

  const messageResponse = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: details.url,
        Prefer: 'respond-async'
      },
      body: JSON.stringify({ message: 'Review drug candidates and their evidence.', async: true })
    }
  );
  assert.equal(messageResponse.status, 202);
  let job = await messageResponse.json();
  assert.match(job.job_id, /^job-/);
  for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    const response = await fetch(details.url + '/api/jobs/' + encodeURIComponent(job.job_id));
    assert.equal(response.status, 200);
    job = await response.json();
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.result.turn_index, 1);
  assert.equal(job.response.transport, 'opencode_json_text_parts');
  assert.equal(job.response.granularity, 'completed_text_block');
  assert.equal(job.response.token_streaming, false);
  assert.equal(job.response.complete, true);
  assert.equal(job.response.received_block_count, 1);
  assert.equal(job.response.retained_block_count, 1);
  assert.match(job.response.blocks[0].content, /Recorded the user direction/);
  assert.ok(job.events.some((event) => event.type === 'tool' && event.tool === 'read'));
  const responseEvent = job.events.find((event) => event.type === 'response.block');
  assert.equal(responseEvent.preview_available, true);
  assert.equal('content' in responseEvent, false);
  assert.ok(job.events.some((event) => event.type === 'outcome.recorded'));
  assert.equal(JSON.stringify(job).includes('private-input.csv'), false);
  assert.equal(JSON.stringify(job).includes('private output values'), false);

  const harnessResponse = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/harness'
  );
  assert.equal(harnessResponse.status, 200);
  const harness = await harnessResponse.json();
  assert.equal(harness.workflow.id, 'drug_discovery');
  assert.equal(harness.interactions.count, 2);
  assert.equal(harness.board.validation.interactions_verified, true);
  assert.ok(harness.activity.some((event) => event.type === 'user.direction.saved'));
  assert.equal(harness.job.status, 'completed');

  const interactionsResponse = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/interactions'
  );
  const interactions = await interactionsResponse.json();
  assert.equal(interactions.verification.ok, true);
  assert.equal(interactions.interactions.length, 2);
  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.interactions, 2);
  assert.equal(state.harness.asynchronous, true);

  const lineageResponse = await fetch(
    details.url + '/api/lineage?chat=' + encodeURIComponent(chatId)
  );
  assert.equal(lineageResponse.status, 200);
  const lineage = await lineageResponse.json();
  assert.equal(lineage.scope.chat_id, chatId);
  assert.equal(lineage.integrity.ok, true);
  assert.equal(lineage.summary.by_type.interaction, 2);
  assert.ok(lineage.edges.some((edge) => edge.relation === 'informed'));
  assert.ok(lineage.nodes.some((node) => node.type === 'turn' && node.record_id === '1'));

  const failedResponse = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/messages',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: details.url, Prefer: 'respond-async' },
      body: JSON.stringify({ message: 'Trigger a safe failure.', async: true })
    }
  );
  assert.equal(failedResponse.status, 202);
  let failedJob = await failedResponse.json();
  for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(failedJob.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    failedJob = await (await fetch(
      details.url + '/api/jobs/' + encodeURIComponent(failedJob.job_id)
    )).json();
  }
  assert.equal(failedJob.status, 'failed');
  assert.equal(JSON.stringify(failedJob).includes('supersecretvalue123'), false);
  assert.match(failedJob.error.message, /\[REDACTED\]/);
});

test('local lab independently redacts, deduplicates, and bounds live provider response blocks', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-live-bounds-'));
  const created = createChatSession({ cwd: directory, agent: 'scientist' });
  const chatId = created.manifest.chat_id;
  const provider = {
    list({ cwd }) {
      return listChats(cwd);
    },
    get({ cwd, chatId: requested }) {
      return {
        ...getChatSession(cwd, requested),
        verification: verifyChat(cwd, requested)
      };
    },
    async sendAsync(options) {
      for (let index = 0; index < 40; index += 1) {
        options.onEvent({
          type: 'response.block',
          timestamp: '2026-08-10T12:02:' + String(index).padStart(2, '0') + '.000Z',
          part_id: 'part-' + index,
          message_id: 'message-bounded',
          content: 'block ' + index + ' sk-1234567890abcdefghijkl ' + '🧪'.repeat(5_000)
        });
      }
      options.onEvent({
        type: 'response.block',
        timestamp: '2026-08-10T12:03:00.000Z',
        part_id: 'part-39',
        message_id: 'message-bounded',
        content: 'revised final block'
      });
      return {
        turn: {
          turn_index: 1,
          run_id: 'run-live-bounds',
          status: 'completed'
        },
        manifest_sha256: 'a'.repeat(64)
      };
    }
  };
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() }),
    chatProvider: provider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));

  const response = await fetch(
    details.url + '/api/chats/' + encodeURIComponent(chatId) + '/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: details.url,
        Prefer: 'respond-async'
      },
      body: JSON.stringify({ message: 'Exercise the bounded live transport.', async: true })
    }
  );
  assert.equal(response.status, 202);
  let job = await response.json();
  for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(job.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    job = await (await fetch(
      details.url + '/api/jobs/' + encodeURIComponent(job.job_id)
    )).json();
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.response.received_block_count, 40);
  assert.ok(job.response.retained_block_count <= 32);
  assert.ok(job.response.retained_bytes <= 48 * 1024);
  assert.ok(job.response.omitted_block_count > 0);
  assert.ok(job.response.omitted_bytes > 0);
  assert.equal(job.response.truncated, true);
  assert.equal(job.response.blocks.at(-1).content, 'revised final block');
  assert.ok(job.response.blocks.every((block) =>
    block.content_bytes <= 8 * 1024 &&
    block.content_bytes === Buffer.byteLength(block.content, 'utf8')
  ));
  assert.equal(JSON.stringify(job).includes('sk-1234567890abcdefghijkl'), false);
  assert.ok(job.events.filter((event) => event.type === 'response.block')
    .every((event) => !('content' in event)));
});

test('local lab cancels an active turn, preserves partial evidence, and exposes the stop to the AI', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-cancel-'));
  const created = createChatSession({ cwd: directory, agent: 'scientist' });
  const chatId = created.manifest.chat_id;
  const enginePrompts = [];
  let runnerCalls = 0;
  const provider = {
    list({ cwd }) {
      return listChats(cwd);
    },
    get({ cwd, chatId: requested }) {
      return {
        ...getChatSession(cwd, requested),
        verification: verifyChat(cwd, requested)
      };
    },
    sendAsync(options) {
      return sendChatMessageAsync({
        ...options,
        opencode: process.execPath,
        scienceCodeHome: path.join(directory, '.engine-home'),
        async runner(command, args, runOptions) {
          runnerCalls += 1;
          enginePrompts.push(args.at(-1));
          if (runnerCalls === 1) {
            const partial = [
              JSON.stringify({
                type: 'step_start',
                sessionID: 'ses_lab_cancel',
                part: { type: 'step-start' }
              }),
              JSON.stringify({
                type: 'text',
                sessionID: 'ses_lab_cancel',
                part: {
                  type: 'text',
                  text: 'Partial candidate ranking; incomplete because the user stopped this turn.'
                }
              })
            ].join('\n') + '\n';
            runOptions.onStdout(partial);
            await new Promise((resolve, reject) => {
              if (runOptions.signal.aborted) {
                resolve();
                return;
              }
              const timeout = setTimeout(
                () => reject(new Error('test cancellation signal was not delivered')),
                5_000
              );
              runOptions.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                resolve();
              }, { once: true });
            });
            return {
              status: null,
              signal: 'SIGTERM',
              stderr: '',
              stdout: partial,
              error: null,
              aborted: true
            };
          }
          const completed = [
            JSON.stringify({
              type: 'step_start',
              sessionID: 'ses_lab_cancel',
              part: { type: 'step-start' }
            }),
            JSON.stringify({
              type: 'text',
              sessionID: 'ses_lab_cancel',
              part: {
                type: 'text',
                text: 'Fresh bounded answer after acknowledging the cancelled partial result.'
              }
            }),
            JSON.stringify({
              type: 'step_finish',
              sessionID: 'ses_lab_cancel',
              part: { type: 'step-finish' }
            })
          ].join('\n') + '\n';
          runOptions.onStdout(completed);
          return {
            status: 0,
            signal: null,
            stderr: '',
            stdout: completed,
            error: null,
            aborted: false
          };
        }
      });
    }
  };
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() }),
    chatProvider: provider
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const mutate = (pathname, body, origin = details.url) => fetch(details.url + pathname, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Prefer: 'respond-async'
    },
    body: JSON.stringify(body)
  });
  const readJob = async (jobId) => {
    const response = await fetch(details.url + '/api/jobs/' + encodeURIComponent(jobId));
    assert.equal(response.status, 200);
    return response.json();
  };
  const waitFor = async (jobId, statuses) => {
    let job;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      job = await readJob(jobId);
      if (statuses.includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('job did not reach ' + statuses.join(' or ') + ': ' + job?.status);
  };

  const startedResponse = await mutate(
    '/api/chats/' + encodeURIComponent(chatId) + '/messages',
    { message: 'Rank these candidates, but stop promptly if I cancel.', async: true }
  );
  assert.equal(startedResponse.status, 202);
  const started = await startedResponse.json();
  const running = await waitFor(started.job_id, ['running']);
  assert.equal(running.response.complete, false);
  assert.equal(running.response.token_streaming, false);
  assert.equal(running.response.retained_block_count, 1);
  assert.match(running.response.blocks[0].content, /Partial candidate ranking/);
  assert.ok(running.events.some((event) =>
    event.type === 'response.block' &&
    event.preview_available === true &&
    !('content' in event)
  ));

  const cancelPath = '/api/jobs/' + encodeURIComponent(started.job_id) + '/cancel';
  const crossOrigin = await mutate(cancelPath, { chat_id: chatId }, 'https://untrusted.example');
  assert.equal(crossOrigin.status, 403);
  const mismatch = await mutate(cancelPath, { chat_id: 'chat-wrong' });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).error.code, 'JOB_CHAT_MISMATCH');

  const cancelResponse = await mutate(cancelPath, { chat_id: chatId });
  assert.equal(cancelResponse.status, 202);
  const cancelling = await cancelResponse.json();
  assert.equal(cancelling.status, 'cancelling');
  assert.equal(cancelling.can_cancel, false);
  assert.ok(cancelling.cancel_requested_at);
  assert.ok(cancelling.cancellation_interaction_id);

  const cancelled = await waitFor(started.job_id, ['cancelled']);
  assert.equal(cancelled.result.status, 'cancelled');
  assert.ok(cancelled.cancelled_at);
  assert.ok(cancelled.events.some((event) => event.type === 'harness.cancel_requested'));
  assert.ok(cancelled.events.some((event) =>
    event.type === 'run.finished' && event.status === 'cancelled'
  ));
  assert.ok(cancelled.events.some((event) => event.type === 'outcome.recorded'));
  assert.equal(cancelled.response.complete, true);
  assert.match(cancelled.response.blocks[0].content, /Partial candidate ranking/);

  const detail = getChatSession(directory, chatId);
  assert.equal(detail.turns.length, 1);
  assert.equal(detail.turns[0].status, 'cancelled');
  assert.equal(detail.turns[0].cancellation.reason, 'user_requested');
  assert.match(detail.turns[0].assistant.text, /Partial candidate ranking/);
  assert.equal(verifyChat(directory, chatId).ok, true);
  const runId = detail.turns[0].run_id;
  assert.equal(getRunManifest(directory, runId).status, 'cancelled');
  assert.equal(verifyRun(directory, runId).ok, true);
  const interactions = listInteractions(directory, chatId);
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].action, 'turn.cancel_requested');
  assert.match(interactions[0].payload.note, /partial output as incomplete/);

  const gatedProject = verifyProject(directory);
  assert.equal(gatedProject.ok, false);
  assert.equal(gatedProject.counts.cancelled_runs, 1);
  assert.ok(gatedProject.errors.some((error) => error.issue === 'failed_runs'));
  assert.equal(verifyProject(directory, { allowFailedRuns: true }).ok, true);

  const terminalCancel = await mutate(cancelPath, { chat_id: chatId });
  assert.equal(terminalCancel.status, 409);
  assert.equal((await terminalCancel.json()).error.code, 'JOB_NOT_CANCELLABLE');

  const followupResponse = await mutate(
    '/api/chats/' + encodeURIComponent(chatId) + '/messages',
    { message: 'Continue with a fresh bounded answer.', async: true }
  );
  assert.equal(followupResponse.status, 202);
  const followupStarted = await followupResponse.json();
  const followup = await waitFor(followupStarted.job_id, ['completed']);
  assert.equal(followup.result.turn_index, 2);
  assert.equal(runnerCalls, 2);
  assert.match(enginePrompts[1], /The user stopped the active AI turn/);
  assert.match(enginePrompts[1], /Continue with a fresh bounded answer/);

  const finalDetail = getChatSession(directory, chatId);
  assert.equal(finalDetail.turns[1].status, 'completed');
  assert.equal(finalDetail.turns[1].interaction_context.count, 1);
  assert.equal(verifyChat(directory, chatId).ok, true);
  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.harness.running_jobs, 0);
  assert.equal(state.harness.retained_jobs, 2);
});

test('local lab keeps an interactive Python namespace, restores it explicitly, and records AI-visible notebook actions', {
  skip: !python
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-kernel-'));
  const chat = createChatSession({ cwd: directory, agent: 'scientist' });
  const kernelManager = createKernelManager({
    cwd: directory,
    scienceCodeHome: path.join(directory, '.runtime-home'),
    executables: { python }
  });
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() }),
    kernelManager
  });
  const details = await launched.ready;
  const mutate = (pathname, body = {}, origin = details.url) => fetch(details.url + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body)
  });

  try {
    const initial = await (await fetch(details.url + '/api/kernels')).json();
    const initialPython = initial.kernels.find((item) => item.language === 'python');
    assert.equal(initialPython.available, true);
    assert.equal(initialPython.live, false);
    assert.equal(initialPython.recorded_execution_count, 0);

    const startedResponse = await mutate('/api/kernels/python/restart');
    assert.equal(startedResponse.status, 200);
    const started = await startedResponse.json();
    assert.equal(started.status.live, true);
    assert.equal(started.status.state_mode, 'empty');

    const firstResponse = await mutate('/api/kernels/python/execute', {
      code: 'lab_value = 10\nlab_value',
      timeout_ms: 30_000,
      chat_id: chat.manifest.chat_id
    });
    assert.equal(firstResponse.status, 201);
    const first = await firstResponse.json();
    assert.equal(first.cell.manifest.execution_count, 1);
    assert.equal(first.cell.result.result.repr, '10');
    assert.equal(first.verification.ok, true);

    const secondResponse = await mutate('/api/kernels/python/execute', {
      code: 'lab_value *= 3\nlab_value',
      timeout_ms: 30_000,
      chat_id: chat.manifest.chat_id
    });
    assert.equal(secondResponse.status, 201);
    const second = await secondResponse.json();
    assert.equal(second.cell.result.result.repr, '30');
    assert.equal(second.status.process_id, first.status.process_id);

    const sharedResponse = await mutate(
      '/api/chats/' + encodeURIComponent(chat.manifest.chat_id) + '/interactions',
      {
        surface: 'notebook',
        action: 'state.shared',
        artifact: {
          kind: 'kernel',
          record_id: 'kernel-python',
          name: 'python cell-000002',
          url: '/api/kernels/python/cells/cell-000002'
        },
        payload: {
          language: 'python',
          kernel_id: 'kernel-python',
          cell_id: 'cell-000002',
          execution_count: 2,
          status: 'completed',
          code_sha256: second.cell.manifest.code_sha256,
          result: second.cell.result.result.repr,
          variables: second.cell.result.variables,
          note: 'Use this user-reviewed state in the next analysis.'
        }
      }
    );
    assert.equal(sharedResponse.status, 201);
    const shared = await sharedResponse.json();
    assert.equal(shared.interaction.surface, 'notebook');
    assert.equal(shared.verification.ok, true);

    const restoredResponse = await mutate('/api/kernels/python/restart', { restore: true });
    assert.equal(restoredResponse.status, 200);
    const restored = await restoredResponse.json();
    assert.equal(restored.status.history_loaded, true);
    assert.equal(restored.status.restored_through, 2);

    const thirdResponse = await mutate('/api/kernels/python/execute', {
      code: 'lab_value + 2',
      timeout_ms: 30_000,
      chat_id: chat.manifest.chat_id
    });
    assert.equal(thirdResponse.status, 201);
    const third = await thirdResponse.json();
    assert.equal(third.cell.result.result.repr, '32');
    assert.equal(third.cell.manifest.state_base.mode, 'restored');

    const detailResponse = await fetch(details.url + '/api/kernels/python');
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.record.cells.length, 3);
    assert.equal(detail.record.verification.ok, true);
    const cellResponse = await fetch(details.url + '/api/kernels/python/cells/cell-000003');
    const cellDetail = await cellResponse.json();
    assert.equal(cellDetail.verification.ok, true);
    assert.equal(cellDetail.cell.source, 'lab_value + 2');

    const state = await (await fetch(details.url + '/api/state')).json();
    assert.equal(state.counts.kernels, 1);
    assert.equal(state.counts.kernel_cells, 3);
    assert.equal(state.counts.live_kernels, 1);
    assert.equal(state.counts.interactions, 1);

    const crossOrigin = await mutate('/api/kernels/python/execute', {
      code: 'lab_value = -1'
    }, 'https://untrusted.example');
    assert.equal(crossOrigin.status, 403);
    assert.equal(kernelManager.status('python').recorded_execution_count, 3);
  } finally {
    await new Promise((resolve) => launched.server.close(resolve));
  }

  assert.equal(kernelManager.status('python').live, false);
  assert.equal(fs.existsSync(path.join(
    directory, '.sciencecode', 'kernels', 'kernel-python', 'kernel.lock'
  )), false);
});

test('lab refuses non-loopback network binding', () => {
  assert.throws(
    () => startLab({
      cwd: process.cwd(),
      packageRoot,
      host: '0.0.0.0',
      port: 0
    }),
    { code: 'LAB_REMOTE_HOST_DENIED' }
  );
});

test('read routes require a loopback Host header, not only mutations', async (context) => {
  // A DNS-rebound page is same-origin to the browser, so Origin and
  // Sec-Fetch-Site cannot distinguish it. The Host header is what does.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-lab-host-'));
  appendAudit(directory, { type: 'host.seed' });
  const launched = startLab({
    cwd: directory,
    packageRoot,
    port: 0,
    computeProvider: () => ({ ok: true, gpu: gpu(), runtime: runtime() })
  });
  const details = await launched.ready;
  context.after(() => new Promise((resolve) => launched.server.close(resolve)));
  const port = launched.server.address().port;

  const request = (hostHeader, target) => new Promise((resolve) => {
    const call = http.request({
      host: '127.0.0.1',
      port,
      path: target,
      method: 'GET',
      headers: { Host: hostHeader }
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    call.on('error', () => resolve({ status: 0, body: '' }));
    call.end();
  });

  for (const target of ['/api/state', '/']) {
    const denied = await request('attacker.example.com:1234', target);
    assert.equal(denied.status, 403, target);
    assert.equal(JSON.parse(denied.body).error.code, 'UNTRUSTED_CHAT_ORIGIN');
  }

  for (const hostHeader of ['127.0.0.1:' + port, 'localhost:' + port]) {
    assert.equal((await request(hostHeader, '/api/state')).status, 200, hostHeader);
    assert.equal((await request(hostHeader, '/')).status, 200, hostHeader);
  }

  // The loopback UI itself keeps working through the normal client.
  assert.equal((await fetch(details.url + '/api/state')).status, 200);
});
