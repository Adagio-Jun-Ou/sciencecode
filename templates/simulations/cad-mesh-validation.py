"""Independent CPU/GPU validation of a verified ScienceCode CAD mesh.

This is a geometry calculation, not finite-element, structural, thermal,
fluid, fatigue, collision, tolerance, support, or printer-safety analysis.
ScienceCode supplies the immutable ASCII STL through SCIENCECODE_CAD_MESH_PATH.
"""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
import time

import numpy as np
import torch


MAX_STL_BYTES = 128 * 1024 * 1024
MAX_TRIANGLES = 2_000_000


def bounded_float(
    parameters: dict, name: str, default: float, minimum: float, maximum: float
) -> float:
    value = float(parameters.get(name, default))
    if not np.isfinite(value) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def read_ascii_stl(file: Path) -> np.ndarray:
    stat = file.stat()
    if stat.st_size > MAX_STL_BYTES:
        raise ValueError(f"CAD mesh exceeds {MAX_STL_BYTES} bytes")
    vertices: list[list[float]] = []
    with file.open("r", encoding="utf-8", errors="strict") as handle:
        for raw in handle:
            parts = raw.strip().split()
            if len(parts) == 4 and parts[0].lower() == "vertex":
                vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
                if len(vertices) > MAX_TRIANGLES * 3:
                    raise ValueError(f"CAD mesh exceeds {MAX_TRIANGLES} triangles")
    if not vertices or len(vertices) % 3:
        raise ValueError("CAD mesh is not a complete ASCII STL triangle stream")
    return np.asarray(vertices, dtype=np.float64).reshape((-1, 3, 3))


def main() -> None:
    output = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    mesh = Path(os.environ["SCIENCECODE_CAD_MESH_PATH"]).resolve()
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    density_g_cm3 = bounded_float(parameters, "density_g_cm3", 1.24, 0.000001, 100.0)
    requested_device = os.environ.get("SCIENCECODE_DEVICE", "cpu")
    precision = str(parameters.get("precision", "float64")).lower()
    if precision not in {"float32", "float64"}:
        raise ValueError("precision must be float32 or float64")
    dtype = torch.float32 if precision == "float32" else torch.float64

    started = time.perf_counter()
    triangles_np = read_ascii_stl(mesh)
    triangles = torch.as_tensor(triangles_np, dtype=dtype, device=requested_device)
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    cross = torch.cross(b - a, c - a, dim=1)
    double_area = torch.linalg.vector_norm(cross, dim=1)
    area = double_area * 0.5
    signed_volume = torch.sum(torch.sum(a * torch.cross(b, c, dim=1), dim=1)) / 6.0
    vertices = triangles.reshape((-1, 3))
    lower = torch.amin(vertices, dim=0)
    upper = torch.amax(vertices, dim=0)
    centroid = torch.mean(vertices, dim=0)
    surface_area = torch.sum(area)
    volume = torch.abs(signed_volume)
    if triangles.device.type == "cuda":
        torch.cuda.synchronize(triangles.device)
    elapsed_seconds = time.perf_counter() - started

    volume_mm3 = float(volume.detach().cpu().item())
    summary = {
        "model": "Independent CAD mesh geometry validation",
        "classification": "geometry_validation_not_physics",
        "cad_build_id": os.environ["SCIENCECODE_CAD_BUILD_ID"],
        "cad_project_id": os.environ["SCIENCECODE_CAD_PROJECT_ID"],
        "mesh_path": str(mesh),
        "mesh_sha256": os.environ["SCIENCECODE_CAD_MESH_SHA256"],
        "device": str(triangles.device),
        "precision": precision,
        "triangles": int(triangles.shape[0]),
        "surface_area_mm2": float(surface_area.detach().cpu().item()),
        "signed_volume_mm3": float(signed_volume.detach().cpu().item()),
        "volume_mm3": volume_mm3,
        "estimated_mass_g": volume_mm3 * density_g_cm3 / 1000.0,
        "density_g_cm3": density_g_cm3,
        "bounding_box_mm": {
            "min": lower.detach().cpu().tolist(),
            "max": upper.detach().cpu().tolist(),
            "size": (upper - lower).detach().cpu().tolist(),
        },
        "vertex_mean_mm": centroid.detach().cpu().tolist(),
        "elapsed_seconds": elapsed_seconds,
        "limitations": [
            "The vertex mean is not a volume-weighted center of mass.",
            "Signed volume assumes consistently oriented closed triangles.",
            "This calculation does not model loads, materials, constraints, heat, flow, motion, fatigue, tolerances, supports, or printer behavior.",
        ],
    }
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    with (output / "metrics.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["metric", "value", "unit"])
        writer.writerow(["triangles", summary["triangles"], "count"])
        writer.writerow(["surface_area", summary["surface_area_mm2"], "mm^2"])
        writer.writerow(["volume", summary["volume_mm3"], "mm^3"])
        writer.writerow(["estimated_mass", summary["estimated_mass_g"], "g"])
        writer.writerow(["elapsed", summary["elapsed_seconds"], "s"])
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
