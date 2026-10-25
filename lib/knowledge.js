// Foundational scientific knowledge for the ScienceCode harness.
//
// The base is a layered directed acyclic graph. Mathematics is the ground
// layer; physics may rest on mathematics; chemistry on physics; biology on
// chemistry; applied biomedicine on biology. A principle may never depend on
// a layer above its own, and may never claim more epistemic confidence than
// the weakest principle it rests on. Both invariants are checked at module
// load, so an unsound edge is a startup failure rather than a silent claim.

export const KNOWLEDGE_SCHEMA_VERSION = 1;
export const KNOWLEDGE_ENGINE_NAME = 'sciencecode-layered-knowledge';
export const MAX_KNOWLEDGE_QUERY_LENGTH = 120;
export const MAX_KNOWLEDGE_RESULTS = 200;

// Ordered ground-up. The index is the tier: a lower tier is nearer to first
// principles and carries the stronger warrant.
export const KNOWLEDGE_LAYERS = Object.freeze([
  Object.freeze({
    id: 'mathematics',
    tier: 0,
    label: 'Mathematics',
    warrant: 'deductive',
    description: 'Axioms, definitions, and proved consequences. True relative to stated axioms, independent of measurement.'
  }),
  Object.freeze({
    id: 'physics',
    tier: 1,
    label: 'Physics',
    warrant: 'mathematised-empirical',
    description: 'Conservation laws and dynamics expressed mathematically and constrained by measurement to stated precision and regime.'
  }),
  Object.freeze({
    id: 'chemistry',
    tier: 2,
    label: 'Chemistry',
    warrant: 'physical-model',
    description: 'Structure, energetics, and rates of matter, derived from physics through approximations whose validity conditions are stated.'
  }),
  Object.freeze({
    id: 'biology',
    tier: 3,
    label: 'Biology',
    warrant: 'mechanistic-historical',
    description: 'Chemistry organised by evolutionary history. Mechanisms hold contingently across taxa and conditions rather than universally.'
  }),
  Object.freeze({
    id: 'biomedicine',
    tier: 4,
    label: 'Applied biomedicine',
    warrant: 'decision-support',
    description: 'Discovery and engineering practice. Predictive, revisable, and never sufficient authorisation for laboratory or clinical action.'
  })
]);

// Ranked strongest first. A principle inherits the ceiling of its weakest
// dependency, which is what makes the tree "more true" the further down you go.
export const CONFIDENCE_RANKS = Object.freeze({
  definitional: 5,
  very_high: 4,
  high: 3,
  moderate: 2,
  provisional: 1
});

const KINDS = new Set([
  'axiom', 'definition', 'theorem', 'law', 'model', 'approximation',
  'empirical_regularity', 'heuristic', 'governance'
]);

const STATUSES = new Set([
  'axiomatic', 'proved', 'measured', 'modelled', 'empirical', 'heuristic', 'normative'
]);

const LAYER_BY_ID = new Map(KNOWLEDGE_LAYERS.map((layer) => [layer.id, layer]));

const RAW = [];

function principle(spec) {
  RAW.push(spec);
}

// ---------------------------------------------------------------------------
// Tier 0 — mathematics
// ---------------------------------------------------------------------------

principle({
  id: 'math.logic.classical',
  layer: 'mathematics',
  kind: 'axiom',
  title: 'Classical first-order logic',
  statement: 'Inference proceeds by truth-preserving rules over well-formed statements; a derivation from true premises yields a true conclusion.',
  depends_on: [],
  status: 'axiomatic',
  confidence: 'definitional',
  scope: 'All deductive argument in the knowledge base, including the derivation chains this module reports.',
  limits: 'Says nothing about whether premises describe the world. Constructive and paraconsistent logics reject excluded middle.',
  references: ['Enderton, A Mathematical Introduction to Logic (2001)']
});

principle({
  id: 'math.set.zfc',
  layer: 'mathematics',
  kind: 'axiom',
  title: 'Zermelo–Fraenkel set theory with choice',
  statement: 'Mathematical objects are modelled as sets under the ZFC axioms, giving extensionality, replacement, infinity, and choice.',
  depends_on: ['math.logic.classical'],
  status: 'axiomatic',
  confidence: 'definitional',
  scope: 'Foundation for number systems, spaces, measures, and functions used above.',
  limits: 'Consistency is unprovable within ZFC. Alternative foundations (type theory, category theory) support the same working mathematics.',
  references: ['Jech, Set Theory (2003)']
});

