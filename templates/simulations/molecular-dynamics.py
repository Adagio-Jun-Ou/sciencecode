"""Lennard-Jones NVE molecular dynamics with conservation and reversibility checks.

A small periodic Lennard-Jones system in reduced units is integrated with
velocity Verlet. Fidelity is bounded by three independent diagnostics: total
energy drift, total momentum drift, and a time-reversal test (integrate
forward, negate velocities, integrate back, measure position recovery).
This is a classical pair-potential toy system: no real material, force field
accuracy, thermodynamic sampling, or chemical validity is modeled or claimed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import time

import numpy as np


def bounded_float(parameters: dict, name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(parameters.get(name, default))
    if not np.isfinite(value) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def lattice_positions(count: int, box: float) -> np.ndarray:
    cells = int(np.ceil(count ** (1.0 / 3.0)))
    spacing = box / cells
    grid = np.arange(cells) * spacing + spacing / 2.0
    points = np.array(np.meshgrid(grid, grid, grid)).T.reshape(-1, 3)
    return points[:count].copy()


def forces_and_energy(positions: np.ndarray, box: float, cutoff: float) -> tuple[np.ndarray, float]:
    delta = positions[:, None, :] - positions[None, :, :]
    delta -= box * np.round(delta / box)
    squared = np.sum(delta * delta, axis=-1)
    n = positions.shape[0]
    squared[np.arange(n), np.arange(n)] = np.inf
    within = squared < cutoff * cutoff
    inv2 = np.where(within, 1.0 / squared, 0.0)
    inv6 = inv2 * inv2 * inv2
    inv12 = inv6 * inv6
    # Shifted potential so energy is continuous at the cutoff.
    cutoff_inv6 = (1.0 / cutoff**2) ** 3
    shift = 4.0 * (cutoff_inv6 * cutoff_inv6 - cutoff_inv6)
    energy = 0.5 * float(np.sum(np.where(within, 4.0 * (inv12 - inv6) - shift, 0.0)))
    magnitude = np.where(within, 24.0 * (2.0 * inv12 - inv6) * inv2, 0.0)
    forces = np.sum(magnitude[:, :, None] * delta, axis=1)
    return forces, energy


def integrate(positions, velocities, box, cutoff, dt, steps, sample_every):
    forces, potential = forces_and_energy(positions, box, cutoff)
    samples = []
    for step in range(steps):
        velocities = velocities + 0.5 * dt * forces
        positions = (positions + dt * velocities) % box
        forces, potential = forces_and_energy(positions, box, cutoff)
        velocities = velocities + 0.5 * dt * forces
        if step % sample_every == 0 or step == steps - 1:
            kinetic = 0.5 * float(np.sum(velocities * velocities))
            samples.append({
                "step": step,
                "kinetic": kinetic,
                "potential": potential,
                "total": kinetic + potential,
                "momentum": [float(value) for value in np.sum(velocities, axis=0)],
            })
    return positions, velocities, samples


def main() -> None:
    output_directory = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    seed = int(os.environ.get("SCIENCECODE_SEED", "0"))

    count = int(bounded_float(parameters, "particles", 64, 8, 1_000))
    density = bounded_float(parameters, "density", 0.5, 0.01, 1.2)
    temperature = bounded_float(parameters, "temperature", 1.0, 0.05, 5.0)
    dt = bounded_float(parameters, "dt", 0.002, 1e-5, 0.01)
    steps = int(bounded_float(parameters, "steps", 2_000, 100, 200_000))
    cutoff = bounded_float(parameters, "cutoff", 2.5, 1.5, 5.0)
    sample_every = max(1, steps // 200)
    # The dense O(N^2) kernel runs forward and reversed; bound total pair-steps
    # so an in-bounds parameterisation cannot become a day-long run.
    if count * count * steps > 2_000_000_000:
        raise ValueError("particles^2 * steps must stay at or below 2e9 pair-steps")

    box = (count / density) ** (1.0 / 3.0)
    if cutoff > box / 2.0:
        raise ValueError("cutoff must not exceed half the periodic box length")
    rng = np.random.default_rng(seed)
    positions = lattice_positions(count, box)
    velocities = rng.normal(0.0, np.sqrt(temperature), size=(count, 3))
    velocities -= velocities.mean(axis=0)

    started = time.perf_counter()
    final_positions, final_velocities, samples = integrate(
        positions.copy(), velocities.copy(), box, cutoff, dt, steps, sample_every)

    # Time-reversal check: velocity Verlet is symplectic and time-reversible,
    # so negating velocities and integrating back should recover the start.
    reversed_positions, _reversed_velocities, _ = integrate(
        final_positions.copy(), -final_velocities.copy(), box, cutoff, dt, steps, sample_every)
    recovery_delta = np.abs(reversed_positions - positions)
    recovery_delta = np.minimum(recovery_delta, box - recovery_delta)
    reversal_error = float(np.max(recovery_delta))
    elapsed_seconds = time.perf_counter() - started

    totals = np.array([sample["total"] for sample in samples])
    kinetic0 = samples[0]["kinetic"]
    energy_drift = float(np.max(np.abs(totals - totals[0])) / max(abs(totals[0]), kinetic0))
    momenta = np.array([sample["momentum"] for sample in samples])
    momentum_drift = float(np.max(np.abs(momenta)))

    np.savez_compressed(
        output_directory / "molecular-dynamics.npz",
        initial_positions=positions, final_positions=final_positions,
        final_velocities=final_velocities,
        sample_steps=np.array([sample["step"] for sample in samples]),
        totals=totals, momenta=momenta,
    )
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figure, axes = plt.subplots(1, 2, figsize=(11, 4.5))
    steps_axis = [sample["step"] for sample in samples]
    axes[0].plot(steps_axis, [sample["kinetic"] for sample in samples], label="kinetic")
    axes[0].plot(steps_axis, [sample["potential"] for sample in samples], label="potential")
    axes[0].plot(steps_axis, totals, label="total")
    axes[0].set_xlabel("step")
    axes[0].set_ylabel("energy (reduced units)")
    axes[0].legend()
    axes[1].semilogy(steps_axis, np.maximum(np.abs(totals - totals[0]), 1e-18))
    axes[1].set_xlabel("step")
    axes[1].set_ylabel("|total energy - initial|")
    figure.suptitle(f"Lennard-Jones NVE, N={count}, rho={density}, dt={dt}")
    figure.tight_layout()
    figure.savefig(output_directory / "molecular-dynamics.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Periodic Lennard-Jones NVE, velocity Verlet, reduced units",
        "seed": seed,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "particles": count, "density": density, "temperature": temperature,
            "dt": dt, "steps": steps, "cutoff": cutoff,
        },
        "final_statistics": {
            "energy_drift": {"value": energy_drift, "unit": "1"},
            "momentum_drift": {"value": momentum_drift, "unit": "1"},
            "time_reversal_error": {"value": reversal_error, "unit": "1"},
            "final_kinetic_energy": {"value": samples[-1]["kinetic"], "unit": "1"},
            "final_potential_energy": {"value": samples[-1]["potential"], "unit": "1"},
        },
        "artifacts": ["molecular-dynamics.png", "molecular-dynamics.npz", "summary.json"],
        "interpretation": "Classical pair-potential toy system in reduced units; conservation and reversibility diagnostics bound numerical fidelity, not material or chemical realism.",
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
