export const PROJECT_GATE_POLICY_OPTIONS = Object.freeze([
  Object.freeze({
    name: 'allow_failed_runs',
    label: 'AI research turns',
    description: 'Accept recorded turns that ended failed or cancelled as known outcomes.'
  }),
  Object.freeze({
    name: 'allow_failed_simulations',
    label: 'Simulations',
    description: 'Accept recorded simulation outcomes that did not complete successfully.'
  }),
  Object.freeze({
    name: 'allow_failed_cad_builds',
    label: 'CAD builds',
    description: 'Accept recorded CAD build failures while retaining their provenance.'
  }),
  Object.freeze({
    name: 'allow_failed_cad_slices',
    label: 'CAD slices',
    description: 'Accept recorded slicing failures or incomplete preview outcomes.'
  }),
  Object.freeze({
    name: 'allow_failed_inferences',
    label: 'AI inference runs',
    description: 'Accept failed or cancelled accelerator inference outcomes.'
  }),
  Object.freeze({
    name: 'allow_failed_experiments',
    label: 'Experiment matrices',
    description: 'Accept experiment records with failed or cancelled branches.'
  }),
  Object.freeze({
    name: 'allow_failed_kernel_cells',
    label: 'Notebook cells',
    description: 'Accept recorded notebook cell executions with failed outcomes.'
  }),
  Object.freeze({
    name: 'allow_failed_campaign_tasks',
    label: 'Campaign tasks',
    description: 'Accept bounded research campaign tasks with failed outcomes.'
  })
]);

const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function compact(value, limit = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '\u2026' : text;
}

function formatDate(value) {
  if (!value) return 'not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) :
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(date);
}

function metric(label, value, tone = '') {
  const card = create('div', 'verification-metric ' + tone);
  card.append(create('span', '', label), create('strong', '', String(value)));
  return card;
}

export function projectGateViewModel(report) {
  const summary = report?.summary ?? {};
  const blockers = Number(summary.blockers ?? 0);
  const integrity = Number(summary.integrity_blockers ?? 0);
  const outcomes = Number(summary.outcome_blockers ?? 0);
  const accepted = Number(summary.accepted_failed_outcomes ?? 0);
  return {
    ok: report?.ok === true,
    blockers,
    integrity,
    outcomes,
    accepted,
    returned: Number(summary.returned_issues ?? 0),
    omitted: Number(summary.omitted_issues ?? 0),
    truncated: summary.truncated === true,
    status: report?.ok === true ? 'pass' : 'blocked'
  };
}

export function projectGateIssueView(issue, { includeDetails = true } = {}) {
  const category = issue?.category === 'outcome' ? 'outcome' : 'integrity';
  const identity = Object.entries(issue?.record ?? {})
    .map(([key, value]) => key.replaceAll('_', ' ') + ' ' + value)
    .join(' / ');
  return {
    category,
    categoryLabel: category === 'integrity'
      ? 'Integrity blocker'
      : 'Outcome blocker',
    title: compact(issue?.title ?? issue?.issue ?? 'Verification failed', 160),
    identity: compact(identity, 240),
    details: includeDetails
      ? JSON.stringify(issue?.details ?? null, null, 2)
      : null,
    truncated: issue?.detail_truncated === true,
    digest: String(issue?.detail_sha256 ?? '')
  };
}

