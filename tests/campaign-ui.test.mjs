import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCampaignSpec } from '../lib/campaigns.js';
import { defaultCampaignSpec } from '../lab/campaign.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the accelerated campaign template is strict, bounded, and separates GPU from NPU work', () => {
  const normalized = normalizeCampaignSpec(defaultCampaignSpec('ScienceCode test project'));
  assert.equal(normalized.hypotheses.length, 2);
  assert.equal(normalized.hypotheses[0].relation, 'root');
  assert.equal(normalized.hypotheses[1].parent_id, normalized.hypotheses[0].id);
  assert.equal(normalized.hypotheses[1].relation, 'alternative');
  assert.equal(normalized.hypotheses[0].budget.max_gpu_tasks, 2);
  assert.equal(normalized.hypothesis_policy.require_final_assessment, true);
  assert.equal(normalized.hypothesis_policy.human_adjudication, true);
  assert.equal(normalized.hypothesis_policy.automatic_pruning, false);
  assert.deepEqual(normalized.tasks.map((task) => task.compute), ['cpu', 'gpu', 'npu', 'cpu']);
  assert.ok(normalized.tasks.every((task) => task.checkpoint));
  assert.equal(normalized.tasks.at(-1).lane, 'reviewer');
  assert.deepEqual(normalized.tasks.at(-1).depends_on, ['gpu_sensitivity', 'npu_screen']);
  assert.equal(normalized.budget.max_gpu_tasks, 2);
  assert.equal(normalized.budget.max_npu_tasks, 2);
  assert.equal(normalized.execution_policy.physical_execution, 'disabled');
  assert.equal(normalized.execution_policy.artifact_scope, 'project_only');
  assert.equal(normalized.execution_policy.ai_disclosure, true);
  assert.equal(normalized.execution_policy.enforcement.network, 'prompt_policy_not_an_os_sandbox');

  const fileTemplate = normalizeCampaignSpec(JSON.parse(
    fs.readFileSync(path.join(root, 'templates', 'campaign.json'), 'utf8')
  ));
  assert.deepEqual(fileTemplate.tasks.map((task) => task.compute),
    ['cpu', 'gpu', 'npu', 'cpu']);
  assert.equal(fileTemplate.hypotheses[1].relation, 'alternative');
  assert.equal(fileTemplate.hypothesis_policy.automatic_pruning, false);
});

test('the Lab exposes campaign navigation, interactive controls, and a dedicated responsive surface', () => {
  const app = fs.readFileSync(path.join(root, 'lab', 'app.js'), 'utf8');
  const module = fs.readFileSync(path.join(root, 'lab', 'campaign.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'lab', 'campaign.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'lab', 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'lib', 'lab.js'), 'utf8');

  assert.match(html, /data-view="campaigns"/);
  assert.match(html, /href="\/campaign\.css"/);
  assert.match(app, /renderCampaignWorkspace/);
  assert.match(app, /harness-campaign-row/);
  assert.match(app, /campaign\.next_hypothesis/);
  assert.match(app, /current verdicts/);
  assert.match(module, /Run exactly one AI turn/);
  assert.match(module, /task\.selected/);
  assert.match(module, /hypothesis\.selected/);
  assert.match(module, /Record human assessment/);
  assert.match(module, /local-user checkpoint.*AI may recommend/is);
  assert.match(module, /\/hypotheses\/.*\/assessments/);
  assert.match(module, /COMPLETED TASK BASIS/);
  assert.match(module, /assessment_stale/);
  assert.match(module, /required after latest work/);
  assert.match(module, /kind: 'campaign'/);
  assert.match(module, /Stop this exact task/);
  assert.match(module, /prompt policy_not_an_os_sandbox|prompt\/human policies/);
  assert.match(styles, /\.campaign-task-studio/);
  assert.match(styles, /\.campaign-live-response/);
  assert.match(styles, /\.campaign-hypothesis-inspector/);
  assert.match(styles, /\.campaign-assessment-tasks/);
  assert.match(styles, /@media \(max-width: 680px\)/);
  assert.match(server, /'campaign\.js'/);
  assert.match(server, /'campaign\.css'/);
  assert.match(server, /hypotheses\\\/\(\[\^\/\]\+\)\\\/assessments|campaignAssessmentMatch/);
});
