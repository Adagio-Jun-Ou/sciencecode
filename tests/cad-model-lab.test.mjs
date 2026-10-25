import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCadProject,
  buildLineageGraph,
  createCadProject,
  createChatSession,
  getExperimentManifest,
  getSimulationManifest,
  listInteractions,
  runExperimentAsync,
  runSimulationAsync,
  startLab,
  verifyExperiment,
  verifyProject,
  verifySimulation
} from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function triangleStl() {
  return [
    'solid triangle',
    ' facet normal 0 0 1',
    '  outer loop',
    '   vertex 0 0 0',
    '   vertex 20 0 0',
    '   vertex 0 20 0',
    '  endloop',
    ' endfacet',
    'endsolid triangle',
    ''
  ].join('\n');
}

function runtime() {
  return {
    healthy: true,
    profile: 'gpu',
    paths: { python: process.execPath },
    manifest: { schema_version: 1, packages: ['numpy==2.3.5'] },
    probe: {
      python: '3.11.9',
      torch: {
        version: '2.12.0',
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
      memory_total_mib: 16311,
      memory_free_mib: 12000,
      driver_version: '610.47',
      compute_capability: '12.0'
    }],
    error: null
  };
}

async function waitFor(baseUrl, jobId, statuses, timeoutMs = 8_000) {
  const wanted = new Set(statuses);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(baseUrl + '/api/jobs/' + encodeURIComponent(jobId));
    assert.equal(response.status, 200);
    const job = await response.json();
    if (wanted.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for job ' + jobId + ' to reach ' +
    [...wanted].join(', '));
}

async function waitForEvent(baseUrl, jobId, predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(baseUrl + '/api/jobs/' + encodeURIComponent(jobId));
    assert.equal(response.status, 200);
    const job = await response.json();
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for job event on ' + jobId);
}

