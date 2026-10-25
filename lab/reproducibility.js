const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function create(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null && text !== undefined) node.textContent = text;
  return node;
}

function compact(value, limit = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '\u2026' : text;
}

function formatDate(value) {
  if (!value) return 'not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium'
    }).format(date);
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'not recorded';
  if (bytes < 1024) return bytes.toLocaleString() + ' B';
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes;
  let unit = -1;
  do {
    amount /= 1024;
    unit += 1;
  } while (amount >= 1024 && unit < units.length - 1);
  return amount.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' ' + units[unit];
}

function metric(label, value, tone = '') {
  const item = create('div', 'snapshot-metric ' + tone);
  item.append(create('span', '', label), create('strong', '', String(value)));
  return item;
}

export function snapshotReportViewModel(report) {
  const summary = report?.summary ?? {};
  return {
    ok: report?.ok === true,
    blockers: Number(summary.blockers ?? 0),
    integrity: Number(summary.integrity_blockers ?? 0),
    added: Number(summary.added ?? 0),
    modified: Number(summary.modified ?? 0),
    missing: Number(summary.missing ?? 0),
    unreadable: Number(summary.unreadable ?? 0),
    omitted: Number(summary.omitted_findings ?? 0),
    truncated: summary.truncated === true,
    status: report?.ok === true ? 'pass' : 'drift'
  };
}

export function snapshotFindingView(finding, { includeDetails = true } = {}) {
  const allowed = new Set(['integrity', 'added', 'modified', 'missing', 'unreadable']);
  const category = allowed.has(finding?.category) ? finding.category : 'integrity';
  const labels = {
    integrity: 'Integrity blocker',
    added: 'Added file',
    modified: 'Modified file',
    missing: 'Missing file',
    unreadable: 'Unreadable file'
  };
  return {
    category,
    categoryLabel: labels[category],
    title: compact(finding?.file ?? finding?.issue ?? 'Snapshot finding', 240),
    issue: compact(finding?.issue ?? 'snapshot_verification_failed', 160),
    digest: String(finding?.detail_sha256 ?? ''),
    truncated: finding?.detail_truncated === true,
    details: includeDetails
      ? JSON.stringify(finding?.details ?? null, null, 2)
      : null
  };
}

