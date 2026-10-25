"""Stiff chemical kinetics (Robertson problem) with SciPy BDF vs LSODA.

The classic Robertson mass-action network A -> B, B + B -> C + B,
B + C -> A + C is integrated with two independent stiff methods at
user-bounded tolerances. Mass conservation and cross-solver disagreement are
reported as explicit fidelity diagnostics. This is a fixed three-species
model: no thermodynamics, transport, reactor geometry, or laboratory validity
is modeled or claimed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import time

import numpy as np
from scipy.integrate import solve_ivp


def bounded_float(parameters: dict, name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(parameters.get(name, default))
    if not np.isfinite(value) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def main() -> None:
    output_directory = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    seed = int(os.environ.get("SCIENCECODE_SEED", "0"))

    k1 = bounded_float(parameters, "k1", 0.04, 1e-12, 1e12)
    k2 = bounded_float(parameters, "k2", 3e7, 1e-12, 1e12)
    k3 = bounded_float(parameters, "k3", 1e4, 1e-12, 1e12)
    a0 = bounded_float(parameters, "a0_mol_l", 1.0, 1e-12, 1e3)
    t_end = bounded_float(parameters, "t_end_s", 1e5, 1e-3, 1e11)
    rtol = bounded_float(parameters, "rtol", 1e-10, 1e-12, 1e-4)
    atol = bounded_float(parameters, "atol", 1e-12, 1e-16, 1e-6)
    samples = int(bounded_float(parameters, "samples", 400, 50, 100_000))

    def rates(_t: float, y: np.ndarray) -> np.ndarray:
        a, b, c = y
        r1 = k1 * a
        r2 = k2 * b * b
        r3 = k3 * b * c
        return np.array([-r1 + r3, r1 - r2 - r3, r2], dtype=np.float64)

    def jacobian(_t: float, y: np.ndarray) -> np.ndarray:
        _a, b, c = y
        return np.array([
            [-k1, k3 * c, k3 * b],
            [k1, -2.0 * k2 * b - k3 * c, -k3 * b],
            [0.0, 2.0 * k2 * b, 0.0],
        ], dtype=np.float64)

    y0 = np.array([a0, 0.0, 0.0], dtype=np.float64)
    times = np.geomspace(max(t_end * 1e-8, 1e-6), t_end, samples)

    started = time.perf_counter()
    solutions = {}
    for method in ("BDF", "LSODA"):
        solution = solve_ivp(
            rates, (0.0, t_end), y0, method=method, t_eval=times,
            rtol=rtol, atol=atol, jac=jacobian,
        )
        if not solution.success:
            raise RuntimeError(f"{method} integration failed: {solution.message}")
        solutions[method] = solution
    elapsed_seconds = time.perf_counter() - started

    bdf = solutions["BDF"].y
    lsoda = solutions["LSODA"].y
    conservation = np.abs(bdf.sum(axis=0) - a0) / a0
    conservation_drift = float(np.max(conservation))
    scale = np.maximum(np.abs(bdf), atol)
    solver_disagreement = float(np.max(np.abs(bdf - lsoda) / scale))

    np.savez_compressed(
        output_directory / "chemical-kinetics.npz",
        times=times, bdf=bdf, lsoda=lsoda,
    )
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figure, axis = plt.subplots(figsize=(8, 5))
    labels = ("[A]", "[B] x 1e4", "[C]")
    scaling = (1.0, 1e4, 1.0)
    for row, label, factor in zip(bdf, labels, scaling):
        axis.semilogx(times, row * factor, label=label + " (BDF)")
    axis.set_xlabel("time [s]")
    axis.set_ylabel("concentration [mol/L]")
    axis.set_title("Robertson stiff kinetics, BDF vs LSODA cross-check")
    axis.legend()
    figure.tight_layout()
    figure.savefig(output_directory / "chemical-kinetics.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Robertson stiff mass-action kinetics, SciPy BDF vs LSODA",
        "seed": seed,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "k1": k1, "k2": k2, "k3": k3, "a0_mol_l": a0,
            "t_end_s": t_end, "rtol": rtol, "atol": atol, "samples": samples,
        },
        "solver": {
            "methods": ["BDF", "LSODA"],
            "nfev": {name: int(item.nfev) for name, item in solutions.items()},
        },
        "final_statistics": {
            "mass_conservation_drift": {"value": conservation_drift, "unit": "1"},
            "solver_disagreement": {"value": solver_disagreement, "unit": "1"},
            "a_final": {"value": float(bdf[0, -1]), "unit": "mol/L"},
            "b_final": {"value": float(bdf[1, -1]), "unit": "mol/L"},
            "c_final": {"value": float(bdf[2, -1]), "unit": "mol/L"},
        },
        "artifacts": ["chemical-kinetics.png", "chemical-kinetics.npz", "summary.json"],
        "interpretation": "Fixed three-species Robertson network; conservation and cross-solver diagnostics bound numerical fidelity, not chemical realism.",
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
