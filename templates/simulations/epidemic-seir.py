"""Deterministic SEIR epidemic dynamics with SciPy solve_ivp cross-checks.

A closed-population SEIR compartment model is integrated with DOP853 at
user-bounded tolerances and cross-checked against an independent LSODA run
and the implicit final-size equation ln(s_inf) = R0 (s_inf - 1). This is a
homogeneous-mixing textbook model: no demography, interventions, waning,
spatial structure, stochasticity, or public-health validity is modeled or
claimed.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
import time

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import root_scalar


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

    r0 = bounded_float(parameters, "r0", 2.5, 1.01, 50.0)
    incubation_days = bounded_float(parameters, "incubation_days", 5.0, 0.1, 100.0)
    infectious_days = bounded_float(parameters, "infectious_days", 7.0, 0.1, 100.0)
    initial_infected = bounded_float(parameters, "initial_infected_fraction", 1e-5, 1e-9, 0.1)
    duration_days = bounded_float(parameters, "duration_days", 720.0, 10.0, 36_500.0)
    rtol = bounded_float(parameters, "rtol", 1e-11, 1e-12, 1e-5)
    atol = bounded_float(parameters, "atol", 1e-13, 1e-16, 1e-7)
    samples = int(bounded_float(parameters, "samples", 2_000, 100, 200_000))

    sigma = 1.0 / incubation_days
    gamma = 1.0 / infectious_days
    beta = r0 * gamma
    y0 = np.array([1.0 - initial_infected, 0.0, initial_infected, 0.0], dtype=np.float64)
    times = np.linspace(0.0, duration_days, samples)

    def dynamics(_t: float, y: np.ndarray) -> np.ndarray:
        s, e, i, _r = y
        infection = beta * s * i
        return np.array([
            -infection,
            infection - sigma * e,
            sigma * e - gamma * i,
            gamma * i,
        ], dtype=np.float64)

    started = time.perf_counter()
    solutions = {}
    for method in ("DOP853", "LSODA"):
        solution = solve_ivp(
            dynamics, (0.0, duration_days), y0, method=method,
            t_eval=times, rtol=rtol, atol=atol,
        )
        if not solution.success:
            raise RuntimeError(f"{method} integration failed: {solution.message}")
        solutions[method] = solution
    elapsed_seconds = time.perf_counter() - started

    primary = solutions["DOP853"].y
    secondary = solutions["LSODA"].y
    solver_disagreement = float(np.max(np.abs(primary - secondary)))
    population_drift = float(np.max(np.abs(primary.sum(axis=0) - 1.0)))

    infected = primary[2]
    peak_index = int(np.argmax(infected))
    peak_infected = float(infected[peak_index])
    peak_time = float(times[peak_index])
    attack_rate = float(primary[3, -1])

    # Implicit final-size equation for the fully susceptible limit.
    # The nontrivial root satisfies s_inf < e^-R0 < 1, so bracket below the
    # asymptote; a fixed 1e-12 lower bound loses the sign change for R0 > ~27.6.
    lower_bracket = min(1e-12, math.exp(-2.0 * r0))
    s_inf = float(root_scalar(
        lambda s: math.log(s) - r0 * (s - 1.0),
        bracket=(lower_bracket, 1.0 - 1e-12), method="brentq", xtol=1e-14,
    ).root)
    final_size_residual = float(abs((1.0 - primary[0, -1]) - (1.0 - s_inf)))

    np.savez_compressed(
        output_directory / "epidemic-seir.npz",
        times=times, dop853=primary, lsoda=secondary,
    )
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figure, axis = plt.subplots(figsize=(8, 5))
    for row, label in zip(primary, ("S", "E", "I", "R")):
        axis.plot(times, row, label=label, linewidth=1.2)
    axis.set_xlabel("time [d]")
    axis.set_ylabel("population fraction")
    axis.set_title(f"SEIR, R0={r0}, DOP853 vs LSODA cross-check")
    axis.legend()
    figure.tight_layout()
    figure.savefig(output_directory / "epidemic-seir.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Closed-population SEIR, SciPy DOP853 vs LSODA and final-size equation",
        "seed": seed,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "r0": r0, "incubation_days": incubation_days,
            "infectious_days": infectious_days,
            "initial_infected_fraction": initial_infected,
            "duration_days": duration_days,
            "rtol": rtol, "atol": atol, "samples": samples,
        },
        "solver": {
            "methods": ["DOP853", "LSODA"],
            "nfev": {name: int(item.nfev) for name, item in solutions.items()},
        },
        "final_statistics": {
            "peak_infected_fraction": {"value": peak_infected, "unit": "1"},
            "peak_time": {"value": peak_time, "unit": "d"},
            "attack_rate": {"value": attack_rate, "unit": "1"},
            "final_size_residual": {"value": final_size_residual, "unit": "1"},
            "solver_disagreement": {"value": solver_disagreement, "unit": "1"},
            "population_drift": {"value": population_drift, "unit": "1"},
        },
        "artifacts": ["epidemic-seir.png", "epidemic-seir.npz", "summary.json"],
        "interpretation": "Homogeneous-mixing textbook SEIR; residual and cross-solver diagnostics bound numerical fidelity, not epidemiological realism.",
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