function reportPanel(report) {
  const model = projectGateViewModel(report);
  const panel = create('section', 'verification-report ' + model.status);
  panel.setAttribute('aria-labelledby', 'verification-result-title');
  const heading = create(
    'h2',
    '',
    model.ok ? 'Project gate passed' : 'Project gate found blockers'
  );
  heading.id = 'verification-result-title';
  heading.tabIndex = -1;
  const lead = create('p', 'verification-report-lead', model.ok
    ? 'Every current record passed the selected integrity and outcome policy.'
    : 'The report below distinguishes immutable-record integrity failures from recorded failed outcomes.');
  const identity = create('div', 'verification-report-identity');
  identity.append(
    create('span', '', 'Verified ' + formatDate(report.generated_at)),
    create('code', '', 'report ' + compact(report.fingerprint, 24))
  );
  const metrics = create('div', 'verification-metrics');
  metrics.append(
    metric('Gate', model.ok ? 'PASS' : 'BLOCKED', model.ok ? 'pass' : 'blocked'),
    metric('Integrity blockers', model.integrity, model.integrity ? 'blocked' : 'pass'),
    metric('Outcome blockers', model.outcomes, model.outcomes ? 'attention' : 'pass'),
    metric('Accepted failures', model.accepted, model.accepted ? 'attention' : '')
  );
  panel.append(heading, lead, identity, metrics);

  const anchors = create('dl', 'verification-anchors');
  for (const [label, value] of [
    ['Audit head', report.anchors?.audit_head_hash],
    ['Lineage graph', report.anchors?.lineage_graph_sha256]
  ]) {
    anchors.append(create('dt', '', label), create('dd', '', value || 'No records yet'));
  }
  panel.append(anchors);

  if (Array.isArray(report.issues) && report.issues.length) {
    const issueSection = create('section', 'verification-issues');
    issueSection.append(create('h3', '', 'Blocking findings'));
    if (model.truncated) {
      issueSection.append(create(
        'p',
        'verification-limit-note',
        model.omitted
          ? model.omitted + ' additional finding(s) were omitted from this bounded Lab report.'
          : 'At least one diagnostic was shortened to keep this Lab report bounded.'
      ));
    }
    for (const issue of report.issues) {
      const view = projectGateIssueView(issue, { includeDetails: false });
      const details = create('details', 'verification-issue ' + view.category);
      const summary = create('summary');
      const labels = create('span', 'verification-issue-labels');
      labels.append(
        create('b', '', view.categoryLabel),
        create('strong', '', view.title)
      );
      summary.append(labels);
      if (view.identity) summary.append(create('small', '', view.identity));
      details.append(summary);
      let populated = false;
      details.addEventListener('toggle', () => {
        if (!details.open || populated) return;
        populated = true;
        const body = create('div', 'verification-issue-body');
        if (view.truncated) {
          body.append(create(
            'p',
            'verification-limit-note',
            'Diagnostic shortened in the Lab response. Its SHA-256 fingerprint still identifies the complete redacted finding.'
          ));
        }
        if (view.digest) body.append(create('code', 'verification-digest', view.digest));
        body.append(create('pre', '', JSON.stringify(issue?.details ?? null, null, 2)));
        details.append(body);
      });
      issueSection.append(details);
    }
    panel.append(issueSection);
  } else if (model.ok) {
    const clear = create('div', 'verification-clear');
    clear.append(
      create('strong', '', 'No blockers'),
      create('p', '', 'Audit, record digests, references, and scientific lineage are internally consistent under this policy.')
    );
    panel.append(clear);
  }

  const countDetails = create('details', 'verification-data');
  countDetails.append(create('summary', '', 'Verified record counts'));
  let countsPopulated = false;
  countDetails.addEventListener('toggle', () => {
    if (!countDetails.open || countsPopulated) return;
    countsPopulated = true;
    const countWrap = create('div', 'verification-table-wrap');
    const table = create('table');
    const caption = create('caption', '', 'Record counts returned by the authoritative project verifier');
    const body = create('tbody');
    for (const [name, value] of Object.entries(report.counts ?? {})
      .sort(([left], [right]) => left.localeCompare(right))) {
      const row = create('tr');
      const rowHeading = create('th', '', name.replaceAll('_', ' '));
      rowHeading.scope = 'row';
      row.append(rowHeading, create('td', '', Number(value).toLocaleString()));
      body.append(row);
    }
    table.append(caption, body);
    countWrap.append(table);
    countDetails.append(countWrap);
  });

  const exact = create('details', 'verification-data');
  exact.append(create('summary', '', 'Exact bounded gate report'));
  let exactPopulated = false;
  exact.addEventListener('toggle', () => {
    if (!exact.open || exactPopulated) return;
    exactPopulated = true;
    exact.append(create('pre', '', JSON.stringify(report, null, 2)));
  });
  panel.append(countDetails, exact);
  return { panel, heading };
}