function reportPanel(report) {
  const model = snapshotReportViewModel(report);
  const panel = create('section', 'snapshot-report ' + model.status);
  panel.setAttribute('aria-labelledby', 'snapshot-result-title');
  const created = report.operation === 'create';
  const heading = create('h2', '', model.ok
    ? created ? 'Baseline created and verified' : 'Project matches this baseline'
    : created ? 'Baseline created with immediate drift' : 'Snapshot check found drift');
  heading.id = 'snapshot-result-title';
  heading.tabIndex = -1;
  const lead = create('p', 'snapshot-report-lead', model.ok
    ? 'The immutable manifest, audit binding, and selected workspace comparison all passed.'
    : 'Integrity problems and file drift are separated below; no mismatch is silently accepted.');
  const identity = create('div', 'snapshot-report-identity');
  identity.append(
    create('span', '', compact(report.snapshot?.snapshot_id, 150)),
    create('span', '', 'Checked ' + formatDate(report.generated_at)),
    create('code', '', 'report ' + compact(report.fingerprint, 24))
  );
  const metrics = create('div', 'snapshot-metrics');
  metrics.append(
    metric('Result', model.ok ? 'MATCH' : 'DRIFT', model.ok ? 'pass' : 'blocked'),
    metric('Integrity', model.integrity, model.integrity ? 'blocked' : 'pass'),
    metric('Added', model.added, model.added ? 'attention' : ''),
    metric('Modified', model.modified, model.modified ? 'attention' : ''),
    metric('Missing', model.missing, model.missing ? 'blocked' : '')
  );
  panel.append(heading, lead, identity, metrics);

  const facts = create('dl', 'snapshot-anchors');
  for (const [label, value] of [
    ['Snapshot SHA-256', report.anchors?.snapshot_sha256],
    ['Audit event', report.anchors?.audit_event_hash],
    ['Audit head', report.anchors?.audit_head_hash],
    ['Files', report.snapshot?.file_count],
    ['Captured bytes', Number.isFinite(report.snapshot?.total_bytes)
      ? formatBytes(report.snapshot.total_bytes)
      : null]
  ]) {
    facts.append(create('dt', '', label), create('dd', '', value ?? 'Not recorded'));
  }
  panel.append(facts);

  if (Array.isArray(report.findings) && report.findings.length) {
    const findings = create('section', 'snapshot-findings');
    findings.append(create('h3', '', 'Snapshot findings'));
    if (model.truncated) {
      findings.append(create(
        'p',
        'snapshot-limit-note',
        model.omitted
          ? model.omitted + ' additional finding(s) were omitted from this bounded report.'
          : 'At least one diagnostic was shortened to keep this report bounded.'
      ));
    }
    for (const finding of report.findings) {
      const view = snapshotFindingView(finding, { includeDetails: false });
      const detail = create('details', 'snapshot-finding ' + view.category);
      const summary = create('summary');
      const labels = create('span', 'snapshot-finding-labels');
      labels.append(
        create('b', '', view.categoryLabel),
        create('strong', '', view.title)
      );
      summary.append(labels, create('small', '', view.issue));
      detail.append(summary);
      let populated = false;
      detail.addEventListener('toggle', () => {
        if (!detail.open || populated) return;
        populated = true;
        const body = create('div', 'snapshot-finding-body');
        if (view.truncated) {
          body.append(create(
            'p',
            'snapshot-limit-note',
            'This diagnostic was shortened; its digest still identifies the complete redacted finding.'
          ));
        }
        if (view.digest) body.append(create('code', 'snapshot-digest', view.digest));
        body.append(create('pre', '', JSON.stringify(finding?.details ?? null, null, 2)));
        detail.append(body);
      });
      findings.append(detail);
    }
    panel.append(findings);
  } else if (model.ok) {
    const clear = create('div', 'snapshot-clear');
    clear.append(
      create('strong', '', 'No differences'),
      create('p', '', report.strict
        ? 'No captured file changed or disappeared, and no uncaptured file was added.'
        : 'Every captured file still matches. Additions were outside this comparison policy.')
    );
    panel.append(clear);
  }

  const exact = create('details', 'snapshot-data');
  exact.append(create('summary', '', 'Exact bounded snapshot report'));
  let exactPopulated = false;
  exact.addEventListener('toggle', () => {
    if (!exact.open || exactPopulated) return;
    exactPopulated = true;
    exact.append(create('pre', '', JSON.stringify(report, null, 2)));
  });
  panel.append(exact);
  return { panel, heading };
}

