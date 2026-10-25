"""Dose-response potency estimation with two independent fitting methods.

A four-parameter logistic curve is fitted to a concentration-response series
by SciPy's trust-region least squares and, independently, by a Nelder-Mead
search on the same objective. Agreement between two unrelated optimizers is
reported as a fidelity diagnostic: a curve that only one of them can find is
a curve the data do not really determine.

The simulation generates its response series from a declared ground-truth
curve plus reproducible measurement noise, so the recovered potency can be
compared against the value that produced it. That comparison is the point --
it measures the estimator, not a drug.

What this does NOT model: assay format, incubation time, cell viability,
protein binding, compound solubility or aggregation, or any relationship
between a potency in an assay and an effect in an organism. A half-maximal
concentration summarises one curve in one readout: assay validity is
not modeled or claimed, and a potency is neither an affinity nor a dose.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import time

import numpy as np
from scipy.optimize import least_squares, minimize


def bounded_float(parameters: dict, name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(parameters.get(name, default))
    if not np.isfinite(value) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def logistic(log_concentration: np.ndarray, bottom: float, top: float,
             log_half_maximal: float, hill: float) -> np.ndarray:
    """Four-parameter logistic in log10 concentration."""
    exponent = np.clip((log_concentration - log_half_maximal) * hill, -300.0, 300.0)
    return bottom + (top - bottom) / (1.0 + np.power(10.0, exponent))


def main() -> None:
    output_directory = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    seed = int(os.environ.get("SCIENCECODE_SEED", "0"))

    true_half_maximal = bounded_float(parameters, "true_ic50_nm", 250.0, 1e-6, 1e9)
    true_hill = bounded_float(parameters, "true_hill", 1.0, 0.1, 10.0)
    true_bottom = bounded_float(parameters, "true_bottom", 0.0, -1e6, 1e6)
    true_top = bounded_float(parameters, "true_top", 100.0, -1e6, 1e6)
    noise_sd = bounded_float(parameters, "noise_sd", 2.0, 0.0, 1e4)
    replicates = int(bounded_float(parameters, "replicates", 3, 1, 32))
    points = int(bounded_float(parameters, "concentration_points", 9, 4, 64))
    dilution = bounded_float(parameters, "dilution_factor", 3.0, 1.5, 100.0)
    top_concentration = bounded_float(parameters, "top_concentration_nm", 100_000.0, 1e-6, 1e12)

    if true_top == true_bottom:
        raise ValueError("true_top and true_bottom must differ or there is no curve to fit")

    # A serial dilution, which is how these series are actually produced.
    concentrations = top_concentration / np.power(dilution, np.arange(points, dtype=np.float64))
    concentrations = np.sort(concentrations)
    log_concentrations = np.log10(concentrations)

    truth = (true_bottom, true_top, np.log10(true_half_maximal), true_hill)
    clean = logistic(log_concentrations, *truth)

    generator = np.random.default_rng(seed)
    observations = np.empty((replicates, points), dtype=np.float64)
    for index in range(replicates):
        observations[index] = clean + generator.normal(0.0, noise_sd, size=points)
    mean_response = observations.mean(axis=0)

    def residuals(theta: np.ndarray) -> np.ndarray:
        return logistic(log_concentrations, *theta) - mean_response

    def cost(theta: np.ndarray) -> float:
        return float(np.sum(residuals(theta) ** 2))

    start = np.array([
        float(mean_response.min()),
        float(mean_response.max()),
        float((log_concentrations.min() + log_concentrations.max()) / 2.0),
        1.0,
    ], dtype=np.float64)

    started_at = time.perf_counter()
    # Method 1: trust-region reflective least squares on the residual vector.
    trf = least_squares(residuals, start, method="trf", max_nfev=200_000)
    # Method 2: Nelder-Mead on the scalar cost. Derivative-free and structurally
    # unrelated to the first, so agreement is real evidence rather than two
    # runs of the same algorithm.
    nelder = minimize(cost, start, method="Nelder-Mead",
                      options={"maxiter": 200_000, "maxfev": 200_000,
                               "xatol": 1e-12, "fatol": 1e-14})
    elapsed_seconds = time.perf_counter() - started_at

    trf_half_maximal = float(10.0 ** trf.x[2])
    nelder_half_maximal = float(10.0 ** nelder.x[2])
    # Compared on the log scale, where potency actually lives: a factor-of-two
    # disagreement matters equally at 1 nM and at 1 uM.
    solver_disagreement_log10 = float(abs(trf.x[2] - nelder.x[2]))
    recovery_error_log10 = float(abs(trf.x[2] - np.log10(true_half_maximal)))

    residual_sum_of_squares = float(np.sum(residuals(trf.x) ** 2))
    total_sum_of_squares = float(np.sum((mean_response - mean_response.mean()) ** 2))
    r_squared = float(1.0 - residual_sum_of_squares / total_sum_of_squares) if total_sum_of_squares > 0 else float("nan")

    # Whether the design actually brackets the potency, and whether the assay
    # reached both plateaus. A fit can look excellent and still rest on an
    # asymptote that was never measured.
    fitted_amplitude = float(abs(trf.x[1] - trf.x[0]))
    observed_span = float(mean_response.max() - mean_response.min())
    plateau_coverage = observed_span / fitted_amplitude if fitted_amplitude > 0 else float("nan")
    extrapolated = bool(trf.x[2] < log_concentrations.min() or trf.x[2] > log_concentrations.max())

    np.savez_compressed(
        output_directory / "dose-response.npz",
        concentrations_nm=concentrations,
        observations=observations,
        mean_response=mean_response,
        clean_response=clean,
        fitted_parameters_trf=trf.x,
        fitted_parameters_nelder_mead=nelder.x,
    )

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    grid = np.linspace(log_concentrations.min(), log_concentrations.max(), 400)
    figure, axis = plt.subplots(figsize=(8, 5))
    for index in range(replicates):
        axis.scatter(concentrations, observations[index], s=18, alpha=0.55,
                     label="replicates" if index == 0 else None)
    axis.semilogx(np.power(10.0, grid), logistic(grid, *truth), linestyle="--",
                  label="ground truth")
    axis.semilogx(np.power(10.0, grid), logistic(grid, *trf.x), label="fitted (TRF)")
    axis.axvline(trf_half_maximal, color="grey", linewidth=1,
                 label=f"fitted IC50 = {trf_half_maximal:.4g} nM")
    axis.set_xlabel("concentration [nM]")
    axis.set_ylabel("response [%]")
    axis.set_title("Dose-response potency recovery, TRF vs Nelder-Mead cross-check")
    axis.legend()
    figure.tight_layout()
    figure.savefig(output_directory / "dose-response.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Four-parameter logistic potency estimation, SciPy TRF vs Nelder-Mead",
        "seed": seed,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "true_ic50_nm": true_half_maximal,
            "true_hill": true_hill,
            "true_bottom": true_bottom,
            "true_top": true_top,
            "noise_sd": noise_sd,
            "replicates": replicates,
            "concentration_points": points,
            "dilution_factor": dilution,
            "top_concentration_nm": top_concentration,
        },
        "solver": {
            "methods": ["trust-region-reflective", "Nelder-Mead"],
            "nfev": {"trf": int(trf.nfev), "nelder_mead": int(nelder.nfev)},
            "nelder_mead_converged": bool(nelder.success),
        },
        "final_statistics": {
            "fitted_ic50": {"value": trf_half_maximal, "unit": "nM"},
            "fitted_ic50_nelder_mead": {"value": nelder_half_maximal, "unit": "nM"},
            "fitted_hill": {"value": float(trf.x[3]), "unit": "1"},
            "solver_disagreement_log10": {"value": solver_disagreement_log10, "unit": "1"},
            "recovery_error_log10": {"value": recovery_error_log10, "unit": "1"},
            "r_squared": {"value": r_squared, "unit": "1"},
            "plateau_coverage": {"value": float(plateau_coverage), "unit": "1"},
        },
        "diagnostics": {
            "potency_extrapolated_beyond_tested_range": extrapolated,
            "plateaus_bracketed": bool(plateau_coverage >= 0.9) if np.isfinite(plateau_coverage) else False,
        },
        "artifacts": ["dose-response.png", "dose-response.npz", "summary.json"],
        "interpretation": (
            "Cross-solver disagreement and recovery error bound how well the "
            "estimator identifies a potency from this design; they say nothing "
            "about assay validity. A half-maximal concentration is neither an "
            "affinity nor a dose."
        ),
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
