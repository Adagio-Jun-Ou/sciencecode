"""GPU-accelerated Gray-Scott reaction-diffusion simulation.

ScienceCode injects the output directory, selected device, seed, and parameters
through environment variables. This script never overwrites project inputs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch


def bounded_integer(parameters: dict, name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(parameters.get(name, default))
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def bounded_float(parameters: dict, name: str, default: float, minimum: float, maximum: float) -> float:
    value = float(parameters.get(name, default))
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def laplacian(field: torch.Tensor) -> torch.Tensor:
    cardinal = (
        torch.roll(field, 1, 0)
        + torch.roll(field, -1, 0)
        + torch.roll(field, 1, 1)
        + torch.roll(field, -1, 1)
    )
    diagonal = (
        torch.roll(torch.roll(field, 1, 0), 1, 1)
        + torch.roll(torch.roll(field, 1, 0), -1, 1)
        + torch.roll(torch.roll(field, -1, 0), 1, 1)
        + torch.roll(torch.roll(field, -1, 0), -1, 1)
    )
    return -field + 0.2 * cardinal + 0.05 * diagonal


def main() -> None:
    output_directory = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    device = torch.device(os.environ.get("SCIENCECODE_DEVICE", "cpu"))
    seed = int(os.environ.get("SCIENCECODE_SEED", "0"))

    width = bounded_integer(parameters, "width", 512, 64, 4096)
    height = bounded_integer(parameters, "height", width, 64, 4096)
    steps = bounded_integer(parameters, "steps", 1200, 1, 100000)
    report_every = bounded_integer(parameters, "report_every", 200, 1, steps)
    diffusion_u = bounded_float(parameters, "diffusion_u", 0.16, 0.0, 1.0)
    diffusion_v = bounded_float(parameters, "diffusion_v", 0.08, 0.0, 1.0)
    feed = bounded_float(parameters, "feed", 0.060, 0.0, 0.2)
    kill = bounded_float(parameters, "kill", 0.062, 0.0, 0.2)
    dt = bounded_float(parameters, "dt", 1.0, 0.001, 1.5)
    noise = bounded_float(parameters, "noise", 0.02, 0.0, 0.5)

    u = torch.ones((height, width), dtype=torch.float32, device=device)
    v = torch.zeros((height, width), dtype=torch.float32, device=device)
    radius_y = max(4, height // 16)
    radius_x = max(4, width // 16)
    center_y = height // 2
    center_x = width // 2
    region = (
        slice(center_y - radius_y, center_y + radius_y),
        slice(center_x - radius_x, center_x + radius_x),
    )
    u[region] = 0.50
    v[region] = 0.25
    if noise:
        u.add_(noise * (torch.rand_like(u) - 0.5)).clamp_(0.0, 1.0)
        v.add_(noise * (torch.rand_like(v) - 0.5)).clamp_(0.0, 1.0)

    checkpoints: list[dict] = []
    started = time.perf_counter()
    for step in range(1, steps + 1):
        uvv = u * v * v
        u = torch.clamp(u + (diffusion_u * laplacian(u) - uvv + feed * (1.0 - u)) * dt, 0.0, 1.0)
        v = torch.clamp(
            v + (diffusion_v * laplacian(v) + uvv - (feed + kill) * v) * dt,
            0.0,
            1.0,
        )
        if step % report_every == 0 or step == steps:
            checkpoints.append(
                {
                    "step": step,
                    "u_mean": float(u.mean().item()),
                    "v_mean": float(v.mean().item()),
                    "v_std": float(v.std().item()),
                }
            )

    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elapsed_seconds = time.perf_counter() - started
    u_array = u.detach().cpu().numpy()
    v_array = v.detach().cpu().numpy()
    np.savez_compressed(
        output_directory / "reaction-diffusion-state.npz",
        u=u_array,
        v=v_array,
        seed=np.int64(seed),
    )

    figure, axes = plt.subplots(1, 3, figsize=(15, 4.8), constrained_layout=True)
    image_u = axes[0].imshow(u_array, cmap="viridis", vmin=0.0, vmax=1.0)
    axes[0].set_title("Activator U")
    image_v = axes[1].imshow(v_array, cmap="magma", vmin=0.0, vmax=max(0.4, float(v_array.max())))
    axes[1].set_title("Inhibitor V")
    axes[2].hist(v_array.ravel(), bins=80, color="#7b2cbf", alpha=0.9)
    axes[2].set_title("Final V distribution")
    axes[2].set_xlabel("concentration")
    axes[2].set_ylabel("cells")
    for axis in axes[:2]:
        axis.set_axis_off()
    figure.colorbar(image_u, ax=axes[0], fraction=0.046)
    figure.colorbar(image_v, ax=axes[1], fraction=0.046)
    figure.suptitle(
        f"Gray-Scott reaction-diffusion | {width}x{height} | {steps} steps | {device}",
        fontsize=12,
    )
    figure.savefig(output_directory / "reaction-diffusion.png", dpi=180)
    plt.close(figure)

    summary = {
        "model": "Gray-Scott reaction-diffusion",
        "device": str(device),
        "seed": seed,
        "grid": {"width": width, "height": height},
        "steps": steps,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "parameters": {
            "diffusion_u": diffusion_u,
            "diffusion_v": diffusion_v,
            "feed": feed,
            "kill": kill,
            "dt": dt,
            "noise": noise,
        },
        "final_statistics": {
            "u_mean": float(u_array.mean()),
            "u_std": float(u_array.std()),
            "v_mean": float(v_array.mean()),
            "v_std": float(v_array.std()),
            "v_min": float(v_array.min()),
            "v_max": float(v_array.max()),
        },
        "checkpoints": checkpoints,
        "artifacts": [
            "reaction-diffusion.png",
            "reaction-diffusion-state.npz",
            "summary.json",
        ],
    }
    (output_directory / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
