---
name: gpu-simulation
description: Use for computational experiments, Monte Carlo studies, dynamical systems, PDEs, agent-based models, parameter sweeps, or other CPU/GPU simulations.
---
# Reproducible simulation protocol

Treat a simulation as an experiment, not an animation. Define the scientific
question, mathematical model, units, assumptions, boundary and initial
conditions, parameter ranges, outputs, and falsification or validation target
before execution.

Check ScienceCode compute status and free GPU memory. Never stop an unrelated
GPU process. Start at small scale, estimate memory growth, and scale only after
the small case passes. Use float64 where error analysis requires it; if float32
is chosen for speed, quantify sensitivity to precision.

Run final Python simulations through ScienceCode's recorded simulation command.
When the command is not globally linked, invoke the path in SCIENCECODE_CLI
with Node (for example, node followed by that environment-provided path).
Use a fixed seed, pass experimental choices as named parameters, declare all
input files, and save outputs only under SCIENCECODE_OUTPUT_DIR. Produce a
machine-readable summary beside each figure or binary array.

When a conclusion depends on multiple seeds or parameter values, use the
recorded experiment command instead of launching ad hoc loops. Record a concise
--hypothesis, pass unique seeds with --seeds, keep controls in --param, and pass
each sweep dimension as --vary NAME=[...]. ScienceCode expands the deterministic
matrix sequentially, links every branch to the parent plan, caps execution at 64
branches, produces summary.csv and review.json, and verifies aggregate-to-branch
consistency. Run sciencecode experiment verify on the resulting experiment ID.

Validate against an analytic result, conservation law, limiting case,
independent solver, or empirical benchmark. Perform convergence checks over
grid spacing, time step, replicate count, or tolerance as appropriate. Report
numerical error, sampling error, model uncertainty, runtime, peak GPU memory,
device, dependency versions, and the exact verification command.
