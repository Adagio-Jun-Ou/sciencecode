import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE_RANKS,
  KNOWLEDGE_LAYERS,
  MAX_KNOWLEDGE_QUERY_LENGTH,
  derivePrinciple,
  getPrinciple,
  groundDomain,
  knowledgeGroundingForWorkflow,
  listKnowledgeDomains,
  listKnowledgeLayers,
  listPrincipleDependents,
  listPrinciples,
  verifyKnowledgeBase
} from '../lib/core.js';

test('the knowledge base compiles with every structural invariant satisfied', () => {
  const verification = verifyKnowledgeBase();
  const failures = verification.findings.filter((finding) => !finding.ok);
  assert.deepEqual(failures, []);
  assert.equal(verification.ok, true);
  assert.ok(verification.principle_count > 0);
});

test('layers are ordered ground-up and every layer carries principles', () => {
  assert.deepEqual(
    KNOWLEDGE_LAYERS.map((layer) => layer.id),
    ['mathematics', 'physics', 'chemistry', 'biology', 'biomedicine']
  );
  KNOWLEDGE_LAYERS.forEach((layer, index) => assert.equal(layer.tier, index));
  for (const layer of listKnowledgeLayers()) {
    assert.ok(layer.principle_count > 0, layer.id + ' has no principles');
  }
});

test('no principle depends on a layer above its own', () => {
  for (const record of listPrinciples()) {
    for (const dependency of record.depends_on) {
      assert.ok(
        getPrinciple(dependency).tier <= record.tier,
        record.id + ' depends upward on ' + dependency
      );
    }
  }
});

test('no principle claims more confidence than the weakest principle it rests on', () => {
  for (const record of listPrinciples()) {
    for (const dependency of record.depends_on) {
      const parent = getPrinciple(dependency);
      assert.ok(
        parent.epistemic.confidence_rank >= record.epistemic.confidence_rank,
        record.id + ' overclaims relative to ' + dependency
      );
    }
  }
});

test('only mathematics declares axioms and applied claims are never definitional', () => {
  for (const record of listPrinciples()) {
    if (record.kind === 'axiom') assert.equal(record.layer, 'mathematics');
    if (record.tier >= 4) {
      assert.ok(
        record.epistemic.confidence_rank <= CONFIDENCE_RANKS.moderate,
        record.id + ' claims ' + record.epistemic.confidence + ' in the applied layer'
      );
    }
  }
});

test('every principle above mathematics derives back down to mathematics', () => {
  for (const record of listPrinciples()) {
    if (record.tier === 0) continue;
    const derivation = derivePrinciple(record.id);
    assert.equal(derivation.grounded_in_mathematics, true, record.id + ' is ungrounded');
    assert.equal(derivation.chain.at(-1).id, record.id);
    assert.ok(derivation.foundations.length > 0);
  }
});

test('a derivation is ordered so dependencies always precede dependents', () => {
  const derivation = derivePrinciple('bioeng.vaccine.conformational_stabilisation');
  const seen = new Set();
  for (const record of derivation.chain) {
    for (const dependency of record.depends_on) {
      assert.ok(seen.has(dependency), dependency + ' appears after ' + record.id);
    }
    seen.add(record.id);
  }
  assert.deepEqual(
    derivation.layers_used,
    ['mathematics', 'physics', 'chemistry', 'biology', 'biomedicine']
  );
});

test('a derivation reports the weakest supporting claim and its stated limits', () => {
  const derivation = derivePrinciple('bioeng.dna.targeted_editing');
  const weakest = derivation.chain.reduce((worst, record) => (
    record.epistemic.confidence_rank < worst.epistemic.confidence_rank ? record : worst
  ), derivation.chain[0]);
  assert.equal(derivation.weakest_link.id, weakest.id);
  assert.ok(derivation.weakest_link.limits.length > 0);
  assert.ok(derivation.stated_limits.length > 0);
  for (const limit of derivation.stated_limits) {
    assert.ok(limit.limits.length > 0, limit.id + ' has no stated limit');
  }
});

test('every principle states scope, limits, and at least one reference', () => {
  for (const record of listPrinciples()) {
    assert.ok(record.scope.length > 0, record.id + ' has no scope');
    assert.ok(record.limits.length > 0, record.id + ' has no limits');
    assert.ok(record.references.length > 0, record.id + ' has no reference');
  }
});