export function renderVerificationWorkspace({
  initialJob = null,
  request,
  notify = () => {},
  isActive = () => true,
  onJobUpdate = () => {}
}) {
  const workspace = create('section', 'verification-workspace');
  workspace.setAttribute('aria-busy', 'false');

  const overview = create('div', 'verification-overview');
  const immutable = create('article', 'verification-principle integrity');
  immutable.append(
    create('span', '', 'NON-WAIVABLE'),
    create('h2', '', 'Integrity is always enforced'),
    create('p', '', 'Hash, schema, reference, audit-chain, and lineage failures always block the gate. No control below can bypass them.')
  );
  const outcomes = create('article', 'verification-principle outcome');
  outcomes.append(
    create('span', '', 'EXPLICIT POLICY'),
    create('h2', '', 'Failed outcomes stay visible'),
    create('p', '', 'You may accept selected failed or cancelled outcomes for this check. Their immutable records and counts remain in the report.')
  );
  overview.append(immutable, outcomes);

  const form = create('form', 'verification-form');
  const fieldset = create('fieldset');
  const legend = create('legend', '', 'Outcome policy for this gate run');
  const help = create(
    'p',
    'verification-policy-help',
    'Leave every option off for the strict release policy. These choices never waive integrity failures.'
  );
  const policyGrid = create('div', 'verification-policy-grid');
  const inputs = new Map();
  for (const option of PROJECT_GATE_POLICY_OPTIONS) {
    const label = create('label', 'verification-policy-option');
    const input = create('input');
    input.type = 'checkbox';
    input.name = option.name;
    input.checked = initialJob?.policy?.[option.name] === true ||
      initialJob?.request?.[option.name] === true;
    const copy = create('span');
    copy.append(create('strong', '', option.label), create('small', '', option.description));
    label.append(input, copy);
    inputs.set(option.name, input);
    policyGrid.append(label);
  }
  const actions = create('div', 'verification-actions');
  const run = create('button', 'run-button', 'Run full project gate');
  run.type = 'submit';
  const cancel = create('button', 'secondary-button', 'Cancel verification');
  cancel.type = 'button';
  cancel.hidden = true;
  const status = create('p', 'verification-status', 'Ready for a strict project gate.');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  actions.append(run, cancel, status);
  fieldset.append(legend, help, policyGrid, actions);
  form.append(fieldset);

  const resultHost = create('div', 'verification-result');
  workspace.append(overview, form, resultHost);

  let currentJob = initialJob;
  let pollToken = 0;

  const updateControls = (job) => {
    const active = ACTIVE_STATUSES.has(job?.status);
    workspace.setAttribute('aria-busy', String(active));
    for (const input of inputs.values()) input.disabled = active;
    run.disabled = active;
    cancel.hidden = !active;
    cancel.disabled = job?.status === 'cancelling';
    if (job?.status === 'queued') status.textContent = 'Project gate queued.';
    else if (job?.status === 'running') status.textContent =
      'Verifying audit, records, references, outcomes, and lineage.';
    else if (job?.status === 'cancelling') status.textContent = 'Stopping project verification.';
    else if (job?.status === 'cancelled') status.textContent = 'Project verification was cancelled.';
    else if (job?.status === 'failed') status.textContent =
      job.error?.message ?? 'Project verification could not complete.';
    else if (job?.status === 'completed') status.textContent = job.result?.ok
      ? 'Project gate passed.'
      : 'Project gate completed with blockers.';
    else status.textContent = 'Ready for a strict project gate.';
  };

  const renderJob = (job, { focus = false } = {}) => {
    currentJob = job;
    updateControls(job);
    onJobUpdate(job);
    resultHost.replaceChildren();
    if (job?.status === 'failed') {
      const failure = create('div', 'verification-terminal error');
      failure.append(
        create('strong', '', 'Verification could not complete'),
        create('p', '', job.error?.message ?? 'The isolated gate worker failed.')
      );
      resultHost.append(failure);
      return;
    }
    if (job?.status === 'cancelled') {
      const stopped = create('div', 'verification-terminal cancelled');
      stopped.append(
        create('strong', '', 'Verification cancelled'),
        create('p', '', 'No gate decision was produced. Existing project records were not changed.')
      );
      resultHost.append(stopped);
      return;
    }
    if (job?.result && Array.isArray(job.result.issues)) {
      const rendered = reportPanel(job.result);
      resultHost.append(rendered.panel);
      if (focus && workspace.isConnected && isActive()) {
        rendered.heading.focus({ preventScroll: true });
      }
    }
  };

  const fetchJob = async (jobId) => {
    const { payload } = await request('/api/jobs/' + encodeURIComponent(jobId));
    return payload;
  };

  const poll = async (jobId, { focus = true } = {}) => {
    const token = ++pollToken;
    while (token === pollToken && workspace.isConnected && isActive()) {
      try {
        const job = await fetchJob(jobId);
        if (token !== pollToken || !workspace.isConnected) return;
        renderJob(job, { focus: focus && TERMINAL_STATUSES.has(job.status) });
        if (TERMINAL_STATUSES.has(job.status)) return;
      } catch (error) {
        if (token === pollToken) {
          status.textContent = 'Could not refresh gate status: ' + error.message;
          notify(error.message);
        }
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const policy = Object.fromEntries(
      [...inputs].map(([name, input]) => [name, input.checked])
    );
    run.disabled = true;
    status.textContent = 'Queueing full project verification.';
    workspace.setAttribute('aria-busy', 'true');
    try {
      const { payload } = await request('/api/project-gates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy)
      });
      renderJob(payload);
      void poll(payload.job_id);
    } catch (error) {
      workspace.setAttribute('aria-busy', 'false');
      status.textContent = error.message;
      notify(error.message);
    } finally {
      if (!ACTIVE_STATUSES.has(currentJob?.status)) run.disabled = false;
    }
  });

  cancel.addEventListener('click', async () => {
    if (!currentJob?.job_id || !ACTIVE_STATUSES.has(currentJob.status)) return;
    cancel.disabled = true;
    status.textContent = 'Requesting cancellation.';
    try {
      const { payload } = await request(
        '/api/jobs/' + encodeURIComponent(currentJob.job_id) + '/cancel',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'gate' })
        }
      );
      renderJob(payload);
    } catch (error) {
      cancel.disabled = false;
      status.textContent = error.message;
      notify(error.message);
    }
  });

  if (initialJob?.job_id) {
    renderJob(initialJob);
    if (ACTIVE_STATUSES.has(initialJob.status) ||
        (TERMINAL_STATUSES.has(initialJob.status) &&
          !Array.isArray(initialJob.result?.issues))) {
      void poll(initialJob.job_id, { focus: false });
    }
  } else {
    updateControls(null);
  }
  return workspace;
}
