---
name: cad-engineering
description: Use for multi-file OpenSCAD or CadQuery CAD, STEP/STL interchange, assemblies, mesh inspection, CAD-bound simulation and parameter studies, and safe 3D-print slicing.
---
# Reproducible CAD engineering

Define the objective, millimeter units, build envelope, interfaces, constraints,
clearances, material/manufacturing assumptions, and measurable acceptance
criteria before editing geometry. The ScienceCode CAD environment is the source
of truth: one explicit engine and entry, up to 256 declared project-relative
sources/assets, up to 512 named parts, parameters, and immutable derived records.

Choose and preserve the engine deliberately:

- Use OpenSCAD for declarative CSG, reusable modules, static includes, and
  compact text-first designs.
- Use CadQuery for Pythonic B-rep construction, named assemblies, and verified
  STEP interchange. A CadQuery entry must expose `build(parameters)` or
  `result` as a Workplane, Shape, or Assembly.
- A declared STEP/IGES/BREP asset may be read through
  `SCIENCECODE_SOURCE_ROOT` and a CadQuery importer, then transformed into a new
  result. Never overwrite the immutable input asset.
- Do not silently convert an existing project between engines. Create a new
  descriptor/source environment when the engine or declared file tree changes.

The normal loop is:

1. Run `sciencecode cad toolchain` and `sciencecode compute status`. Set up the
   optional CadQuery profile with `sciencecode compute setup --profile cad`.
   Inspect environments with `cad list/show`; create a starter with
   `cad init --engine openscad|cadquery`, or author a descriptor plus many-file
   source tree and import it with `cad create SPEC.json`.
2. Read the descriptor and every relevant declared text file before changing
   cross-file interfaces. Use `cad read`, then save each SCAD/Python draft with
   `cad write CAD_PROJECT_ID FILE --from DRAFT --expected OPENED_SHA256` so a
   stale model or browser cannot overwrite newer work. Binary CAD assets are
   inspectable metadata, not editable text.
3. Build and verify. OpenSCAD yields a verified ASCII STL; CadQuery yields the
   same STL contract plus verified STEP. Inspect the interactive mesh, source
   snapshot integrity, engine/runtime/tool identity, adapter report, dimensions,
   topology, solids, and artifact hashes. Never reason from an unbuilt draft
   when the claim depends on geometry.
4. Run `cad simulate CAD_BUILD_ID` only for bounded topology, dimensions,
   build-volume, mass-estimate, and orientation-dependent overhang triage. It is
   not FEA, structural, thermal, fluid, fatigue, tolerance, collision, support,
   material, dynamic, or printer-safety validation.
5. For a real model, bind a project-relative Python solver to the verified STL
   through Lab or `cad physics`. Freeze seed, device, parameters, arguments,
   inputs, equations, materials, constraints, convergence, validation, and
   uncertainty. Default to CPU; use auto/CUDA only with sufficient refreshed
   free VRAM and never crowd another workload. A verified cancelled record is
   incomplete evidence.
   For bounded exploratory heat flow on the mesh surface, install
   `cad-surface-heat` from the Lab preset or run
   `sciencecode simulate init cad-surface-heat`, then bind it with
   `cad physics`. Inspect its explicit hot/cold face bands, time step, diffusion
   number (at most 0.45), connected components, validation checks, and exact
   mesh hash. Its rotatable `temperature-field.ply` carries selectable
   `temperature_c` values into the next AI turn. It is normalized graph
   diffusion, not volumetric conduction, FEA, material qualification, or a
   thermal-safety result; do not infer thickness, heat capacity, conductivity,
   convection, radiation, or contact behavior that it does not model.
   For sensitivity across parameters or seeds, use `cad study CAD_BUILD_ID
   SCRIPT` or the Lab comparative panel. Freeze the hypothesis, fixed values,
   variation arrays, and seeds before launch. Keep the matrix at or below 64
   branches, require every child and aggregate to verify against the same mesh,
   inspect the deterministic reviewer, and share only the selected bounded
   comparison with the AI. A study is evidence about that exact model and mesh,
   not model validation or FEA. A Lab stop aborts only the active branch,
   preserves completed and interrupted artifacts, marks undispatched branches
   `not_run`, and finalizes a verified partial experiment. Choose conservative
   per-branch timeouts and never present a cancelled study or partial aggregate
   as a completed comparison.
6. Slice the verified STL in preview mode first. Require no positive extrusion,
   heater, homing/leveling, or spindle commands. A printer profile is exceptional
   and requires a project-relative profile plus explicit physical-risk
   acknowledgement. Never add post-processing, upload, network, serial/USB, or
   printer execution.
7. Run `sciencecode gate`. Report files changed, engine, build/screen/model/study/slice
   IDs, STL/STEP hashes, tool/runtime versions, findings, assumptions, failures,
   unresolved risks, and exact reproduction commands.

OpenSCAD references must be static and declared. CadQuery source is arbitrary
Python running with the user's OS permissions: dependency isolation and
post-build source rehashing are not a filesystem, process, or network sandbox
and do not undo side effects. Never introduce absolute/parent paths, symlinks,
secrets, undeclared project dependencies, or intentional side effects. Preserve
prior sources and immutable records. Treat G-code as untrusted physical
machine-control data requiring independent printer, material, thermal, motion,
operator, and site review.
