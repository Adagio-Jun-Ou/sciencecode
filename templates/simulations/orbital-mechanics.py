"""High-fidelity two-body orbit propagation with SciPy DOP853.

The trajectory is integrated with the explicit Runge-Kutta 8(5,3) method at
user-bounded tolerances and cross-checked against the analytic Kepler
propagation solved by Newton iteration on the eccentric anomaly, alongside
energy and angular-momentum drift. This is point-mass Keplerian dynamics: no
perturbations, third bodies, drag, radiation pressure, relativity, or
mission-design validity are modeled or claimed.
"""

from __future__ import annotations

import json
import math
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


def kepler_state(mu: float, r_p: float, eccentricity: float, mean_anomaly: float) -> np.ndarray:
    """Analytic position/velocity at a mean anomaly, perifocal frame."""
    a = r_p / (1.0 - eccentricity)
    E = mean_anomaly + eccentricity if eccentricity >= 0.8 else mean_anomaly
    converged = False
    for _ in range(128):
        delta = (E - eccentricity * math.sin(E) - mean_anomaly) / (1.0 - eccentricity * math.cos(E))
        E -= delta
        if abs(delta) < 1e-14:
            converged = True
            break
    if not converged:
        raise RuntimeError(
            f"Kepler solve did not converge for e={eccentricity}, M={mean_anomaly}"
        )
    cos_E, sin_E = math.cos(E), math.sin(E)
    r = a * (1.0 - eccentricity * cos_E)
    x = a * (cos_E - eccentricity)
    y = a * math.sqrt(1.0 - eccentricity**2) * sin_E
    factor = math.sqrt(mu * a) / r
    vx = -factor * sin_E
    vy = factor * math.sqrt(1.0 - eccentricity**2) * cos_E
    return np.array([x, y, 0.0, vx, vy, 0.0], dtype=np.float64)


def main() -> None:
    output_directory = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    seed = int(os.environ.get("SCIENCECODE_SEED", "0"))

    mu = bounded_float(parameters, "mu_km3_s2", 398_600.4418, 1e-3, 1e12)
    r_p = bounded_float(parameters, "periapsis_km", 6_878.0, 1.0, 1e9)
    eccentricity = bounded_float(parameters, "eccentricity", 0.1, 0.0, 0.95)
    orbits = bounded_float(parameters, "orbits", 10.0, 0.1, 1_000.0)
    rtol = bounded_float(parameters, "rtol", 1e-12, 1e-13, 1e-6)
    atol = bounded_float(parameters, "atol", 1e-12, 1e-15, 1e-6)
    samples = int(bounded_float(parameters, "samples", 2_000, 100, 200_000))

    a = r_p / (1.0 - eccentricity)
    period = 2.0 * math.pi * math.sqrt(a**3 / mu)
    t_end = orbits * period
    state0 = kepler_state(mu, r_p, eccentricity, 0.0)

    def dynamics(_t: float, state: np.ndarray) -> np.ndarray:
        position = state[:3]
        radius = np.linalg.norm(position)
        acceleration = -mu * position / radius**3
        return np.concatenate([state[3:], acceleration])

    started = time.perf_counter()
    times = np.linspace(0.0, t_end, samples)
    solution = solve_ivp(
        dynamics, (0.0, t_end), state0, method="DOP853",
        t_eval=times, rtol=rtol, atol=atol, dense_output=False,
    )
    elapsed_seconds = time.perf_counter() - started
    if not solution.success:
        raise RuntimeError(f"DOP853 integration failed: {solution.message}")

    positions = solution.y[:3].T
    velocities = solution.y[3:].T
    radii = np.linalg.norm(positions, axis=1)
    speeds = np.linalg.norm(velocities, axis=1)
    energy = 0.5 * speeds**2 - mu / radii
    angular_momentum = np.linalg.norm(np.cross(positions, velocities), axis=1)
    energy_drift = float(np.max(np.abs(energy - energy[0]) / abs(energy[0])))
    momentum_drift = float(np.max(np.abs(angular_momentum - angular_momentum[0]) / angular_momentum[0]))

    mean_motion = math.sqrt(mu / a**3)
    kepler_final = kepler_state(mu, r_p, eccentricity, (mean_motion * t_end) % (2.0 * math.pi))
    kepler_error_km = float(np.linalg.norm(solution.y[:3, -1] - kepler_final[:3]))

    np.savez_compressed(
        output_directory / "orbital-trajectory.npz",
        times=times, positions=positions, velocities=velocities,
        energy=energy, angular_momentum=angular_momentum,
    )
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figure, axes = plt.subplots(1, 2, figsize=(11, 5))
    axes[0].plot(positions[:, 0], positions[:, 1], linewidth=0.8)
    axes[0].scatter([0.0], [0.0], marker="+")
    axes[0].set_aspect("equal")
    axes[0].set_xlabel("x [km]")
    axes[0].set_ylabel("y [km]")
    axes[0].set_title(f"e={eccentricity}, {orbits:g} orbits")
    axes[1].semilogy(times / period, np.maximum(np.abs(energy - energy[0]) / abs(energy[0]), 1e-18))
    axes[1].set_xlabel("orbit number")
    axes[1].set_ylabel("relative energy drift")
    axes[1].set_title("conservation diagnostic")
    figure.suptitle("Two-body propagation, SciPy DOP853")
    figure.tight_layout()
    figure.savefig(output_directory / "orbital-mechanics.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Two-body Keplerian orbit, SciPy DOP853 vs analytic Kepler",
        "seed": seed,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "mu_km3_s2": mu, "periapsis_km": r_p, "eccentricity": eccentricity,
            "orbits": orbits, "rtol": rtol, "atol": atol, "samples": samples,
        },
        "solver": {"method": "DOP853", "nfev": int(solution.nfev)},
        "final_statistics": {
            "energy_drift": {"value": energy_drift, "unit": "1"},
            "angular_momentum_drift": {"value": momentum_drift, "unit": "1"},
            "kepler_position_error": {"value": kepler_error_km, "unit": "km"},
            "orbital_period": {"value": period, "unit": "s"},
            "semi_major_axis": {"value": a, "unit": "km"},
        },
        "artifacts": ["orbital-mechanics.png", "orbital-trajectory.npz", "summary.json"],
        "interpretation": "Point-mass two-body dynamics only; drift and analytic-error diagnostics bound numerical fidelity, not physical realism.",
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