test('Lab launches, verifies, links, and cancels CAD-bound model jobs', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sciencecode-cad-model-lab-'));
  const cad = createCadProject({
    cwd: directory,
    cadProjectId: 'cad-model-workspace',
    name: 'Model workspace'
  });
  const build = buildCadProject({
    cwd: directory,
    cadProjectId: cad.descriptor.cad_project_id,
    toolchain: {
      openscad: {
        available: true,
        path: process.execPath,
        version: 'OpenSCAD test'
      },
      slicer: {
        available: true,
        engine: 'PrusaSlicer',
        path: process.execPath,
        version: 'PrusaSlicer test'
      },
      policies: {
        printer_transmission: 'disabled',
        slicer_post_process: 'disabled'
      }
    },
    runner(command, args) {
      assert.equal(command, process.execPath);
      fs.writeFileSync(args[args.indexOf('-o') + 1], triangleStl());
      fs.writeFileSync(args[args.indexOf('--summary-file') + 1], JSON.stringify({
        geometry: {
          bounding_box: {
            min: [0, 0, 0],
            max: [20, 20, 0],
            size: [20, 20, 0]
          },
          facets: 1,
          simple: false
        }
      }));
      return { status: 0, signal: null, stdout: '', stderr: '' };
    }
  });
  fs.mkdirSync(path.join(directory, 'simulations'));
  fs.writeFileSync(
    path.join(directory, 'simulations', 'fixture-model.py'),
    'print("fixture model")\n'
  );
  const chat = createChatSession({
    cwd: directory,
    title: 'CAD model review',
    agent: 'cad-engineer'
  });
  const chatId = chat.manifest.chat_id;

  const simulationProvider = {
    run(options) {
      return runSimulationAsync({
        ...options,
        runtime: runtime(),
        gpuProbe: gpu,
        async runner(command, args, processOptions) {
          assert.equal(command, process.execPath);
          const output = args[args.indexOf('--output-dir') + 1];
          const parameters = JSON.parse(
            args[args.indexOf('--parameters-json') + 1]
          );
          if (parameters.hold === true) {
            fs.writeFileSync(
              path.join(output, 'partial-results.csv'),
              'step,value\n1,0.25\n'
            );
            processOptions.onStdout?.('partial model output\n');
            if (!processOptions.signal.aborted) {
              await new Promise((resolve) =>
                processOptions.signal.addEventListener('abort', resolve, {
                  once: true
                }));
            }
            return {
              status: null,
              signal: null,
              stdout: 'partial model output\n',
              stderr: '',
              error: Object.assign(new Error('Command cancelled.'), {
                name: 'AbortError',
                code: 'ABORT_ERR'
              }),
              aborted: true
            };
          }
          fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
            status: 'completed',
            device: { selected: 'cpu', name: 'CPU' },
            seed: 23
          }));
          fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
            model: 'fixture validation',
            classification: 'surface_graph_heat_diffusion_not_volumetric_fea',
            final: { minimum_c: 20, maximum_c: 80, mean_c: 35 },
            passed: true
          }));
          return {
            status: 0,
            signal: null,
            stdout: '{"passed":true}\n',
            stderr: '',
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
    computeProvider: () => ({
      ok: true,
      gpu: {
        available: true,
        devices: [{
          index: 0,
          name: 'NVIDIA GeForce RTX 4090',
          memory_total_mib: 16311,
          memory_free_mib: 512
        }]
      },
      npu: null,
      runtime: null
    }),
    experimentProvider: {
      run(options) {
        if (options.parameters?.invalid_cancelled_result === true) {
          const experimentId = 'experiment-invalid-cancelled-result';
          options.onStarted?.({
            experiment_id: experimentId,
            experiment_directory: path.join(directory, '.sciencecode', 'experiments', experimentId),
            branch_count: 1,
            plan_sha256: '0'.repeat(64)
          });
          return Promise.resolve({
            manifest: {
              experiment_id: experimentId,
              status: 'cancelled',
              cancellation: { cancelled_at: new Date().toISOString() },
              counts: { planned: 1, completed: 0, verified: 0 }
            },
            manifest_sha256: '1'.repeat(64),
            verification: {
              ok: false,
              errors: [{ issue: 'fixture_integrity_failure' }]
            },
            review: { verdict: 'fail', numeric_aggregates: {} }
          });
        }
        return runExperimentAsync({
          ...options,
          runtime: runtime(),
          gpuProbe: gpu,
          async runner(runtimeCommand, runtimeArgs, processOptions) {
            assert.equal(runtimeCommand, process.execPath);
            assert.equal(processOptions.env.SCIENCECODE_CAD_BUILD_ID,
              build.manifest.build_id);
            const output = runtimeArgs[runtimeArgs.indexOf('--output-dir') + 1];
            const seed = Number(runtimeArgs[runtimeArgs.indexOf('--seed') + 1]);
            const parameters = JSON.parse(
              runtimeArgs[runtimeArgs.indexOf('--parameters-json') + 1]
            );
            if (parameters.cancel_test === true &&
                parameters.thermal_diffusivity_mm2_s === 0.1) {
              fs.writeFileSync(
                path.join(output, 'partial-study.csv'),
                'step,value\n1,0.5\n'
              );
              processOptions.onStdout?.('partial study branch\n');
              if (!processOptions.signal.aborted) {
                await new Promise((resolve) =>
                  processOptions.signal.addEventListener('abort', resolve, {
                    once: true
                  }));
              }
              return {
                status: null,
                signal: null,
                stdout: 'partial study branch\n',
                stderr: '',
                error: Object.assign(new Error('Command cancelled.'), {
                  name: 'AbortError',
                  code: 'ABORT_ERR'
                }),
                aborted: true
              };
            }
            fs.writeFileSync(path.join(output, 'simulation-context.json'), JSON.stringify({
              status: 'completed',
              device: { selected: 'cpu', name: 'CPU' },
              seed
            }));
            fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({
              model: 'fixture thermal study',
              classification: 'surface_graph_heat_diffusion_not_volumetric_fea',
              final: {
                minimum_c: 20,
                maximum_c: 80,
                mean_c: 20 + parameters.thermal_diffusivity_mm2_s * 10
              },
              integration: { last_maximum_delta_c: 0.001 }
            }));
            return { status: 0, signal: null, stdout: 'complete\n', stderr: '' };
          }
        });
      }
    },
    simulationProvider
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
  const modelPath = '/api/cad/builds/' +
    encodeURIComponent(build.manifest.build_id) + '/models';
  const baseRequest = {
    script: 'simulations/fixture-model.py',
    device: 'cpu',
    seed: 23,
    parameters: { density_g_cm3: 1.24 },
    script_args: [],
    inputs: [],
    timeout_seconds: 30,
    chat_id: chatId,
    note: 'Run the fixture validation against this exact mesh.'
  };

  const invalid = await mutate(modelPath, {
    ...baseRequest,
    parameters: { 'bad parameter': 1 }
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_CAD_REQUEST');

  const lowGpu = await mutate(modelPath, {
    ...baseRequest,
    device: 'cuda',
    minimum_free_gpu_mib: 2_048
  });
  assert.equal(lowGpu.status, 409);
  assert.equal((await lowGpu.json()).error.code, 'CAD_GPU_MEMORY_LOW');

  const launchResponse = await mutate(modelPath, baseRequest);
  assert.equal(launchResponse.status, 202);
  const launchedJob = await launchResponse.json();
  assert.equal(launchedJob.kind, 'cad');
  assert.equal(launchedJob.operation, 'model');
  assert.equal(launchedJob.can_cancel, true);
  const completed = await waitFor(details.url, launchedJob.job_id, ['completed']);
  assert.ok(completed.simulation_id);
  assert.equal(completed.result.verification.ok, true);
  const completedManifest = getSimulationManifest(
    directory, completed.simulation_id
  );
  assert.equal(completedManifest.cad_parent.build_id, build.manifest.build_id);
  assert.equal(completedManifest.device_request, 'cpu');
  assert.equal(verifySimulation(directory, completed.simulation_id).ok, true);

  const studyPath = '/api/cad/builds/' +
    encodeURIComponent(build.manifest.build_id) + '/studies';
  const studyRequest = {
    script: 'simulations/fixture-model.py',
    device: 'cpu',
    seeds: [23],
    parameters: { steps: 20 },
    variations: { thermal_diffusivity_mm2_s: [0.05, 0.1, 0.2] },
    script_args: [],
    inputs: [],
    name: 'Fixture CAD thermal sensitivity',
    hypothesis: 'Changing normalized diffusivity changes the final mean.',
    timeout_seconds: 30,
    chat_id: chatId,
    note: 'Compare three bounded branches on the exact same mesh.'
  };
  const invalidStudy = await mutate(studyPath, {
    ...studyRequest,
    parameters: { thermal_diffusivity_mm2_s: 0.1 }
  });
  assert.equal(invalidStudy.status, 400);
  assert.equal((await invalidStudy.json()).error.code, 'INVALID_CAD_REQUEST');
  const oversizedStudy = await mutate(studyPath, {
    ...studyRequest,
    seeds: Array.from({ length: 9 }, (_, index) => index),
    variations: {
      thermal_diffusivity_mm2_s: Array.from({ length: 8 }, (_, index) => index / 10)
    }
  });
  assert.equal(oversizedStudy.status, 400);
  assert.equal((await oversizedStudy.json()).error.code, 'INVALID_CAD_REQUEST');
  const lowGpuStudy = await mutate(studyPath, {
    ...studyRequest,
    device: 'cuda',
    minimum_free_gpu_mib: 2_048
  });
  assert.equal(lowGpuStudy.status, 409);
  assert.equal((await lowGpuStudy.json()).error.code, 'CAD_GPU_MEMORY_LOW');
  const studyLaunchResponse = await mutate(studyPath, studyRequest);
  assert.equal(studyLaunchResponse.status, 202);
  const studyLaunch = await studyLaunchResponse.json();
  assert.equal(studyLaunch.operation, 'study');
  assert.equal(studyLaunch.can_cancel, true);
  assert.equal(studyLaunch.request.branch_count, 3);
  assert.equal(studyLaunch.request.wall_clock_timeout_seconds, 150);
  const study = await waitFor(details.url, studyLaunch.job_id, ['completed']);
  assert.ok(study.experiment_id);
  assert.equal(study.result.verification.ok, true);
  assert.equal(study.result.review.verdict, 'pass');
  assert.equal(study.result.review.numeric_aggregates.final_mean_c.count, 3);
  const studyManifest = getExperimentManifest(directory, study.experiment_id);
  assert.equal(studyManifest.cad_parent.build_id, build.manifest.build_id);
  assert.equal(studyManifest.counts.verified, 3);
  assert.equal(verifyExperiment(directory, study.experiment_id).ok, true);

  const invalidCancelledResponse = await mutate(studyPath, {
    ...studyRequest,
    parameters: { steps: 20, invalid_cancelled_result: true },
    variations: {},
    chat_id: undefined,
    note: 'Exercise fail-closed cancelled-study verification.'
  });
  assert.equal(invalidCancelledResponse.status, 202);
  const invalidCancelledLaunch = await invalidCancelledResponse.json();
  const invalidCancelled = await waitFor(
    details.url,
    invalidCancelledLaunch.job_id,
    ['failed']
  );
  assert.equal(invalidCancelled.error.code, 'CAD_OPERATION_FAILED');
  assert.match(invalidCancelled.error.message, /failed integrity verification/i);

  const cancelStudyLaunchResponse = await mutate(studyPath, {
    ...studyRequest,
    parameters: { steps: 20, cancel_test: true },
    note: 'Stop after one completed branch and preserve the partial comparison.'
  });
  assert.equal(cancelStudyLaunchResponse.status, 202);
  const cancelStudyLaunch = await cancelStudyLaunchResponse.json();
  assert.equal(cancelStudyLaunch.operation, 'study');
  assert.equal(cancelStudyLaunch.can_cancel, true);
  const runningStudy = await waitForEvent(
    details.url,
    cancelStudyLaunch.job_id,
    (job) => job.events.some((event) =>
      event.type === 'cad.study.branch.started' && event.branch_index === 1)
  );
  assert.ok(runningStudy.experiment_id);
  const responsiveState = await Promise.race([
    fetch(details.url + '/api/state').then(async (response) => ({
      status: response.status,
      body: await response.json()
    })),
    new Promise((resolve) => setTimeout(
      () => resolve({ status: 0, body: null }),
      2_000
    ))
  ]);
  assert.equal(responsiveState.status, 200);
  const recoveredStudyJob = responsiveState.body.cad_jobs.find(
    (job) => job.job_id === cancelStudyLaunch.job_id
  );
  assert.equal(recoveredStudyJob.operation, 'study');
  assert.equal(recoveredStudyJob.can_cancel, true);
  const cancelStudyPath = '/api/jobs/' +
    encodeURIComponent(cancelStudyLaunch.job_id) + '/cancel';
  const wrongStudyOperation = await mutate(cancelStudyPath, {
    kind: 'cad',
    operation: 'model',
    cad_project_id: cad.descriptor.cad_project_id,
    build_id: build.manifest.build_id,
    chat_id: chatId
  });
  assert.equal(wrongStudyOperation.status, 409);
  const cancelStudyResponse = await mutate(cancelStudyPath, {
    kind: 'cad',
    operation: 'study',
    cad_project_id: cad.descriptor.cad_project_id,
    build_id: build.manifest.build_id,
    chat_id: chatId
  });
  assert.equal(cancelStudyResponse.status, 202);
  const cancellingStudy = await cancelStudyResponse.json();
  assert.equal(cancellingStudy.status, 'cancelling');
  assert.ok(cancellingStudy.cancellation_interaction_id);
  const cancelledStudy = await waitFor(
    details.url,
    cancelStudyLaunch.job_id,
    ['cancelled']
  );
  assert.equal(cancelledStudy.result.manifest.status, 'cancelled');
  assert.equal(cancelledStudy.result.verification.ok, true);
  assert.equal(cancelledStudy.result.manifest.counts.planned, 3);
  assert.equal(cancelledStudy.result.manifest.counts.completed, 1);
  const cancelledStudyDetail = await (await fetch(
    details.url + '/api/experiments/' +
      encodeURIComponent(cancelledStudy.experiment_id)
  )).json();
  assert.equal(cancelledStudyDetail.manifest.cancellation.reason, 'user_requested');
  assert.deepEqual(
    cancelledStudyDetail.results.results.map((branch) => branch.status),
    ['completed', 'cancelled', 'not_run']
  );
  assert.equal(cancelledStudyDetail.verification.ok, true);
  const partialStudyBranch = cancelledStudyDetail.results.results[1];
  const partialStudyManifest = getSimulationManifest(
    directory,
    partialStudyBranch.simulation_id
  );
  assert.ok(partialStudyManifest.artifacts['artifacts/partial-study.csv']);
  assert.equal(verifyExperiment(directory, cancelledStudy.experiment_id).ok, true);

  const cancelLaunchResponse = await mutate(modelPath, {
    ...baseRequest,
    parameters: { hold: true },
    note: 'Start a cancellable convergence test.'
  });
  assert.equal(cancelLaunchResponse.status, 202);
  const cancelLaunch = await cancelLaunchResponse.json();
  const running = await waitFor(details.url, cancelLaunch.job_id, ['running']);
  assert.ok(running.simulation_id);

  const cancelPath = '/api/jobs/' + encodeURIComponent(cancelLaunch.job_id) +
    '/cancel';
  const mismatch = await mutate(cancelPath, {
    kind: 'cad',
    operation: 'model',
    cad_project_id: cad.descriptor.cad_project_id,
    build_id: 'cad-build-wrong',
    chat_id: chatId
  });
  assert.equal(mismatch.status, 409);
  const cancelResponse = await mutate(cancelPath, {
    kind: 'cad',
    operation: 'model',
    cad_project_id: cad.descriptor.cad_project_id,
    build_id: build.manifest.build_id,
    chat_id: chatId
  });
  assert.equal(cancelResponse.status, 202);
  const cancelling = await cancelResponse.json();
  assert.equal(cancelling.status, 'cancelling');
  assert.ok(cancelling.cancellation_interaction_id);
  const cancelled = await waitFor(details.url, cancelLaunch.job_id, ['cancelled']);
  assert.equal(cancelled.result.status, 'cancelled');
  assert.equal(cancelled.result.verification.ok, true);

  const cancelledManifest = getSimulationManifest(
    directory, cancelled.simulation_id
  );
  assert.equal(cancelledManifest.status, 'cancelled');
  assert.equal(cancelledManifest.cancellation.reason, 'user_requested');
  assert.ok(cancelledManifest.artifacts['artifacts/partial-results.csv']);
  assert.equal(verifySimulation(directory, cancelled.simulation_id).ok, true);

  const state = await (await fetch(details.url + '/api/state')).json();
  assert.equal(state.counts.simulations, 7);
  assert.equal(state.counts.cancelled_simulations, 2);
  assert.equal(state.counts.cancelled_experiments, 1);
  assert.ok(state.simulations.some((simulation) =>
    simulation.simulation_id === completed.simulation_id &&
    simulation.cad_parent.build_id === build.manifest.build_id
  ));
  assert.ok(state.experiments.some((experiment) =>
    experiment.experiment_id === study.experiment_id &&
    experiment.cad_parent.build_id === build.manifest.build_id
  ));
  const harness = await (await fetch(details.url + '/api/chats/' +
    encodeURIComponent(chatId) + '/harness')).json();
  assert.equal(harness.board.cad.safety.model_cancellation,
    'verified_partial_record');
  assert.equal(harness.board.cad.safety.study_cancellation,
    'verified_partial_experiment_record');
  assert.equal(harness.board.cad.safety.gpu_dispatch,
    'fresh_free_memory_gate');
  assert.equal(harness.board.cad.safety.surface_thermal_solver,
    'bounded_surface_graph_diffusion_not_volumetric_fea');
  assert.equal(harness.board.cad.safety.scalar_field_interaction,
    'vertex_selection_visible_to_next_ai_turn');
  assert.equal(harness.board.cad.surface_thermal_models.length, 5);
  assert.equal(harness.board.cad.parameter_studies.length, 2);
  assert.equal(harness.board.cad.safety.comparative_studies,
    'bounded_matrix_on_one_verified_immutable_mesh_not_fea_validation');
  assert.equal(harness.board.computation.cad_parameter_studies, 2);
  assert.equal(harness.board.computation.cancelled_cad_parameter_studies, 1);
  assert.equal(harness.board.validation.verified_cad_parameter_studies, 2);
  assert.equal(harness.board.validation.passing_cad_parameter_studies, 1);
  assert.equal(harness.board.validation.cancelled_cad_parameter_studies, 1);
  assert.equal(harness.board.validation.cad_parameter_studies_needing_attention, 1);
  assert.equal(harness.board.computation.cancelled_cad_linked_models, 2);
  assert.equal(harness.board.validation.cad_surface_thermal_models, 5);
  assert.equal(harness.board.validation.cad_models_needing_attention, 2);
  const lineage = buildLineageGraph(directory);
  assert.equal(lineage.integrity.ok, true);
  assert.ok(lineage.edges.some((edge) =>
    edge.source === 'cad-build:' + build.manifest.build_id &&
    edge.target === 'experiment:' + study.experiment_id &&
    edge.relation === 'modeled_by' && edge.metadata?.study === true
  ));
  assert.ok(lineage.edges.some((edge) =>
    edge.source === 'cad-build:' + build.manifest.build_id &&
    edge.target === 'experiment:' + cancelledStudy.experiment_id &&
    edge.relation === 'modeled_by' && edge.metadata?.study === true
  ));
  assert.deepEqual(listInteractions(directory, chatId).map((record) =>
    record.action), [
    'model.completed',
    'study.completed',
    'study.cancel_requested',
    'study.cancelled',
    'model.cancel_requested',
    'model.cancelled'
  ]);
  const gated = verifyProject(directory);
  assert.equal(gated.ok, false);
  assert.equal(gated.counts.cancelled_simulations, 2);
  assert.equal(gated.counts.cancelled_experiments, 1);
  assert.equal(verifyProject(directory, {
    allowFailedSimulations: true,
    allowFailedExperiments: true
  }).ok, true);
});