export function renderReproducibilityWorkspace({
  initialJob = null,
  request,
  notify = () => {},
  isActive = () => true,
  onJobUpdate = () => {},
  onSnapshotCount = () => {}
}) {
  const workspace = create('section', 'reproducibility-workspace');
  workspace.setAttribute('aria-busy', 'false');

  const overview = create('div', 'snapshot-overview');
  const baseline = create('article', 'snapshot-principle baseline');
  baseline.append(
    create('span', '', 'IMMUTABLE BASELINE'),
    create('h2', '', 'Capture exact project bytes'),
    create('p', '', 'ScienceCode hashes project files and symlink targets while excluding its own metadata, Git internals, and generated dependency trees.')
  );
  const compare = create('article', 'snapshot-principle compare');
  compare.append(
    create('span', '', 'REPRODUCIBILITY CHECK'),
    create('h2', '', 'Explain every difference'),
    create('p', '', 'Strict verification separates added, modified, missing, unreadable, and record-integrity findings without changing project files.')
  );
  overview.append(baseline, compare);

  const controls = create('form', 'snapshot-controls');
  const capture = create('button', 'run-button', 'Capture current baseline');
  capture.type = 'submit';
  const strictLabel = create('label', 'snapshot-strict-option');
  const strict = create('input');
  strict.type = 'checkbox';
  strict.checked = true;
  strictLabel.append(
    strict,
    create('span', '', 'Strict verification'),
    create('small', '', 'Report files added after capture as drift.')
  );
  const cancel = create('button', 'secondary-button', 'Cancel snapshot operation');
  cancel.type = 'button';
  cancel.hidden = true;
  const status = create('p', 'snapshot-status', 'Ready to capture or verify a baseline.');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  controls.append(capture, strictLabel, cancel, status);

  const listSection = create('section', 'snapshot-library');
  const listHeading = create('div', 'snapshot-library-heading');
  const listTitle = create('h2', '', 'Recorded baselines');
  const refresh = create('button', 'secondary-button', 'Refresh list');
  refresh.type = 'button';
  listHeading.append(listTitle, refresh);
  const listStatus = create('p', 'snapshot-list-status', 'Loading recorded baselines.');
  listStatus.setAttribute('role', 'status');
  listStatus.setAttribute('aria-live', 'polite');
  const list = create('div', 'snapshot-list');
  list.setAttribute('aria-live', 'polite');
  listSection.append(listHeading, listStatus, list);

  const resultHost = create('div', 'snapshot-result');
  workspace.append(overview, controls, listSection, resultHost);

  let currentJob = initialJob;
  let pollToken = 0;
  let listToken = 0;
  let snapshots = [];

  const updateControls = (job) => {
    const active = ACTIVE_STATUSES.has(job?.status);
    workspace.setAttribute('aria-busy', String(active));
    capture.disabled = active;
    strict.disabled = active;
    refresh.disabled = active;
    cancel.hidden = !active;
    cancel.disabled = job?.status === 'cancelling';
    for (const button of list.querySelectorAll('button')) button.disabled = active;
    if (job?.status === 'queued') status.textContent = 'Project snapshot operation queued.';
    else if (job?.status === 'running') status.textContent = job.operation === 'create'
      ? 'Hashing project files in an isolated worker.'
      : 'Comparing current files with the selected baseline.';
    else if (job?.status === 'cancelling') status.textContent = 'Stopping snapshot operation.';
    else if (job?.status === 'cancelled') status.textContent = 'Snapshot operation was cancelled.';
    else if (job?.status === 'failed') status.textContent =
      job.error?.message ?? 'Snapshot operation could not complete.';
    else if (job?.status === 'completed') status.textContent = job.result?.ok
      ? 'Snapshot operation completed without differences.'
      : 'Snapshot operation completed with findings.';
    else status.textContent = 'Ready to capture or verify a baseline.';
  };

  const renderList = () => {
    list.replaceChildren();
    if (!snapshots.length) {
      const empty = create('div', 'snapshot-empty');
      empty.append(
        create('strong', '', 'No project baselines yet'),
        create('p', '', 'Capture the current project to create an audit-bound SHA-256 baseline.')
      );
      list.append(empty);
      return;
    }
    const active = ACTIVE_STATUSES.has(currentJob?.status);
    for (const item of snapshots) {
      const card = create('article', 'snapshot-card ' + item.status);
      const head = create('div', 'snapshot-card-head');
      const titleWrap = create('div');
      titleWrap.append(
        create('strong', '', compact(item.snapshot_id, 150)),
        create('small', '', formatDate(item.created_at))
      );
      const state = create('span', 'snapshot-binding ' + item.status,
        item.status === 'recorded' ? 'AUDIT BOUND' : item.status.toUpperCase());
      head.append(titleWrap, state);
      const facts = create('div', 'snapshot-card-facts');
      facts.append(
        create('span', '', item.file_count === null
          ? 'File count available after verification'
          : Number(item.file_count).toLocaleString() + ' files'),
        create('span', '', formatBytes(item.manifest_bytes) + ' manifest'),
        create('code', '', item.snapshot_sha256
          ? compact(item.snapshot_sha256, 20)
          : 'digest requires verification')
      );
      const actions = create('div', 'snapshot-card-actions');
      const verify = create('button', 'secondary-button', 'Verify baseline');
      verify.type = 'button';
      verify.disabled = active;
      verify.addEventListener('click', () => void launchVerification(item.snapshot_id));
      const download = create('a', 'secondary-link', 'Download exact JSON');
      download.href = item.download_url;
      download.setAttribute('download', item.snapshot_id + '.json');
      actions.append(verify, download);
      card.append(head, facts, actions);
      list.append(card);
    }
  };

  const loadSnapshots = async () => {
    const token = ++listToken;
    listStatus.textContent = 'Loading recorded baselines.';
    try {
      const { payload } = await request('/api/project-snapshots');
      if (token !== listToken || !workspace.isConnected) return;
      snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
      onSnapshotCount(payload.summary?.total ?? snapshots.length);
      listStatus.textContent = payload.summary?.omitted
        ? 'Showing ' + payload.summary.returned + ' of ' + payload.summary.total +
          ' baselines. Use the CLI to inspect older records.'
        : snapshots.length + ' recorded baseline(s).' +
          (payload.summary?.registry_issues
            ? ' Registry integrity requires attention.'
            : '');
      renderList();
    } catch (error) {
      if (token !== listToken) return;
      listStatus.textContent = 'Could not load baselines: ' + error.message;
      list.replaceChildren(create('div', 'snapshot-terminal error', error.message));
      notify(error.message);
    }
  };

  const renderJob = (job, { focus = false } = {}) => {
    currentJob = job;
    updateControls(job);
    onJobUpdate(job);
    resultHost.replaceChildren();
    if (job?.status === 'failed') {
      const failure = create('div', 'snapshot-terminal error');
      failure.append(
        create('strong', '', 'Snapshot operation could not complete'),
        create('p', '', job.error?.message ?? 'The isolated snapshot worker failed.')
      );
      resultHost.append(failure);
      return;
    }
    if (job?.status === 'cancelled') {
      const stopped = create('div', 'snapshot-terminal cancelled');
      stopped.append(
        create('strong', '', 'Snapshot operation cancelled'),
        create('p', '', 'No uncommitted baseline was retained. Existing immutable baselines were unchanged.')
      );
      resultHost.append(stopped);
      return;
    }
    if (job?.result && Array.isArray(job.result.findings)) {
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
        if (TERMINAL_STATUSES.has(job.status)) {
          await loadSnapshots();
          return;
        }
      } catch (error) {
        if (token === pollToken) {
          status.textContent = 'Could not refresh snapshot status: ' + error.message;
          notify(error.message);
        }
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  };

  const launch = async (url, body) => {
    workspace.setAttribute('aria-busy', 'true');
    capture.disabled = true;
    status.textContent = 'Queueing project snapshot operation.';
    try {
      const { payload } = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      renderJob(payload);
      void poll(payload.job_id);
    } catch (error) {
      workspace.setAttribute('aria-busy', 'false');
      status.textContent = error.message;
      notify(error.message);
      updateControls(currentJob);
    }
  };

  const launchVerification = async (snapshotId) => launch(
    '/api/project-snapshots/' + encodeURIComponent(snapshotId) + '/verifications',
    { strict: strict.checked }
  );

  controls.addEventListener('submit', (event) => {
    event.preventDefault();
    void launch('/api/project-snapshots', {});
  });
  refresh.addEventListener('click', () => void loadSnapshots());
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
          body: JSON.stringify({
            kind: 'snapshot',
            snapshot_id: currentJob.snapshot_id,
            operation: currentJob.operation
          })
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
          !Array.isArray(initialJob.result?.findings))) {
      void poll(initialJob.job_id, { focus: false });
    }
  } else {
    updateControls(null);
  }
  void loadSnapshots();
  return workspace;
}
