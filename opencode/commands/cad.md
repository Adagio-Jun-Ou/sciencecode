---
description: Create, edit, build, inspect, simulate, compare, and safely slice many-file OpenSCAD/CadQuery CAD with STL/STEP provenance
agent: cad-engineer
subtask: true
---
Use the cad-engineering skill for: $ARGUMENTS

Define units, interfaces, clearances, build envelope, material/manufacturing
assumptions, and acceptance checks. Choose OpenSCAD for declarative CSG or
CadQuery for Pythonic B-rep/assembly and STEP, while preserving an existing
project's engine. Create or import a declared many-file environment; read every
affected source and use expected-hash writes so stale drafts fail.

Build and verify the immutable output before reasoning about geometry. Inspect
the interactive STL and, for CadQuery, verified STEP plus runtime/adapter
provenance. Run the deterministic geometry screen only as triage. If real
physics is needed, launch a project-relative recorded model from the verified
mesh with explicit equations, assumptions, seed, parameters, inputs, device,
validation, and uncertainty. Default to CPU; respect the Lab free-VRAM gate and
treat cancellation as incomplete.

For bounded exploratory surface heat, install the `cad-surface-heat` preset,
run it against the exact build, and inspect its equation, face bands, diffusion
number, validation checks, convergence CSV, and rotatable temperature PLY.
Selected temperatures become AI-visible. Describe it only as normalized
surface-graph diffusion—not volumetric conduction, FEA, material validation,
or thermal-safety certification.

For bounded sensitivity analysis, use `sciencecode cad study CAD_BUILD_ID SCRIPT`
or the Lab comparison panel. Freeze the hypothesis, fixed parameters, variation
arrays, and seeds before launch; keep the Cartesian matrix at or below 64
branches. Require the aggregate and every child to verify against the exact same
immutable mesh before sharing the selected comparison with the AI. A CAD study
inherits the solver's limits and is not FEA or model validation. A Lab stop
aborts only the active branch, preserves completed and interrupted artifacts,
marks undispatched branches `not_run`, and finalizes a verified partial
experiment. Use conservative branch timeouts and never report a cancelled
study or partial aggregate as a completed comparison.

Slice in non-extruding preview mode unless the user explicitly supplies a
project-relative profile and acknowledges physical risk. Never call the screen
FEA, enable post-processing, transmit G-code, or control a printer. Remember
that CadQuery is arbitrary user-permission Python, not sandboxed code. Report
changed files, engine, exact record IDs, STL/STEP hashes, findings, limits, and
reproduction commands.