test('domain packs resolve to a full support tree spanning every layer', () => {
  const domains = listKnowledgeDomains();
  assert.ok(domains.some((domain) => domain.id === 'drug_discovery'));
  assert.ok(domains.some((domain) => domain.id === 'vaccine_design'));
  for (const domain of ['drug_discovery', 'nucleic_acid_design', 'protein_engineering', 'vaccine_design']) {
    const grounding = groundDomain(domain);
    assert.deepEqual(
      grounding.layer_span,
      ['mathematics', 'physics', 'chemistry', 'biology', 'biomedicine'],
      domain + ' does not span every layer'
    );
    for (const root of grounding.roots) {
      assert.ok(grounding.principles.some((record) => record.id === root.id));
    }
    assert.ok(grounding.provisional_claims.length > 0, domain + ' reports no provisional claim');
  }
});

test('biomolecular domains carry the dual-use governance principle', () => {
  for (const domain of ['nucleic_acid_design', 'protein_engineering', 'vaccine_design']) {
    assert.ok(
      groundDomain(domain).governance.includes('bioeng.biosafety.dual_use'),
      domain + ' omits dual-use governance'
    );
  }
  const dualUse = getPrinciple('bioeng.biosafety.dual_use');
  assert.equal(dualUse.kind, 'governance');
  assert.equal(dualUse.epistemic.falsifiable, false);
  assert.match(dualUse.statement, /authori[sz]es nothing/);
});

test('workflow grounding names the layers and governance a workflow must cite', () => {
  const design = knowledgeGroundingForWorkflow('biomolecular_design');
  assert.equal(design.workflow, 'biomolecular_design');
  assert.ok(design.principle_count > 0);
  assert.deepEqual(
    design.layer_span,
    ['mathematics', 'physics', 'chemistry', 'biology', 'biomedicine']
  );
  assert.ok(design.governance.includes('bioeng.biosafety.dual_use'));
  assert.ok(design.domains.some((domain) => domain.id === 'vaccine_design'));

  const discovery = knowledgeGroundingForWorkflow('drug_discovery');
  assert.ok(discovery.domains.some((domain) => domain.id === 'drug_discovery'));
  assert.ok(discovery.provisional_claims.includes('med.translation.model_validity'));

  // An unrecognised workflow falls back to general research rather than throwing.
  assert.equal(knowledgeGroundingForWorkflow('not_a_workflow').principle_count > 0, true);
});

test('queries filter by layer, kind, domain, and text', () => {
  const chemistry = listPrinciples({ layer: 'chemistry' });
  assert.ok(chemistry.length > 0);
  assert.ok(chemistry.every((record) => record.layer === 'chemistry'));

  const laws = listPrinciples({ kind: 'law' });
  assert.ok(laws.every((record) => record.kind === 'law'));

  const vaccine = listPrinciples({ domain: 'vaccine_design', layer: 'biomedicine' });
  assert.ok(vaccine.some((record) => record.id === 'bioeng.vaccine.antigen_selection'));

  const searched = listPrinciples({ search: 'CODON' });
  assert.ok(searched.some((record) => record.id === 'bio.genetics.genetic_code'));
});

test('unknown ids and oversized queries fail closed', () => {
  assert.throws(() => getPrinciple('math.does.not.exist'), /Unknown knowledge principle/);
  assert.throws(() => listPrinciples({ layer: 'astrology' }), /Unknown knowledge layer/);
  assert.throws(() => listPrinciples({ kind: 'vibes' }), /Unknown knowledge kind/);
  assert.throws(() => groundDomain('alchemy'), /Unknown knowledge domain/);
  assert.throws(
    () => listPrinciples({ search: 'x'.repeat(MAX_KNOWLEDGE_QUERY_LENGTH + 1) }),
    /at most/
  );
});

test('dependents are reported for a foundational principle', () => {
  const dependents = listPrincipleDependents('chem.equilibrium.mass_action');
  assert.ok(dependents.length > 0);
  assert.ok(dependents.every((record) => record.depends_on.includes('chem.equilibrium.mass_action')));
  assert.equal(listPrincipleDependents('bioeng.biosafety.dual_use').length, 0);
});

test('records are frozen so a caller cannot mutate the shared base', () => {
  const record = getPrinciple('bio.dna.double_helix');
  assert.throws(() => { record.statement = 'edited'; }, TypeError);
  assert.throws(() => { record.depends_on.push('math.set.zfc'); }, TypeError);
});