principle({
  id: 'math.number.real_field',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Complete ordered field of real numbers',
  statement: 'The reals form the unique complete ordered field, supplying limits, continuity, and the arithmetic used by every quantitative model above.',
  depends_on: ['math.set.zfc'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Continuous quantities: concentrations, energies, rates, coordinates.',
  limits: 'Physical quantities are measured to finite precision and carry dimensions; the reals alone carry neither.',
  references: ['Rudin, Principles of Mathematical Analysis (1976)']
});

principle({
  id: 'math.numeric.floating_point',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Finite-precision arithmetic',
  statement: 'IEEE-754 arithmetic represents a finite subset of the reals; operations round, errors accumulate, and comparisons of near-equal values are unreliable.',
  depends_on: ['math.number.real_field'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Every computed result the harness records, including simulation and analysis replay.',
  limits: 'Catastrophic cancellation and non-associativity make bitwise reproducibility dependent on operation order, library, and hardware.',
  references: ['Goldberg, What Every Computer Scientist Should Know About Floating-Point Arithmetic (1991)']
});

principle({
  id: 'math.graph.dag',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Directed acyclic graph and reachability',
  statement: 'A finite directed graph without cycles admits a topological order, and transitive closure over its edges is well defined and terminating.',
  depends_on: ['math.set.zfc'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Dependency structure of this knowledge base, artifact lineage, and causal diagrams.',
  limits: 'Acyclicity must be established, not assumed; feedback systems are not DAGs without unrolling in time.',
  references: ['Cormen et al., Introduction to Algorithms (2009)']
});

principle({
  id: 'math.linalg.vector_space',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Vector spaces and linear maps',
  statement: 'Linear structure over a field supports superposition: the image of a sum is the sum of images.',
  depends_on: ['math.number.real_field'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Quantum state spaces, reaction stoichiometry matrices, sequence embeddings, linear models.',
  limits: 'Biological and chemical responses are frequently saturating or cooperative, hence non-linear.',
  references: ['Axler, Linear Algebra Done Right (2015)']
});

principle({
  id: 'math.linalg.eigen',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Spectral decomposition',
  statement: 'A self-adjoint operator on a finite-dimensional inner-product space has real eigenvalues and an orthonormal eigenbasis.',
  depends_on: ['math.linalg.vector_space'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Observables in quantum mechanics, normal modes, principal components, Markov steady states.',
  limits: 'Requires self-adjointness; non-normal operators exhibit transient growth despite stable spectra.',
  references: ['Axler, Linear Algebra Done Right (2015)']
});

principle({
  id: 'math.analysis.ode',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Existence and uniqueness for differential equations',
  statement: 'A locally Lipschitz vector field admits a unique maximal solution through each initial condition (Picard–Lindelöf).',
  depends_on: ['math.number.real_field'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Deterministic dynamics: reaction kinetics, pharmacokinetics, population and compartment models.',
  limits: 'Uniqueness fails without Lipschitz continuity; stiff and chaotic systems remain unique yet numerically and predictively fragile.',
  references: ['Hairer, Nørsett & Wanner, Solving Ordinary Differential Equations I (1993)']
});

principle({
  id: 'math.optim.convexity',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Convex optimisation guarantees',
  statement: 'For a convex objective over a convex set every local minimum is global, and duality certifies optimality.',
  depends_on: ['math.linalg.vector_space'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Fitting, docking scoring, experimental design, constrained parameter estimation.',
  limits: 'Molecular conformational and neural-network landscapes are non-convex, so reported optima are search outcomes, not proofs.',
  references: ['Boyd & Vandenberghe, Convex Optimization (2004)']
});

principle({
  id: 'math.dimension.homogeneity',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Dimensional homogeneity',
  statement: 'Every additive term in a physically meaningful equation carries the same dimensions, and any relation can be rewritten among dimensionless groups (Buckingham pi).',
  depends_on: ['math.number.real_field'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Unit checking of every recorded quantity, threshold, and conversion in the harness.',
  limits: 'Homogeneity constrains form but does not supply dimensionless constants or confirm the physics.',
  references: ['Buckingham, Physical Review 4:345 (1914)']
});

principle({
  id: 'math.measure.kolmogorov',
  layer: 'mathematics',
  kind: 'axiom',
  title: 'Kolmogorov probability axioms',
  statement: 'Probability is a countably additive measure of total mass one on a sigma-algebra of events.',
  depends_on: ['math.set.zfc', 'math.number.real_field'],
  status: 'axiomatic',
  confidence: 'definitional',
  scope: 'All uncertainty quantification, sampling, and inference in the harness.',
  limits: 'The axioms fix the calculus, not the interpretation of a probability or the correctness of the assumed sample space.',
  references: ['Kolmogorov, Foundations of the Theory of Probability (1933)']
});

principle({
  id: 'math.probability.bayes',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Bayes theorem',
  statement: 'Posterior probability is proportional to likelihood times prior; evidence updates belief by a fixed rule.',
  depends_on: ['math.measure.kolmogorov'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Diagnostic reasoning, target and hit prioritisation, evidence accumulation across studies.',
  limits: 'The theorem is exact; conclusions inherit whatever error is present in the prior, the likelihood, and the model space.',
  references: ['Gelman et al., Bayesian Data Analysis (2013)']
});

principle({
  id: 'math.probability.lln_clt',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Law of large numbers and central limit theorem',
  statement: 'Sample means of independent draws converge to the expectation, and their fluctuation is asymptotically normal with variance shrinking as 1/n.',
  depends_on: ['math.measure.kolmogorov'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Replicate averaging, Monte Carlo error, power calculations, assay precision.',
  limits: 'Requires finite variance and adequate independence; batch effects and heavy tails break both conclusions.',
  references: ['Billingsley, Probability and Measure (1995)']
});

principle({
  id: 'math.stats.estimand',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Estimand, estimator, estimate',
  statement: 'The target quantity, the procedure applied to data, and the realised number are distinct objects and must be stated separately.',
  depends_on: ['math.measure.kolmogorov'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Analysis contracts, preregistered outcomes, and every reported effect in the harness.',
  limits: 'A precise estimate of an ill-posed estimand answers no question; precision never repairs target mis-specification.',
  references: ['ICH E9(R1) Addendum on Estimands and Sensitivity Analysis (2019)']
});

principle({
  id: 'math.stats.likelihood',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Likelihood and model-conditional inference',
  statement: 'The likelihood is the probability of observed data as a function of parameters under an assumed model; inference is conditional on that model.',
  depends_on: ['math.measure.kolmogorov'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Parameter fitting for dose-response, kinetics, and pharmacokinetic models.',
  limits: 'Comparisons only rank models inside the assumed family; a well-fitting wrong model remains wrong.',
  references: ['Pawitan, In All Likelihood (2001)']
});

principle({
  id: 'math.stats.multiplicity',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Multiplicity and selective inference',
  statement: 'Error rates apply to the whole procedure: testing many hypotheses or selecting after looking inflates false positives unless the family is controlled.',
  depends_on: ['math.probability.lln_clt', 'math.stats.estimand'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'High-throughput screens, omics contrasts, subgroup analyses, repeated interim looks.',
  limits: 'Control requires the analysis family to be declared in advance; corrections cannot be reconstructed honestly after the fact.',
  references: ['Benjamini & Hochberg, JRSS-B 57:289 (1995)']
});

principle({
  id: 'math.stats.t_inference',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Student-t sampling distribution and t-tests',
  statement: 'For independent, approximately normal observations, the standardised sample mean follows a Student-t distribution with n-1 degrees of freedom, and the Welch statistic for two independent samples is approximately t-distributed with Satterthwaite degrees of freedom.',
  depends_on: ['math.probability.lln_clt', 'math.stats.likelihood', 'math.stats.estimand'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Preregistered one-sample and two-sample inferences in schema-3 analysis contracts, replayed by the pinned deterministic statistics engine.',
  limits: 'Nominal error rates assume approximate normality and independence; heavy tails, dependence, or selection after looking invalidate them, and the harness states rather than checks these assumptions.',
  references: ['Student, Biometrika 6:1 (1908)', 'Welch, Biometrika 34:28 (1947)']
});

principle({
  id: 'math.stats.interval_estimation',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Confidence interval coverage',
  statement: 'A confidence procedure at level 1-alpha covers the true estimand in that fraction of repeated samples; coverage is a property of the procedure, not of any single realised interval.',
  depends_on: ['math.stats.estimand', 'math.probability.lln_clt'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Sidedness-matched intervals reported beside every computable preregistered t-test.',
  limits: 'A realised interval either contains the estimand or does not; unadjusted per-outcome intervals do not control family-wise coverage across a corrected decision family.',
  references: ['Neyman, Phil. Trans. R. Soc. A 236:333 (1937)']
});

principle({
  id: 'math.stats.causal_dag',
  layer: 'mathematics',
  kind: 'theorem',
  title: 'Causal identification on a graph',
  statement: 'Given a causal DAG, interventional distributions are identifiable from observational data only when the graph admits a valid adjustment or instrument.',
  depends_on: ['math.graph.dag', 'math.probability.bayes'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Confounding control, mediation claims, observational evidence appraisal, target validation logic.',
  limits: 'Identification is conditional on the assumed graph, which data alone cannot establish. Unmeasured confounding blocks identification entirely.',
  references: ['Pearl, Causality (2009)']
});

principle({
  id: 'math.info.entropy',
  layer: 'mathematics',
  kind: 'definition',
  title: 'Shannon entropy and mutual information',
  statement: 'Entropy measures the average surprise of a distribution; mutual information measures the reduction in one variable\'s entropy given another.',
  depends_on: ['math.measure.kolmogorov'],
  status: 'proved',
  confidence: 'definitional',
  scope: 'Sequence conservation scoring, codon bias, experimental design value, channel limits on measurement.',
  limits: 'Estimated from finite samples it is biased upward for information; alphabet size and sample depth must be reported.',
  references: ['Cover & Thomas, Elements of Information Theory (2006)']
});

// ---------------------------------------------------------------------------
// Tier 1 — physics
// ---------------------------------------------------------------------------

principle({
  id: 'phys.symmetry.noether',
  layer: 'physics',
  kind: 'theorem',
  title: 'Noether correspondence of symmetry and conservation',
  statement: 'Every continuous symmetry of the action yields a conserved current; time-translation invariance yields energy conservation.',
  depends_on: ['math.analysis.ode', 'math.linalg.vector_space'],
  status: 'proved',
  confidence: 'very_high',
  scope: 'Why conservation laws are structural rather than coincidental.',
  limits: 'Applies to systems with a variational formulation and the stated symmetry; dissipative descriptions are effective, not fundamental.',
  references: ['Noether, Nachrichten Göttingen 235 (1918)']
});

principle({
  id: 'phys.mechanics.newton',
  layer: 'physics',
  kind: 'law',
  title: 'Classical mechanics',
  statement: 'Momentum changes at a rate equal to the applied force, and interactions are equal and opposite.',
  depends_on: ['math.analysis.ode', 'math.dimension.homogeneity'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Molecular dynamics integrators, mechanical loading, fluid handling at laboratory scale.',
  limits: 'Breaks down at relativistic speeds and where quantum effects dominate: light nuclei, tunnelling, bond breaking.',
  references: ['Landau & Lifshitz, Mechanics (1976)']
});

principle({
  id: 'phys.thermo.first_law',
  layer: 'physics',
  kind: 'law',
  title: 'Conservation of energy',
  statement: 'The internal energy change of a closed system equals heat added minus work done; energy is neither created nor destroyed.',
  depends_on: ['phys.symmetry.noether', 'math.dimension.homogeneity'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'All energy accounting: reaction enthalpies, metabolic budgets, calorimetry.',
  limits: 'Bookkeeping only. It forbids impossible balances but never predicts which allowed process occurs.',
  references: ['Callen, Thermodynamics and an Introduction to Thermostatistics (1985)']
});

principle({
  id: 'phys.thermo.second_law',
  layer: 'physics',
  kind: 'law',
  title: 'Second law of thermodynamics',
  statement: 'The entropy of an isolated system does not decrease; spontaneous change proceeds toward states of higher total entropy.',
  depends_on: ['phys.thermo.first_law', 'math.measure.kolmogorov'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Direction of chemical and biological processes; why maintaining order requires continuous free-energy input.',
  limits: 'Statistical, not absolute: small systems fluctuate against it transiently, quantified by fluctuation theorems.',
  references: ['Callen, Thermodynamics (1985)', 'Jarzynski, PRL 78:2690 (1997)']
});

principle({
  id: 'phys.stat.boltzmann',
  layer: 'physics',
  kind: 'law',
  title: 'Boltzmann distribution',
  statement: 'At thermal equilibrium the probability of a microstate falls exponentially with its energy in units of kT.',
  depends_on: ['phys.thermo.second_law', 'math.measure.kolmogorov'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Conformational populations, binding equilibria, reaction barriers, ion distributions.',
  limits: 'Requires equilibrium and ergodicity. Living cells are driven, so many biological distributions are non-equilibrium steady states.',
  references: ['Dill & Bromberg, Molecular Driving Forces (2010)']
});

principle({
  id: 'phys.thermo.free_energy',
  layer: 'physics',
  kind: 'definition',
  title: 'Gibbs free energy',
  statement: 'At constant temperature and pressure the accessible work is G = H − TS, and equilibrium sits at its minimum.',
  depends_on: ['phys.thermo.second_law', 'phys.stat.boltzmann'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Binding affinity, folding stability, solubility, reaction spontaneity.',
  limits: 'A state function that says nothing about rate: a strongly favourable reaction may be arbitrarily slow.',
  references: ['Atkins & de Paula, Physical Chemistry (2014)']
});

principle({
  id: 'phys.quantum.schrodinger',
  layer: 'physics',
  kind: 'law',
  title: 'Quantum state evolution',
  statement: 'A quantum state evolves unitarily under the Hamiltonian, and measurable quantities are eigenvalues of self-adjoint operators.',
  depends_on: ['math.linalg.eigen', 'math.analysis.ode'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Electronic structure, spectroscopy, bonding, photochemistry.',
  limits: 'Exactly solvable only for the simplest systems; all molecular applications rely on stated approximations.',
  references: ['Sakurai & Napolitano, Modern Quantum Mechanics (2017)']
});

principle({
  id: 'phys.quantum.pauli',
  layer: 'physics',
  kind: 'law',
  title: 'Pauli exclusion and spin statistics',
  statement: 'The state of identical fermions is antisymmetric under exchange, so no two electrons share all quantum numbers.',
  depends_on: ['phys.quantum.schrodinger'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Shell structure, valence, periodicity, steric repulsion.',
  limits: 'A constraint on allowed states; chemical consequences still require an approximate electronic-structure treatment.',
  references: ['Pauli, Zeitschrift für Physik 31:765 (1925)']
});

principle({
  id: 'phys.quantum.born_oppenheimer',
  layer: 'physics',
  kind: 'approximation',
  title: 'Born–Oppenheimer separation',
  statement: 'Because nuclei are far heavier than electrons, electronic structure can be solved at fixed nuclear positions, defining a potential energy surface.',
  depends_on: ['phys.quantum.schrodinger'],
  status: 'modelled',
  confidence: 'high',
  scope: 'The concept of molecular geometry, force fields, and reaction coordinates.',
  limits: 'Fails at conical intersections and in excited-state and proton-transfer dynamics, where surfaces couple.',
  references: ['Born & Oppenheimer, Annalen der Physik 389:457 (1927)']
});

principle({
  id: 'phys.em.coulomb',
  layer: 'physics',
  kind: 'law',
  title: 'Electrostatic interaction',
  statement: 'Charges interact with a force inversely proportional to the square of separation, screened by the dielectric response of the medium.',
  depends_on: ['phys.mechanics.newton', 'math.dimension.homogeneity'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Ionic bonds, salt bridges, nucleic-acid backbone repulsion, ionic-strength effects.',
  limits: 'In water, screening and desolvation dominate; the vacuum form badly overstates interaction strength in solution.',
  references: ['Jackson, Classical Electrodynamics (1998)']
});

principle({
  id: 'phys.transport.diffusion',
  layer: 'physics',
  kind: 'law',
  title: 'Diffusive transport',
  statement: 'Random thermal motion produces flux down a concentration gradient, with mean square displacement growing linearly in time.',
  depends_on: ['phys.stat.boltzmann', 'math.analysis.ode'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Encounter rates, assay mixing times, membrane transport, tissue penetration.',
  limits: 'Crowded and structured cellular interiors show anomalous, non-Fickian transport; active transport is not diffusive at all.',
  references: ['Berg, Random Walks in Biology (1993)']
});

principle({
  id: 'phys.measurement.uncertainty',
  layer: 'physics',
  kind: 'definition',
  title: 'Measurement uncertainty and traceability',
  statement: 'A measured value is incomplete without an uncertainty and a traceable calibration to a defined unit.',
  depends_on: ['math.dimension.homogeneity', 'math.probability.lln_clt'],
  status: 'measured',
  confidence: 'very_high',
  scope: 'Every recorded instrument reading, assay readout, and derived quantity.',
  limits: 'Type B systematic components rest on judgement; a stated uncertainty can itself be wrong.',
  references: ['JCGM 100:2008, Guide to the Expression of Uncertainty in Measurement']
});

principle({
  id: 'phys.scale.separation',
  layer: 'physics',
  kind: 'approximation',
  title: 'Scale separation and coarse graining',
  statement: 'When fast degrees of freedom equilibrate much faster than slow ones, they can be averaged into effective parameters of a reduced model.',
  depends_on: ['phys.stat.boltzmann', 'math.analysis.ode'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Justifies rate constants, force fields, compartment models, and every layer boundary above physics.',
  limits: 'Fails when timescales overlap; then the coarse model omits the coupling that actually drives the system.',
  references: ['Chandler, Introduction to Modern Statistical Mechanics (1987)']
});

// ---------------------------------------------------------------------------
// Tier 2 — chemistry
// ---------------------------------------------------------------------------

principle({
  id: 'chem.atom.electronic_structure',
  layer: 'chemistry',
  kind: 'model',
  title: 'Atomic electronic structure',
  statement: 'Electrons occupy orbitals of quantised energy and shape; occupancy of the valence shell sets an element\'s chemistry.',
  depends_on: ['phys.quantum.schrodinger', 'phys.quantum.pauli'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Valence, oxidation states, spectra, and the basis of periodic behaviour.',
  limits: 'Orbitals are one-electron constructs; correlation and relativistic effects matter for heavy atoms and fine energetics.',
  references: ['Atkins & Friedman, Molecular Quantum Mechanics (2010)']
});

principle({
  id: 'chem.periodic.periodicity',
  layer: 'chemistry',
  kind: 'empirical_regularity',
  title: 'Periodic trends',
  statement: 'Electronegativity, radius, and ionisation energy vary systematically across periods and groups with valence-shell structure.',
  depends_on: ['chem.atom.electronic_structure'],
  status: 'empirical',
  confidence: 'high',
  scope: 'Predicting bonding character, acidity, and substitution effects.',
  limits: 'Trends are smooth summaries with well-known exceptions; they do not quantify a specific reaction.',
  references: ['Housecroft & Sharpe, Inorganic Chemistry (2018)']
});

principle({
  id: 'chem.bond.covalent',
  layer: 'chemistry',
  kind: 'model',
  title: 'Covalent bonding and molecular geometry',
  statement: 'Shared electron pairs on a Born–Oppenheimer potential surface give directional bonds with characteristic lengths, angles, and rotational barriers.',
  depends_on: ['chem.atom.electronic_structure', 'phys.quantum.born_oppenheimer'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Molecular structure, conformational preference, and the atom-bond graphs the harness parses.',
  limits: 'The bond is a useful abstraction, not an observable; delocalised, hypervalent, and metallic systems strain it.',
  references: ['Clayden et al., Organic Chemistry (2012)']
});

principle({
  id: 'chem.structure.stereochemistry',
  layer: 'chemistry',
  kind: 'definition',
  title: 'Stereochemistry',
  statement: 'Molecules with identical connectivity can differ in three-dimensional arrangement, and enantiomers interact differently with chiral environments.',
  depends_on: ['chem.bond.covalent'],
  status: 'proved',
  confidence: 'high',
  scope: 'Chiral drug activity, differing metabolism and toxicity between enantiomers, biomolecular recognition.',
  limits: 'Configuration is not conformation; a specified stereocentre still leaves conformational freedom.',
  references: ['Eliel & Wilen, Stereochemistry of Organic Compounds (1994)']
});

principle({
  id: 'chem.conservation.stoichiometry',
  layer: 'chemistry',
  kind: 'law',
  title: 'Mass and charge balance',
  statement: 'Atoms and charge are conserved in chemical change, so every reaction balances in fixed integer proportions.',
  depends_on: ['phys.thermo.first_law', 'chem.bond.covalent'],
  status: 'measured',
  confidence: 'high',
  scope: 'Reaction balancing, yield accounting, concentration and dosing arithmetic.',
  limits: 'Balance is necessary and never sufficient: a balanced equation may describe a reaction that does not occur.',
  references: ['Atkins & de Paula, Physical Chemistry (2014)']
});

principle({
  id: 'chem.equilibrium.mass_action',
  layer: 'chemistry',
  kind: 'law',
  title: 'Law of mass action',
  statement: 'At equilibrium the ratio of product to reactant activities is fixed by K = exp(−ΔG°/RT).',
  depends_on: ['phys.thermo.free_energy', 'chem.conservation.stoichiometry'],
  status: 'measured',
  confidence: 'high',
  scope: 'Binding constants, dissociation constants, acid-base equilibria, buffer design.',
  limits: 'Uses activities, not concentrations; crowding, ionic strength, and non-equilibrium driving all break the simple form.',
  references: ['Atkins & de Paula, Physical Chemistry (2014)']
});

principle({
  id: 'chem.kinetics.arrhenius',
  layer: 'chemistry',
  kind: 'model',
  title: 'Barrier-limited reaction rates',
  statement: 'Rate constants scale as exp(−Ea/RT): rate is governed by the barrier, independently of the overall thermodynamic favourability.',
  depends_on: ['phys.stat.boltzmann', 'chem.bond.covalent'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Reaction and degradation rates, shelf life, temperature dependence of assays, residence time.',
  limits: 'Assumes a single dominant barrier and thermal equilibration; tunnelling, diffusion limits, and multi-step paths deviate.',
  references: ['Arrhenius, Z. Phys. Chem. 4:226 (1889)', 'Eyring, J. Chem. Phys. 3:107 (1935)']
});

principle({
  id: 'chem.catalysis.transition_state',
  layer: 'chemistry',
  kind: 'model',
  title: 'Catalysis by transition-state stabilisation',
  statement: 'A catalyst accelerates reaction by lowering the barrier through preferential binding of the transition state, leaving the equilibrium untouched.',
  depends_on: ['chem.kinetics.arrhenius', 'chem.equilibrium.mass_action'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Enzyme mechanism, transition-state-analogue inhibitor design, industrial catalysis.',
  limits: 'Real catalysis also involves proximity, desolvation, and dynamic effects that the static picture omits.',
  references: ['Pauling, Nature 161:707 (1948)', 'Fersht, Structure and Mechanism in Protein Science (1999)']
});

principle({
  id: 'chem.noncovalent.interactions',
  layer: 'chemistry',
  kind: 'model',
  title: 'Non-covalent interactions',
  statement: 'Hydrogen bonds, van der Waals contacts, salt bridges, and aromatic stacking each contribute a few kJ/mol, and their sum determines molecular recognition.',
  depends_on: ['phys.em.coulomb', 'chem.bond.covalent'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Protein folding, base pairing, ligand binding, crystal packing, formulation.',
  limits: 'Individually weak and highly geometry dependent; net affinity in water is a small difference between large enthalpic and entropic terms.',
  references: ['Israelachvili, Intermolecular and Surface Forces (2011)']
});

principle({
  id: 'chem.solvation.hydrophobic_effect',
  layer: 'chemistry',
  kind: 'model',
  title: 'Hydrophobic effect and desolvation',
  statement: 'Burying non-polar surface releases ordered water, so association in water is substantially entropy driven and requires paying a desolvation cost for polar groups.',
  depends_on: ['phys.thermo.second_law', 'chem.noncovalent.interactions'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Protein cores, membrane assembly, binding-pocket occupancy, aggregation risk.',
  limits: 'Temperature dependence is complex and enthalpy-entropy compensation makes term-by-term attribution unreliable.',
  references: ['Kauzmann, Adv. Protein Chem. 14:1 (1959)', 'Chandler, Nature 437:640 (2005)']
});

principle({
  id: 'chem.acidbase.pka',
  layer: 'chemistry',
  kind: 'definition',
  title: 'Ionisation and pKa',
  statement: 'Protonation state follows the Henderson–Hasselbalch relation between pH and pKa, changing charge, solubility, and binding.',
  depends_on: ['chem.equilibrium.mass_action'],
  status: 'proved',
  confidence: 'high',
  scope: 'Absorption across gut and membrane pH gradients, formulation, buffer choice, charge state in a binding site.',
  limits: 'Microenvironment inside a protein or micelle can shift pKa by several units from the solution value.',
  references: ['Perrin, Dempsey & Serjeant, pKa Prediction for Organic Acids and Bases (1981)']
});

principle({
  id: 'chem.partition.lipophilicity',
  layer: 'chemistry',
  kind: 'empirical_regularity',
  title: 'Partitioning and lipophilicity',
  statement: 'A solute distributes between aqueous and lipid phases according to logP, adjusted for ionisation as logD at a given pH.',
  depends_on: ['chem.solvation.hydrophobic_effect', 'chem.acidbase.pka'],
  status: 'empirical',
  confidence: 'moderate',
  scope: 'Permeability, plasma protein binding, metabolic clearance, and aggregation propensity in screens.',
  limits: 'An octanol-water surrogate for a biological membrane; calculated values carry roughly a log-unit of error.',
  references: ['Leo, Hansch & Elkins, Chem. Rev. 71:525 (1971)']
});

principle({
  id: 'chem.spectroscopy.beer_lambert',
  layer: 'chemistry',
  kind: 'law',
  title: 'Beer–Lambert absorbance',
  statement: 'Absorbance is proportional to path length and concentration through a species-specific molar extinction coefficient.',
  depends_on: ['phys.quantum.schrodinger', 'chem.equilibrium.mass_action'],
  status: 'measured',
  confidence: 'high',
  scope: 'Quantifying nucleic acid and protein concentration, plate-reader assay readouts.',
  limits: 'Linear only in a bounded range; scattering, aggregation, and high absorbance break proportionality.',
  references: ['Skoog, Holler & Crouch, Principles of Instrumental Analysis (2017)']
});

principle({
  id: 'chem.macromolecule.polymer',
  layer: 'chemistry',
  kind: 'definition',
  title: 'Directional biopolymers',
  statement: 'Repeated condensation of monomers yields a chain with defined directionality and a sequence that carries information independent of composition.',
  depends_on: ['chem.bond.covalent', 'chem.conservation.stoichiometry'],
  status: 'proved',
  confidence: 'high',
  scope: 'Nucleic acids read 5\' to 3\'; polypeptides read N to C. Sequence notation depends on this.',
  limits: 'Chemistry fixes the alphabet and linkage, not which sequences occur or what they mean biologically.',
  references: ['Nelson & Cox, Lehninger Principles of Biochemistry (2021)']
});

// ---------------------------------------------------------------------------
// Tier 3 — biology
// ---------------------------------------------------------------------------

principle({
  id: 'bio.cell.theory',
  layer: 'biology',
  kind: 'empirical_regularity',
  title: 'Cell theory',
  statement: 'All known organisms are composed of cells, and every cell arises from a pre-existing cell.',
  depends_on: ['chem.macromolecule.polymer', 'chem.noncovalent.interactions'],
  status: 'empirical',
  confidence: 'high',
  scope: 'The compartment boundary that defines concentration, transport, and dose at the cellular level.',
  limits: 'Viruses and prions replicate without being cells; syncytia and biofilms blur individual boundaries.',
  references: ['Alberts et al., Molecular Biology of the Cell (2022)']
});

principle({
  id: 'bio.energetics.dissipative_order',
  layer: 'biology',
  kind: 'model',
  title: 'Life as a driven system',
  statement: 'Organisms maintain low-entropy organisation by continuously dissipating free energy, so cellular concentrations are non-equilibrium steady states.',
  depends_on: ['phys.thermo.second_law', 'bio.cell.theory'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Why in-vitro equilibrium constants under-predict in-cell behaviour; why ATP-coupled steps run against gradients.',
  limits: 'Qualitative direction only; it does not quantify any specific flux without a measured model.',
  references: ['Schrödinger, What is Life? (1944)', 'Nelson & Cox, Lehninger (2021)']
});

principle({
  id: 'bio.evolution.selection',
  layer: 'biology',
  kind: 'law',
  title: 'Descent with modification under selection',
  statement: 'Heritable variation with differential reproductive success produces adaptation and common descent; shared ancestry explains molecular similarity across taxa.',
  depends_on: ['bio.cell.theory', 'math.probability.lln_clt'],
  status: 'empirical',
  confidence: 'high',
  scope: 'Model-organism relevance, homology-based annotation, resistance emergence, antigenic drift.',
  limits: 'Explains history and constraint, not optimality. Drift, linkage, and contingency mean traits need not be adaptive.',
  references: ['Darwin, On the Origin of Species (1859)', 'Lynch, The Origins of Genome Architecture (2007)']
});

principle({
  id: 'bio.dna.double_helix',
  layer: 'biology',
  kind: 'model',
  title: 'DNA structure and complementary base pairing',
  statement: 'Two antiparallel strands pair A with T and G with C through hydrogen bonds and stacking, making each strand a template for the other.',
  depends_on: ['chem.macromolecule.polymer', 'chem.noncovalent.interactions'],
  status: 'measured',
  confidence: 'high',
  scope: 'Replication, hybridisation, primer and guide design, sequencing chemistry, melting temperature.',
  limits: 'Canonical B-form only; G-quadruplexes, triplexes, mismatches, and modified bases deviate. Stability is sequence and salt dependent.',
  references: ['Watson & Crick, Nature 171:737 (1953)', 'SantaLucia, PNAS 95:1460 (1998)']
});

principle({
  id: 'bio.info.central_dogma',
  layer: 'biology',
  kind: 'model',
  title: 'Sequential information flow',
  statement: 'Sequence information passes DNA to RNA to protein; it is not transferred back out of protein into nucleic acid sequence.',
  depends_on: ['bio.dna.double_helix', 'bio.energetics.dissipative_order'],
  status: 'empirical',
  confidence: 'high',
  scope: 'Expression constructs, transcriptomic inference, mRNA-based platforms.',
  limits: 'Reverse transcription and RNA replication run backwards along the nucleic-acid axis; regulation, splicing, and modification break any simple one-gene-one-protein reading.',
  references: ['Crick, Nature 227:561 (1970)']
});

principle({
  id: 'bio.genetics.genetic_code',
  layer: 'biology',
  kind: 'empirical_regularity',
  title: 'The genetic code',
  statement: 'Nucleotide triplets specify amino acids through a degenerate, near-universal code read in a fixed frame from a start codon.',
  depends_on: ['bio.info.central_dogma', 'chem.macromolecule.polymer'],
  status: 'empirical',
  confidence: 'high',
  scope: 'Translation, codon optimisation, frameshift and nonsense variant interpretation.',
  limits: 'Not universal: mitochondrial and some nuclear codes reassign codons; selenocysteine and pyrrolysine are recoded contextually.',
  references: ['Nirenberg & Leder, Science 145:1399 (1964)', 'Elzanowski & Ostell, NCBI Genetic Codes (2019)']
});

principle({
  id: 'bio.protein.anfinsen',
  layer: 'biology',
  kind: 'model',
  title: 'Sequence determines fold',
  statement: 'For many small proteins the native structure is the free-energy minimum encoded by the amino-acid sequence under physiological conditions.',
  depends_on: ['chem.solvation.hydrophobic_effect', 'phys.thermo.free_energy', 'bio.genetics.genetic_code'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Structure prediction, stability engineering, effect of missense variants.',
  limits: 'Chaperone-dependent, aggregation-prone, intrinsically disordered, and metastable proteins violate it. Marginal stability means small ΔΔG shifts matter.',
  references: ['Anfinsen, Science 181:223 (1973)', 'Dill & MacCallum, Science 338:1042 (2012)']
});

principle({
  id: 'bio.protein.structure_function',
  layer: 'biology',
  kind: 'model',
  title: 'Structure-encoded function',
  statement: 'Function arises from a shaped, chemically complementary surface, and conformational change couples binding to catalysis and signalling.',
  depends_on: ['bio.protein.anfinsen', 'chem.catalysis.transition_state'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Druggability assessment, allostery, mechanism-of-action reasoning, epitope accessibility.',
  limits: 'A static structure is one snapshot of an ensemble; cryptic pockets and disordered regions are poorly represented by it.',
  references: ['Fersht, Structure and Mechanism in Protein Science (1999)']
});

principle({
  id: 'bio.binding.affinity',
  layer: 'biology',
  kind: 'model',
  title: 'Receptor occupancy and dissociation constant',
  statement: 'Reversible binding follows mass action: fractional occupancy is [L]/([L]+Kd), and Kd is set by the binding free energy.',
  depends_on: ['chem.equilibrium.mass_action', 'chem.noncovalent.interactions'],
  status: 'measured',
  confidence: 'high',
  scope: 'Affinity measurement, target engagement, competitive assay design, selectivity ratios.',
  limits: 'Assumes equilibrium, reversibility, and one site. Cooperativity, covalent or slow-off binding, and depletion all invalidate the simple form.',
  references: ['Hulme & Trevethick, Br. J. Pharmacol. 161:1219 (2010)']
});

principle({
  id: 'bio.enzyme.michaelis_menten',
  layer: 'biology',
  kind: 'model',
  title: 'Enzyme saturation kinetics',
  statement: 'Rate rises with substrate to a maximum: v = Vmax[S]/(Km+[S]), with catalytic efficiency kcat/Km.',
  depends_on: ['bio.binding.affinity', 'chem.kinetics.arrhenius'],
  status: 'modelled',
  confidence: 'high',
  scope: 'Enzyme assays, inhibitor mode determination, metabolic clearance modelling.',
  limits: 'Requires steady state and substrate excess; allosteric, multi-substrate, and in-cell crowded systems depart from it.',
  references: ['Michaelis & Menten, Biochem. Z. 49:333 (1913)', 'Cornish-Bowden, Fundamentals of Enzyme Kinetics (2012)']
});

principle({
  id: 'bio.membrane.permeability',
  layer: 'biology',
  kind: 'model',
  title: 'Membrane passage',
  statement: 'Small lipophilic neutral species cross lipid bilayers passively; polar, charged, and large species require transporters or are excluded.',
  depends_on: ['chem.partition.lipophilicity', 'phys.transport.diffusion', 'bio.cell.theory'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Oral absorption, cell entry, blood-brain barrier penetration, efflux liability.',
  limits: 'Active uptake and efflux transporters dominate for many compounds, so passive descriptors alone mispredict exposure.',
  references: ['Sugano et al., Nat. Rev. Drug Discov. 9:597 (2010)']
});

principle({
  id: 'bio.regulation.gene_expression',
  layer: 'biology',
  kind: 'model',
  title: 'Regulated gene expression',
  statement: 'Transcription and translation are controlled by cis elements, trans factors, chromatin state, and RNA stability, so abundance is context specific.',
  depends_on: ['bio.info.central_dogma', 'bio.energetics.dissipative_order'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Expression construct design, promoter choice, tissue-specific target expression, transcriptomic interpretation.',
  limits: 'mRNA level is a weak proxy for protein level; regulation is cell-type, state, and time dependent.',
  references: ['Alberts et al., Molecular Biology of the Cell (2022)']
});

principle({
  id: 'bio.systems.feedback',
  layer: 'biology',
  kind: 'model',
  title: 'Homeostatic feedback',
  statement: 'Biological networks are densely feedback regulated, so perturbing one node provokes compensation and steady-state response need not track the local perturbation.',
  depends_on: ['math.analysis.ode', 'bio.regulation.gene_expression'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Why target inhibition can fail in vivo, adaptive resistance, dose-schedule dependence.',
  limits: 'Network topology is usually incompletely known, so compensation is often discovered rather than predicted.',
  references: ['Kitano, Nat. Rev. Genet. 5:826 (2004)']
});

principle({
  id: 'bio.genomics.variation',
  layer: 'biology',
  kind: 'definition',
  title: 'Genomic variation and coordinates',
  statement: 'Variants are defined only relative to a named reference assembly and transcript, using explicit coordinate and normalisation conventions.',
  depends_on: ['bio.dna.double_helix', 'bio.evolution.selection'],
  status: 'proved',
  confidence: 'high',
  scope: 'Variant calling, annotation, guide-target matching, interpretation of sequencing output.',
  limits: 'Assembly and transcript versions differ; unnormalised indels and strand ambiguity silently corrupt comparisons.',
  references: ['den Dunnen et al., Hum. Mutat. 37:564 (2016)']
});

principle({
  id: 'bio.immune.clonal_selection',
  layer: 'biology',
  kind: 'model',
  title: 'Clonal selection and immune memory',
  statement: 'Lymphocytes carry diverse randomly generated receptors; antigen binding drives clonal expansion and leaves a memory population that responds faster on re-exposure.',
  depends_on: ['bio.evolution.selection', 'bio.binding.affinity'],
  status: 'empirical',
  confidence: 'high',
  scope: 'Why prophylactic immunisation is possible; boosting schedules; memory as the aim of vaccination.',
  limits: 'Memory quality, breadth, and durability vary by pathogen, platform, and host; tolerance and exhaustion counteract it.',
  references: ['Burnet, The Clonal Selection Theory of Acquired Immunity (1959)', 'Murphy & Weaver, Janeway\'s Immunobiology (2022)']
});

principle({
  id: 'bio.immune.antigen_presentation',
  layer: 'biology',
  kind: 'model',
  title: 'Antigen recognition and presentation',
  statement: 'B-cell receptors bind conformational surface epitopes, while T cells recognise processed peptides presented on polymorphic MHC molecules.',
  depends_on: ['bio.immune.clonal_selection', 'bio.protein.structure_function'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Antigen and epitope selection, adjuvant and delivery choice, HLA coverage of a candidate immunogen.',
  limits: 'Peptide-MHC binding prediction is imperfect and population HLA diversity means single-allele analyses do not generalise.',
  references: ['Murphy & Weaver, Janeway\'s Immunobiology (2022)']
});

principle({
  id: 'bio.immune.affinity_maturation',
  layer: 'biology',
  kind: 'model',
  title: 'Affinity maturation',
  statement: 'Somatic hypermutation with selection in germinal centres raises antibody affinity over weeks, so response quality changes with time after exposure.',
  depends_on: ['bio.immune.clonal_selection', 'bio.evolution.selection'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Prime-boost intervals, timing of immunogenicity sampling, breadth of neutralising responses.',
  limits: 'Kinetics and outcome differ by antigen, platform, adjuvant, age, and prior exposure history.',
  references: ['Victora & Nussenzweig, Annu. Rev. Immunol. 40:413 (2022)']
});

principle({
  id: 'bio.pathogen.evolution',
  layer: 'biology',
  kind: 'model',
  title: 'Pathogen and tumour escape',
  statement: 'Large replicating populations under selective pressure accumulate escape variants, so single-target pressure erodes over time.',
  depends_on: ['bio.evolution.selection', 'bio.genomics.variation'],
  status: 'empirical',
  confidence: 'high',
  scope: 'Antimicrobial and antiviral resistance, antigenic drift, combination therapy rationale, conserved-epitope strategy.',
  limits: 'Rate and route of escape depend on mutation supply, fitness cost, and transmission dynamics, none of which are predictable in detail.',
  references: ['zur Wiesch et al., Lancet Infect. Dis. 11:236 (2011)']
});

// ---------------------------------------------------------------------------
// Tier 4 — applied biomedicine
// ---------------------------------------------------------------------------

principle({
  id: 'med.target.validation',
  layer: 'biomedicine',
  kind: 'heuristic',
  title: 'Target validation evidence',
  statement: 'Confidence in a target rests on convergent human genetic, expression, perturbation, and pharmacological evidence linking it causally to disease.',
  depends_on: ['math.stats.causal_dag', 'bio.systems.feedback', 'bio.genomics.variation'],
  status: 'heuristic',
  confidence: 'provisional',
  scope: 'Deciding whether to open a discovery programme against a target.',
  limits: 'Association is not causation, and human-genetic support raises but does not guarantee success. Most validated targets still fail in the clinic.',
  references: ['Nelson et al., Nat. Genet. 47:856 (2015)', 'Minikel et al., Nature 626:1 (2024)']
});

principle({
  id: 'med.assay.dose_response',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Concentration-response and potency',
  statement: 'Response follows a sigmoid Hill curve; IC50/EC50 summarise potency only relative to the assay format, substrate concentration, and incubation time.',
  depends_on: ['bio.binding.affinity', 'bio.enzyme.michaelis_menten', 'math.stats.likelihood'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Screening, potency ranking, selectivity panels, structure-activity relationships.',
  limits: 'IC50 is not Kd and is not comparable across assay conditions. Compound aggregation, reactivity, and readout interference produce false actives.',
  references: ['Cheng & Prusoff, Biochem. Pharmacol. 22:3099 (1973)', 'Baell & Holloway, J. Med. Chem. 53:2719 (2010)']
});

principle({
  id: 'med.pharmacology.exposure_response',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Exposure drives effect',
  statement: 'Effect tracks unbound concentration at the target site over time, not administered dose, so absorption, distribution, metabolism, and excretion mediate every in-vivo result.',
  depends_on: ['bio.membrane.permeability', 'med.assay.dose_response', 'math.analysis.ode'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Dose selection, schedule design, interpretation of negative in-vivo results, translation from potency to dose.',
  limits: 'Plasma exposure is a proxy for tissue exposure; protein binding, transporters, and metabolism differ between species and individuals.',
  references: ['Rowland & Tozer, Clinical Pharmacokinetics and Pharmacodynamics (2010)']
});

principle({
  id: 'med.safety.selectivity',
  layer: 'biomedicine',
  kind: 'heuristic',
  title: 'Selectivity and off-target liability',
  statement: 'Adverse effects arise from engagement of unintended targets or on-target activity in the wrong tissue; a therapeutic window is the margin between the two exposures.',
  depends_on: ['bio.binding.affinity', 'med.pharmacology.exposure_response', 'bio.systems.feedback'],
  status: 'heuristic',
  confidence: 'provisional',
  scope: 'Counter-screening, safety pharmacology panels, go/no-go on a chemical series.',
  limits: 'Panels cover a small fraction of the proteome and cannot detect idiosyncratic or immune-mediated toxicity. A clean panel is weak evidence of safety.',
  references: ['Bowes et al., Nat. Rev. Drug Discov. 11:909 (2012)']
});

principle({
  id: 'med.admet.developability',
  layer: 'biomedicine',
  kind: 'heuristic',
  title: 'Developability rules of thumb',
  statement: 'Property filters such as molecular weight, lipophilicity, and hydrogen-bond counts summarise historical oral-drug distributions and flag likely liabilities.',
  depends_on: ['chem.partition.lipophilicity', 'bio.membrane.permeability'],
  status: 'heuristic',
  confidence: 'provisional',
  scope: 'Early triage of large compound sets and library design.',
  limits: 'Descriptive of past successes, not predictive of any single compound. Numerous approved drugs violate them; applying filters as hard gates discards viable chemistry.',
  references: ['Lipinski et al., Adv. Drug Deliv. Rev. 23:3 (1997)', 'Doak et al., Chem. Biol. 21:1115 (2014)']
});

principle({
  id: 'med.evidence.trial_design',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Randomisation, blinding, and control',
  statement: 'Randomised allocation with concealment and blinding makes treatment groups exchangeable in expectation, which is what licenses a causal reading of the contrast.',
  depends_on: ['math.stats.causal_dag', 'math.stats.estimand', 'math.probability.lln_clt'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'Any comparative claim, in vitro through clinical.',
  limits: 'Randomisation balances in expectation, not in any single trial. Attrition, unblinding, and surrogate endpoints reintroduce bias.',
  references: ['Hernán & Robins, Causal Inference: What If (2020)']
});

principle({
  id: 'med.evidence.preregistration',
  layer: 'biomedicine',
  kind: 'governance',
  title: 'Preregistration and analysis contracts',
  statement: 'Freezing hypothesis, outcome, analysis, and decision thresholds before unblinding is what makes a stated error rate meaningful; later analyses are exploratory and must be labelled so.',
  depends_on: ['math.stats.multiplicity', 'med.evidence.trial_design'],
  status: 'normative',
  confidence: 'provisional',
  scope: 'The harness preregistration, analysis-contract, and confirmatory-assessment records.',
  limits: 'Preregistration constrains reporting; it does not make a design valid, an assay relevant, or a result true.',
  references: ['Nosek et al., PNAS 115:2600 (2018)', 'ICH E9(R1) (2019)']
});

principle({
  id: 'med.translation.model_validity',
  layer: 'biomedicine',
  kind: 'heuristic',
  title: 'Translational validity of models',
  statement: 'A cell line, organoid, or animal model supports a human claim only to the extent that its relevant mechanism, exposure, and endpoint correspond.',
  depends_on: ['bio.evolution.selection', 'med.pharmacology.exposure_response', 'med.evidence.trial_design'],
  status: 'heuristic',
  confidence: 'provisional',
  scope: 'Weighting preclinical evidence and deciding whether a result justifies escalation.',
  limits: 'Species differences in target biology, immunology, and metabolism are common; most preclinical efficacy does not reproduce in humans.',
  references: ['Perrin, Nature 507:423 (2014)', 'Seok et al., PNAS 110:3507 (2013)']
});

principle({
  id: 'bioeng.dna.hybridisation_design',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Primer and probe design',
  statement: 'Hybridisation specificity and melting temperature follow nearest-neighbour thermodynamics under stated salt and strand concentrations.',
  depends_on: ['bio.dna.double_helix', 'chem.equilibrium.mass_action'],
  status: 'modelled',
  confidence: 'moderate',
  scope: 'PCR primers, qPCR probes, hybridisation capture, sequencing adapters.',
  limits: 'Predicted Tm carries several degrees of error; secondary structure, mispriming, and genomic repeats require explicit checking against the target assembly.',
  references: ['SantaLucia & Hicks, Annu. Rev. Biophys. 33:415 (2004)']
});

principle({
  id: 'bioeng.dna.codon_optimisation',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Codon and sequence optimisation',
  statement: 'Synonymous recoding toward host codon usage, with controlled GC content and removed destabilising motifs, changes expression without changing protein sequence.',
  depends_on: ['bio.genetics.genetic_code', 'bio.regulation.gene_expression', 'math.info.entropy'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Recombinant protein expression and nucleic-acid platform constructs.',
  limits: 'Synonymous is not neutral: recoding can alter folding kinetics, mRNA structure, and immunogenicity. Gains are empirical and require measurement.',
  references: ['Gustafsson et al., Trends Biotechnol. 22:346 (2004)', 'Kimchi-Sarfaty et al., Science 315:525 (2007)']
});

principle({
  id: 'bioeng.dna.targeted_editing',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Programmable nuclease targeting',
  statement: 'RNA-guided nucleases cut where a guide matches an adjacent protospacer motif; specificity is set by guide-genome complementarity and repair outcome by the cell\'s pathway choice.',
  depends_on: ['bio.dna.double_helix', 'bio.genomics.variation', 'bioeng.dna.hybridisation_design'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'In-silico guide selection, off-target enumeration against a named assembly, and edit-outcome expectations for research use.',
  limits: 'Off-target prediction is incomplete, repair outcomes are heterogeneous, and delivery dominates real-world performance. Computational design is not authorisation to edit any organism.',
  references: ['Doudna & Charpentier, Science 346:1258096 (2014)', 'Tsai et al., Nat. Biotechnol. 33:187 (2015)']
});

principle({
  id: 'bioeng.protein.expression_construct',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Expression construct design',
  statement: 'A functional construct requires a compatible promoter, ribosome-binding or Kozak context, an in-frame coding sequence, tags and linkers, and a terminator, all in the host\'s context.',
  depends_on: ['bio.info.central_dogma', 'bio.regulation.gene_expression', 'bioeng.dna.codon_optimisation'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Producing a protein for assay, structure work, or as a candidate biologic.',
  limits: 'Expression, solubility, and correct folding are empirical outcomes; tags can perturb function and must be controlled for.',
  references: ['Rosano & Ceccarelli, Front. Microbiol. 5:172 (2014)']
});

principle({
  id: 'bioeng.protein.structure_prediction',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Computational structure and interface prediction',
  statement: 'Learned predictors infer structure from sequence and co-evolutionary signal, reporting per-residue and interface confidence that must be carried into any downstream claim.',
  depends_on: ['bio.protein.anfinsen', 'bio.protein.structure_function', 'math.optim.convexity'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Hypothesis generation for mechanism, pocket identification, variant effect triage, epitope accessibility.',
  limits: 'Accuracy degrades for disordered regions, novel folds, complexes, and conformational change; predicted structures are not experimental structures and confidence scores are not accuracy guarantees.',
  references: ['Jumper et al., Nature 596:583 (2021)', 'Terwilliger et al., Nat. Methods 21:110 (2024)']
});

principle({
  id: 'bioeng.protein.stability_engineering',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Stability and affinity engineering',
  statement: 'Designed substitutions shift folding and binding free energies; predicted ΔΔG ranks candidates for testing rather than establishing an outcome.',
  depends_on: ['phys.thermo.free_energy', 'bio.protein.anfinsen', 'bioeng.protein.structure_prediction'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Thermostabilised antigens, engineered enzymes, affinity-matured binders.',
  limits: 'Prediction error is comparable to the effect sizes sought, epistasis between substitutions is common, and stability gains often cost activity.',
  references: ['Tokuriki & Tawfik, Curr. Opin. Struct. Biol. 19:596 (2009)']
});

principle({
  id: 'bioeng.vaccine.antigen_selection',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Antigen and epitope selection',
  statement: 'A candidate immunogen presents accessible, conserved epitopes in a conformation resembling the native target, with population HLA coverage considered for T-cell responses.',
  depends_on: ['bio.immune.antigen_presentation', 'bio.pathogen.evolution', 'bioeng.protein.structure_prediction'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Prophylactic and therapeutic immunogen design against a declared, characterised target.',
  limits: 'Epitope prediction is unreliable in isolation and immunodominance is not predictable; conservation analysis depends on the sampled sequence set.',
  references: ['Rappuoli et al., Nat. Rev. Immunol. 16:81 (2016)', 'Graham et al., Annu. Rev. Med. 70:91 (2019)']
});

principle({
  id: 'bioeng.vaccine.conformational_stabilisation',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Conformational stabilisation of immunogens',
  statement: 'Locking a metastable surface protein in the conformation bearing neutralising epitopes can raise the quality of the elicited response relative to the unmodified antigen.',
  depends_on: ['bioeng.protein.stability_engineering', 'bioeng.vaccine.antigen_selection'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Structure-based immunogen design for enveloped viral targets.',
  limits: 'Generalises poorly between pathogens; improved binding of a neutralising antibody in vitro does not establish protection in vivo.',
  references: ['McLellan et al., Science 342:592 (2013)', 'Pallesen et al., PNAS 114:E7348 (2017)']
});

principle({
  id: 'bioeng.vaccine.platform_delivery',
  layer: 'biomedicine',
  kind: 'model',
  title: 'Platform and adjuvant selection',
  statement: 'The delivery platform and adjuvant set the magnitude, quality, and durability of the response as much as the antigen sequence does.',
  depends_on: ['bio.immune.clonal_selection', 'bio.immune.affinity_maturation', 'bioeng.dna.codon_optimisation'],
  status: 'modelled',
  confidence: 'provisional',
  scope: 'Comparing protein-subunit, viral-vector, and nucleic-acid platforms for a declared antigen.',
  limits: 'Platform performance is antigen and population specific; reactogenicity, cold chain, and manufacturability are decision criteria that no sequence analysis addresses.',
  references: ['Pardi et al., Nat. Rev. Drug Discov. 17:261 (2018)']
});

principle({
  id: 'bioeng.vaccine.correlates',
  layer: 'biomedicine',
  kind: 'heuristic',
  title: 'Immunogenicity is not protection',
  statement: 'An immune readout supports a protection claim only where a correlate of protection has been independently established for that pathogen and platform.',
  depends_on: ['bio.immune.affinity_maturation', 'med.evidence.trial_design', 'med.translation.model_validity'],
  status: 'heuristic',
  confidence: 'provisional',
  scope: 'Interpreting titres, deciding whether immunogenicity data can substitute for an efficacy endpoint.',
  limits: 'Correlates are pathogen specific, often only relative rather than absolute, and can fail against antigenically drifted strains.',
  references: ['Plotkin, Clin. Vaccine Immunol. 17:1055 (2010)']
});

principle({
  id: 'bioeng.biosafety.dual_use',
  layer: 'biomedicine',
  kind: 'governance',
  title: 'Biosafety, biosecurity, and dual-use review',
  statement: 'Sequence and construct design work requires institutional biosafety review, applicable containment, and dual-use screening before any physical execution; computational output authorises nothing.',
  depends_on: ['bio.pathogen.evolution', 'med.evidence.preregistration'],
  status: 'normative',
  confidence: 'provisional',
  scope: 'Every biomolecular design record the harness produces, without exception.',
  limits: 'ScienceCode does not verify identity, institutional approval, containment level, or synthesis-provider screening. It records a claim of review; it never substitutes for one.',
  references: ['WHO Laboratory Biosafety Manual, 4th ed. (2020)', 'NIH Guidelines for Research Involving Recombinant or Synthetic Nucleic Acid Molecules (2024)']
});

// ---------------------------------------------------------------------------
// Domain packs — grounded entry points used by the harness workflows.
// ---------------------------------------------------------------------------

const DOMAIN_PACKS = {
  drug_discovery: {
    label: 'Drug discovery',
    summary: 'Target through candidate reasoning grounded in binding thermodynamics, exposure, and causal evidence.',
    roots: [
      'med.target.validation',
      'med.assay.dose_response',
      'med.pharmacology.exposure_response',
      'med.safety.selectivity',
      'med.admet.developability',
      'med.translation.model_validity'
    ]
  },
  nucleic_acid_design: {
    label: 'DNA and RNA design',
    summary: 'Sequence-level design resting on base pairing, the genetic code, and named reference coordinates.',
    roots: [
      'bioeng.dna.hybridisation_design',
      'bioeng.dna.codon_optimisation',
      'bioeng.dna.targeted_editing',
      'bio.genomics.variation',
      'bioeng.biosafety.dual_use'
    ]
  },
  protein_engineering: {
    label: 'Protein engineering',
    summary: 'Structure and stability reasoning resting on folding thermodynamics and its stated failure modes.',
    roots: [
      'bioeng.protein.expression_construct',
      'bioeng.protein.structure_prediction',
      'bioeng.protein.stability_engineering',
      'bio.protein.structure_function',
      'bioeng.biosafety.dual_use'
    ]
  },
  vaccine_design: {
    label: 'Vaccine design',
    summary: 'Immunogen reasoning resting on clonal selection, antigen presentation, and pathogen evolution.',
    roots: [
      'bioeng.vaccine.antigen_selection',
      'bioeng.vaccine.conformational_stabilisation',
      'bioeng.vaccine.platform_delivery',
      'bioeng.vaccine.correlates',
      'bioeng.biosafety.dual_use'
    ]
  },
  evidence_appraisal: {
    label: 'Evidence appraisal',
    summary: 'Design and inference constraints that make a comparative claim readable as causal.',
    roots: [
      'med.evidence.trial_design',
      'med.evidence.preregistration',
      'math.stats.multiplicity',
      'math.stats.causal_dag',
      'math.stats.estimand'
    ]
  },
  statistical_inference: {
    label: 'Statistical inference',
    summary: 'Preregistered frequentist decisions: t-tests, interval coverage, and family-wise error control under stated assumptions.',
    roots: [
      'math.stats.t_inference',
      'math.stats.interval_estimation',
      'math.stats.multiplicity',
      'math.stats.estimand',
      'math.numeric.floating_point'
    ]
  },
  measurement: {
    label: 'Measurement and computation',
    summary: 'Dimensional, numerical, and metrological constraints on any recorded quantity.',
    roots: [
      'math.dimension.homogeneity',
      'phys.measurement.uncertainty',
      'math.numeric.floating_point',
      'math.probability.lln_clt'
    ]
  }
};

// ---------------------------------------------------------------------------
// Compilation and invariant checking
// ---------------------------------------------------------------------------

function knowledgeError(message, code = 'INVALID_KNOWLEDGE_BASE') {
  return Object.assign(new Error(message), { code });
}

// Compilation records every violation instead of throwing, so an unsound base
// stays diagnosable: `knowledge verify` and `doctor` can name what is wrong
// rather than dying with an import-time stack trace. Nothing can be read out of
// an unsound base — every query path calls assertSound() first.
const VIOLATIONS = [];

function compile() {
  const byId = new Map();
  for (const spec of RAW) {
    if (byId.has(spec.id)) {
      VIOLATIONS.push('Duplicate knowledge principle id: ' + spec.id);
      continue;
    }
    const layer = LAYER_BY_ID.get(spec.layer);
    if (!layer) {
      VIOLATIONS.push('Unknown knowledge layer for ' + spec.id + ': ' + spec.layer);
      continue;
    }
    if (!KINDS.has(spec.kind)) {
      VIOLATIONS.push('Unknown knowledge kind for ' + spec.id + ': ' + spec.kind);
      continue;
    }
    if (!STATUSES.has(spec.status)) {
      VIOLATIONS.push('Unknown epistemic status for ' + spec.id + ': ' + spec.status);
      continue;
    }
    if (!Object.hasOwn(CONFIDENCE_RANKS, spec.confidence)) {
      VIOLATIONS.push('Unknown confidence for ' + spec.id + ': ' + spec.confidence);
      continue;
    }
    if (spec.kind === 'axiom' && layer.tier !== 0) {
      VIOLATIONS.push('Only the mathematics layer may declare axioms: ' + spec.id);
    }
    byId.set(spec.id, Object.freeze({
      id: spec.id,
      layer: layer.id,
      tier: layer.tier,
      kind: spec.kind,
      title: spec.title,
      statement: spec.statement,
      depends_on: Object.freeze([...spec.depends_on]),
      epistemic: Object.freeze({
        status: spec.status,
        confidence: spec.confidence,
        confidence_rank: CONFIDENCE_RANKS[spec.confidence],
        falsifiable: spec.status !== 'axiomatic' && spec.status !== 'normative'
      }),
      scope: spec.scope,
      limits: spec.limits,
      references: Object.freeze([...spec.references])
    }));
  }

  // Unresolvable edges are dropped so the graph stays walkable for reporting;
  // the violation is what stops the base from being read.
  const edges = new Map();
  for (const principleRecord of byId.values()) {
    const resolved = [];
    for (const dependency of principleRecord.depends_on) {
      const parent = byId.get(dependency);
      if (!parent) {
        VIOLATIONS.push('Unresolved dependency ' + dependency + ' for ' + principleRecord.id);
        continue;
      }
      resolved.push(dependency);
      if (parent.tier > principleRecord.tier) {
        VIOLATIONS.push(
          'Layer inversion: ' + principleRecord.id + ' (' + principleRecord.layer + ') depends on ' +
          parent.id + ' (' + parent.layer + ')'
        );
      }
      if (parent.epistemic.confidence_rank < principleRecord.epistemic.confidence_rank) {
        VIOLATIONS.push(
          'Confidence inversion: ' + principleRecord.id + ' claims ' + principleRecord.epistemic.confidence +
          ' while resting on ' + parent.id + ' at ' + parent.epistemic.confidence
        );
      }
    }
    edges.set(principleRecord.id, resolved);
  }

  // Kahn topological order doubles as the acyclicity proof.
  const indegree = new Map();
  const children = new Map();
  for (const record of byId.values()) {
    indegree.set(record.id, edges.get(record.id).length);
    for (const dependency of edges.get(record.id)) {
      if (!children.has(dependency)) children.set(dependency, []);
      children.get(dependency).push(record.id);
    }
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const remaining = indegree.get(child) - 1;
      indegree.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
    queue.sort();
  }
  if (order.length !== byId.size) {
    VIOLATIONS.push('Knowledge dependency graph contains a cycle.');
    // Append whatever the sort could not reach so downstream reporting still
    // sees every principle.
    for (const id of [...byId.keys()].sort()) {
      if (!order.includes(id)) order.push(id);
    }
  }

  for (const [domain, pack] of Object.entries(DOMAIN_PACKS)) {
    for (const root of pack.roots) {
      if (!byId.has(root)) {
        VIOLATIONS.push('Domain pack ' + domain + ' references unknown principle ' + root);
      }
    }
  }

  return { byId, order: Object.freeze(order), children, edges };
}

const {
  byId: PRINCIPLES,
  order: TOPOLOGICAL_ORDER,
  children: DEPENDENTS,
  edges: RESOLVED_EDGES
} = compile();

const COMPILE_VIOLATIONS = Object.freeze([...VIOLATIONS]);

// Fail closed: an unsound base may be described by verifyKnowledgeBase(), and
// by nothing else.
function assertSound() {
  if (COMPILE_VIOLATIONS.length) {
    throw knowledgeError(
      'Knowledge base is unsound and cannot be read: ' + COMPILE_VIOLATIONS.join('; '),
      'INVALID_KNOWLEDGE_BASE'
    );
  }
}

// ---------------------------------------------------------------------------
// Public query surface
// ---------------------------------------------------------------------------

function boundedQuery(value) {
  const text = String(value ?? '').trim();
  if (text.length > MAX_KNOWLEDGE_QUERY_LENGTH) {
    throw knowledgeError(
      'Knowledge query must be at most ' + MAX_KNOWLEDGE_QUERY_LENGTH + ' characters.',
      'INVALID_KNOWLEDGE_QUERY'
    );
  }
  return text.toLowerCase();
}

export function listKnowledgeLayers() {
  assertSound();
  return KNOWLEDGE_LAYERS.map((layer) => ({
    ...layer,
    principle_count: [...PRINCIPLES.values()].filter((record) => record.layer === layer.id).length
  }));
}

export function getPrinciple(id) {
  assertSound();
  const record = PRINCIPLES.get(String(id ?? '').trim());
  if (!record) {
    throw knowledgeError('Unknown knowledge principle: ' + String(id ?? ''), 'UNKNOWN_PRINCIPLE');
  }
  return record;
}

export function listPrinciples(options = {}) {
  assertSound();
  const { layer, kind, domain, search } = options;
  if (layer !== undefined && !LAYER_BY_ID.has(layer)) {
    throw knowledgeError('Unknown knowledge layer: ' + layer, 'UNKNOWN_LAYER');
  }
  if (kind !== undefined && !KINDS.has(kind)) {
    throw knowledgeError('Unknown knowledge kind: ' + kind, 'UNKNOWN_KIND');
  }
  let ids = TOPOLOGICAL_ORDER;
  if (domain !== undefined) {
    ids = groundDomain(domain).principles.map((record) => record.id);
  }
  const needle = search === undefined ? null : boundedQuery(search);
  const results = [];
  for (const id of ids) {
    const record = PRINCIPLES.get(id);
    if (layer !== undefined && record.layer !== layer) continue;
    if (kind !== undefined && record.kind !== kind) continue;
    if (needle) {
      const haystack = (record.id + ' ' + record.title + ' ' + record.statement + ' ' + record.scope).toLowerCase();
      if (!haystack.includes(needle)) continue;
    }
    results.push(record);
    if (results.length >= MAX_KNOWLEDGE_RESULTS) break;
  }
  return results;
}

function ancestorsOf(ids) {
  const seen = new Set();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dependency of PRINCIPLES.get(id).depends_on) stack.push(dependency);
  }
  return seen;
}

// Full grounding of a principle: every principle it rests on, in dependency
// order, ending with the principle itself.
export function derivePrinciple(id) {
  const target = getPrinciple(id);
  const closure = ancestorsOf([target.id]);
  const chain = TOPOLOGICAL_ORDER.filter((entry) => closure.has(entry)).map((entry) => PRINCIPLES.get(entry));
  const foundations = chain.filter((record) => record.depends_on.length === 0);
  const weakest = chain.reduce((worst, record) => (
    record.epistemic.confidence_rank < worst.epistemic.confidence_rank ? record : worst
  ), chain[0]);
  const layersUsed = KNOWLEDGE_LAYERS
    .filter((layer) => chain.some((record) => record.layer === layer.id))
    .map((layer) => layer.id);
  return {
    schema_version: KNOWLEDGE_SCHEMA_VERSION,
    principle: target,
    chain,
    depth: chain.length,
    foundations,
    layers_used: layersUsed,
    grounded_in_mathematics: layersUsed.includes('mathematics'),
    weakest_link: {
      id: weakest.id,
      title: weakest.title,
      layer: weakest.layer,
      confidence: weakest.epistemic.confidence,
      limits: weakest.limits
    },
    stated_limits: chain
      .filter((record) => record.epistemic.confidence_rank <= CONFIDENCE_RANKS.moderate)
      .map((record) => ({ id: record.id, limits: record.limits }))
  };
}

export function listPrincipleDependents(id) {
  getPrinciple(id);
  return (DEPENDENTS.get(id) ?? []).map((entry) => PRINCIPLES.get(entry));
}

export function listKnowledgeDomains() {
  assertSound();
  return Object.entries(DOMAIN_PACKS).map(([id, pack]) => ({
    id,
    label: pack.label,
    summary: pack.summary,
    root_count: pack.roots.length
  }));
}

// The grounding a workflow should carry: declared roots plus their entire
// support tree, with the layers and the weakest supporting claim made explicit.
export function groundDomain(domain) {
  assertSound();
  const key = String(domain ?? '').trim();
  const pack = Object.hasOwn(DOMAIN_PACKS, key) ? DOMAIN_PACKS[key] : null;
  if (!pack) {
    throw knowledgeError('Unknown knowledge domain: ' + String(domain ?? ''), 'UNKNOWN_DOMAIN');
  }
  const closure = ancestorsOf(pack.roots);
  const principles = TOPOLOGICAL_ORDER.filter((id) => closure.has(id)).map((id) => PRINCIPLES.get(id));
  const byLayer = KNOWLEDGE_LAYERS.map((layer) => ({
    layer: layer.id,
    tier: layer.tier,
    label: layer.label,
    principles: principles.filter((record) => record.layer === layer.id).map((record) => record.id)
  })).filter((entry) => entry.principles.length > 0);
  const provisional = principles.filter(
    (record) => record.epistemic.confidence_rank <= CONFIDENCE_RANKS.provisional
  );
  return {
    schema_version: KNOWLEDGE_SCHEMA_VERSION,
    domain: String(domain).trim(),
    label: pack.label,
    summary: pack.summary,
    roots: pack.roots.map((id) => PRINCIPLES.get(id)),
    principles,
    by_layer: byLayer,
    layer_span: byLayer.map((entry) => entry.layer),
    provisional_claims: provisional.map((record) => ({
      id: record.id,
      title: record.title,
      limits: record.limits
    })),
    governance: principles.filter((record) => record.kind === 'governance').map((record) => record.id)
  };
}

// Maps a harness workflow to the domain packs whose grounding it should cite.
const WORKFLOW_DOMAINS = {
  drug_discovery: ['drug_discovery', 'evidence_appraisal', 'statistical_inference', 'measurement'],
  biomolecular_design: ['nucleic_acid_design', 'protein_engineering', 'vaccine_design', 'measurement'],
  procedure_development: ['measurement', 'evidence_appraisal'],
  computational_science: ['measurement', 'evidence_appraisal', 'statistical_inference'],
  evidence_review: ['evidence_appraisal', 'statistical_inference'],
  cad_engineering: ['measurement'],
  general_research: ['measurement', 'evidence_appraisal']
};

export function knowledgeGroundingForWorkflow(workflowId) {
  assertSound();
  const key = String(workflowId ?? '').trim();
  const domains = Object.hasOwn(WORKFLOW_DOMAINS, key)
    ? WORKFLOW_DOMAINS[key]
    : WORKFLOW_DOMAINS.general_research;
  const groundings = domains.map((domain) => groundDomain(domain));
  const closure = new Set(groundings.flatMap((entry) => entry.principles.map((record) => record.id)));
  const layers = KNOWLEDGE_LAYERS
    .filter((layer) => [...closure].some((id) => PRINCIPLES.get(id).layer === layer.id))
    .map((layer) => layer.id);
  return {
    schema_version: KNOWLEDGE_SCHEMA_VERSION,
    workflow: String(workflowId ?? '').trim() || 'general_research',
    domains: groundings.map((entry) => ({
      id: entry.domain,
      label: entry.label,
      summary: entry.summary,
      roots: entry.roots.map((record) => record.id)
    })),
    layer_span: layers,
    principle_count: closure.size,
    provisional_claims: [...new Set(groundings.flatMap(
      (entry) => entry.provisional_claims.map((claim) => claim.id)
    ))].sort(),
    governance: [...new Set(groundings.flatMap((entry) => entry.governance))].sort()
  };
}

// Reports every structural invariant against the compiled base. The dependency
// checks read the violations recorded during compilation rather than re-deriving
// them, so an unsound base is described here instead of crashing on import.
export function verifyKnowledgeBase() {
  const findings = [];
  const record = (check, ok, detail) => findings.push({ check, ok, detail });
  const matching = (prefix) => COMPILE_VIOLATIONS.filter((entry) => entry.startsWith(prefix));
  const recordViolations = (check, prefix, cleanDetail) => {
    const matches = matching(prefix);
    record(check, matches.length === 0, matches.join('; ') || cleanDetail);
  };

  recordViolations('unique_ids', 'Duplicate knowledge principle id',
    PRINCIPLES.size + ' unique principles');
  recordViolations('known_vocabulary', 'Unknown knowledge layer', 'all layers known');
  recordViolations('acyclic', 'Knowledge dependency graph contains a cycle',
    'topological order covers all ' + PRINCIPLES.size);
  recordViolations('resolved_dependencies', 'Unresolved dependency', 'none unresolved');
  recordViolations('layer_purity', 'Layer inversion', 'no upward dependencies');
  recordViolations('confidence_monotonic', 'Confidence inversion', 'no confidence inversions');
  recordViolations('axioms_are_mathematical', 'Only the mathematics layer', 'none outside mathematics');
  recordViolations('domain_roots_resolve', 'Domain pack', 'all domain roots resolve');

  // Reachability and documentation are computed live: they are properties of
  // the compiled graph rather than of any single declaration.
  const sound = COMPILE_VIOLATIONS.length === 0;
  const ungrounded = sound
    ? [...PRINCIPLES.values()].filter(
      (entry) => entry.tier > 0 && !derivePrinciple(entry.id).grounded_in_mathematics
    )
    : [];
  record('every_layer_reaches_mathematics', sound && ungrounded.length === 0,
    sound ? (ungrounded.map((entry) => entry.id).join(', ') || 'none') : 'not evaluated: base is unsound');

  const undocumented = [...PRINCIPLES.values()].filter(
    (entry) => !entry.limits || !entry.scope || entry.references.length === 0
  );
  record('scope_limits_and_references_present', undocumented.length === 0,
    undocumented.map((entry) => entry.id).join(', ') || 'none');

  const ok = findings.every((finding) => finding.ok);
  return {
    schema_version: KNOWLEDGE_SCHEMA_VERSION,
    engine: KNOWLEDGE_ENGINE_NAME,
    ok,
    principle_count: PRINCIPLES.size,
    violations: COMPILE_VIOLATIONS,
    layers: ok ? listKnowledgeLayers() : [],
    domains: ok ? listKnowledgeDomains() : [],
    findings
  };
}
