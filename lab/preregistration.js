export const MAX_PREREGISTRATION_BYTES = 256 * 1024;

export const PREREGISTRATION_REQUIRED_SECTIONS = Object.freeze([
  'Research question',
  'Hypotheses',
  'Design and population',
  'Primary outcomes',
  'Sample size and stopping rule',
  'Inclusion, exclusion, and missing data',
  'Analysis and decision rules',
  'Multiplicity and sensitivity analyses',
  'Deviations, risks, and limitations'
]);

const PLACEHOLDER_PATTERN = /\[REPLACE:[^\]]*\]/gi;

function normalizedHeading(value) {
  return String(value ?? '')
    .replace(/#+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function defaultPreregistrationDraft() {
  return `# Study preregistration

Freeze this plan before inspecting study outcomes. Replace every bracketed prompt.

## Research question
[REPLACE: State the precise research question.]

## Hypotheses
[REPLACE: State directional or non-directional hypotheses and the null case.]

## Design and population
[REPLACE: Define the design, population, comparison groups, assignment, and setting.]

## Primary outcomes
[REPLACE: Name each primary outcome, unit, timepoint, and summary measure.]

## Sample size and stopping rule
[REPLACE: Give the target sample size, rationale, and any stopping rule.]

## Inclusion, exclusion, and missing data
[REPLACE: Prespecify eligibility, exclusions, attrition handling, and missing-data policy.]

## Analysis and decision rules
[REPLACE: Define the analysis population, models or summaries, thresholds, and decisions.]

## Multiplicity and sensitivity analyses
[REPLACE: State multiplicity control and planned robustness or sensitivity analyses.]

## Deviations, risks, and limitations
[REPLACE: Record anticipated deviations, risks, limitations, and disclosure rules.]
`;
}

export function inspectPreregistrationDraft(value) {
  const content = typeof value === 'string' ? value : '';
  const bytes = new TextEncoder().encode(content).byteLength;
  const lines = content.split(/\r?\n/);
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const match = lines[index].match(/^ {0,3}#{2,6}[ \t]+(.+?)[ \t]*$/);
    if (match) headings.push({ index, name: normalizedHeading(match[1]) });
  }
  const required = PREREGISTRATION_REQUIRED_SECTIONS.map(normalizedHeading);
  const missingSections = [];
  const emptySections = [];
  const duplicateSections = [];
  for (let requiredIndex = 0; requiredIndex < required.length; requiredIndex += 1) {
    const section = required[requiredIndex];
    const matches = headings.filter((heading) => heading.name === section);
    if (!matches.length) {
      missingSections.push(PREREGISTRATION_REQUIRED_SECTIONS[requiredIndex]);
      continue;
    }
    if (matches.length > 1) {
      duplicateSections.push(PREREGISTRATION_REQUIRED_SECTIONS[requiredIndex]);
    }
    const heading = matches[0];
    const next = headings.find((candidate) => candidate.index > heading.index);
    const body = lines.slice(heading.index + 1, next?.index ?? lines.length)
      .join('\n').trim();
    if (!body) emptySections.push(PREREGISTRATION_REQUIRED_SECTIONS[requiredIndex]);
  }
  const placeholderCount = (content.match(PLACEHOLDER_PATTERN) ?? []).length;
  return {
    bytes,
    maximum_bytes: MAX_PREREGISTRATION_BYTES,
    required_sections: [...PREREGISTRATION_REQUIRED_SECTIONS],
    missing_sections: missingSections,
    empty_sections: emptySections,
    duplicate_sections: duplicateSections,
    placeholder_count: placeholderCount,
    valid: bytes > 0 && bytes <= MAX_PREREGISTRATION_BYTES &&
      missingSections.length === 0 && emptySections.length === 0 &&
      duplicateSections.length === 0 && placeholderCount === 0
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function labelledControl(labelText, control) {
  const label = element('label', 'analysis-field');
  label.htmlFor = control.id;
  label.append(element('span', '', labelText), control);
  return label;
}

export function renderPreregistrationBuilder({
  selectedChat = null,
  request,
  notify = () => {},
  onCreated = async () => {}
}) {
  const form = element('form', 'preregistration-builder');
  const headingId = 'preregistration-builder-heading';
  form.setAttribute('aria-labelledby', headingId);
  form.setAttribute('aria-busy', 'false');
  form.noValidate = true;

  const header = element('header', 'preregistration-builder-head');
  header.append(
    element('span', 'record-type', '1 / AUTHOR PREREGISTRATION'),
    element('h3', '', 'Freeze the study plan before compute'),
    element('p', '',
      'Complete every section. Freezing writes an immutable Markdown artifact; later changes become a new registration.')
  );
  header.querySelector('h3').id = headingId;

  const name = element('input', 'analysis-input');
  name.id = 'preregistration-name';
  name.name = 'name';
  name.type = 'text';
  name.required = true;
  name.maxLength = 200;
  name.autocomplete = 'off';
  name.value = 'Study preregistration';

  const editor = element('textarea', 'preregistration-editor');
  editor.id = 'preregistration-content';
  editor.name = 'content';
  editor.rows = 24;
  editor.required = true;
  editor.maxLength = MAX_PREREGISTRATION_BYTES;
  editor.spellcheck = true;
  editor.value = defaultPreregistrationDraft();
  editor.setAttribute('aria-describedby', 'preregistration-completeness preregistration-status');

  const completeness = element('div', 'preregistration-completeness');
  completeness.id = 'preregistration-completeness';
  const meter = element('p', 'preregistration-meter');
  const checklist = element('ul', 'preregistration-checklist');
  completeness.append(meter, checklist);

  const shareRow = element('label', 'preregistration-share');
  const share = element('input');
  share.type = 'checkbox';
  share.checked = Boolean(selectedChat);
  share.disabled = !selectedChat;
  shareRow.append(
    share,
    element('span', '', selectedChat
      ? 'Share this frozen registration with the selected AI conversation'
      : 'Select a conversation to add an optional AI handoff')
  );

  const note = element('textarea', 'analysis-deviation');
  note.id = 'preregistration-note';
  note.rows = 3;
  note.maxLength = 2000;
  note.disabled = !share.checked;
  note.placeholder = 'Optional direction for the AI; this does not change the frozen plan.';

  const status = element('p', 'analysis-action-state');
  status.id = 'preregistration-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const reset = element('button', 'quiet-button', 'Reset template');
  reset.type = 'button';
  const freeze = element('button', 'share-button', 'Freeze preregistration');
  freeze.type = 'submit';

  let busy = false;
  const renderInspection = () => {
    const inspection = inspectPreregistrationDraft(editor.value);
    meter.textContent = inspection.bytes.toLocaleString() + ' / ' +
      inspection.maximum_bytes.toLocaleString() + ' UTF-8 bytes';
    checklist.replaceChildren();
    for (const section of inspection.required_sections) {
      const missing = inspection.missing_sections.includes(section);
      const empty = inspection.empty_sections.includes(section);
      const duplicate = inspection.duplicate_sections.includes(section);
      const ready = !missing && !empty && !duplicate;
      const item = element('li', ready ? 'ready' : 'incomplete');
      item.append(
        element('span', 'status-dot', ready ? 'Ready' : 'Needs work'),
        element('span', '', section + (duplicate ? ' (duplicate)' : ''))
      );
      checklist.append(item);
    }
    const nameReady = Boolean(name.value.trim()) && name.value.trim().length <= 200;
    freeze.disabled = busy || !nameReady || !inspection.valid;
    status.className = 'analysis-action-state' + (inspection.valid ? '' : ' invalid');
    if (inspection.bytes > inspection.maximum_bytes) {
      status.textContent = 'Draft is too large to freeze.';
    } else if (inspection.placeholder_count) {
      status.textContent = 'Replace ' + inspection.placeholder_count +
        ' bracketed prompt(s) before freezing.';
    } else if (!inspection.valid) {
      const issueCount = inspection.missing_sections.length +
        inspection.empty_sections.length + inspection.duplicate_sections.length;
      status.textContent = String(issueCount) + ' section issue(s) remain.';
    } else if (!nameReady) {
      status.textContent = 'Add a study name before freezing.';
    } else {
      status.textContent = 'Complete locally; the server will replay validation before freezing.';
    }
    return inspection;
  };

  editor.addEventListener('input', renderInspection);
  name.addEventListener('input', renderInspection);
  share.addEventListener('change', () => {
    note.disabled = !share.checked;
    if (!share.checked) note.value = '';
  });
  reset.addEventListener('click', () => {
    editor.value = defaultPreregistrationDraft();
    renderInspection();
    editor.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const inspection = renderInspection();
    if (!inspection.valid || !name.value.trim() || busy) return;
    busy = true;
    form.setAttribute('aria-busy', 'true');
    reset.disabled = true;
    freeze.disabled = true;
    status.className = 'analysis-action-state';
    status.textContent = 'Validating and freezing the immutable Markdown record...';
    try {
      const { payload } = await request('/api/preregistrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value.trim(),
          content: editor.value,
          chat_id: share.checked ? selectedChat : null,
          note: share.checked ? note.value.trim() || null : null
        })
      });
      const created = payload.preregistration;
      status.textContent = 'Frozen / ' + created.record.preregistration_id;
      await onCreated(created);
      if (payload.interaction_error) {
        notify('Preregistration froze, but AI handoff needs review: ' +
          payload.interaction_error.message);
      } else {
        notify('Preregistration frozen and integrity-verified.');
      }
    } catch (error) {
      status.className = 'analysis-action-state invalid';
      status.textContent = 'Not frozen / ' + error.message;
      notify(error.message);
    } finally {
      busy = false;
      form.setAttribute('aria-busy', 'false');
      reset.disabled = false;
      renderInspection();
    }
  });

  const actions = element('div', 'analysis-actions');
  actions.append(reset, freeze);
  form.append(
    header,
    labelledControl('Study name', name),
    labelledControl('Structured Markdown plan', editor),
    completeness,
    shareRow,
    labelledControl('Optional AI handoff note', note),
    actions,
    status
  );
  renderInspection();
  return form;
}
