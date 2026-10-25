"""Bounded surface-graph heat diffusion on a verified ScienceCode CAD mesh.

This model diffuses a scalar temperature over the triangle-mesh adjacency
graph. It is not volumetric heat conduction, finite-element analysis, material
validation, convection/radiation modeling, or printer-safety certification.
ScienceCode supplies the immutable ASCII STL through SCIENCECODE_CAD_MESH_PATH.
"""

from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
import time

import numpy as np
import torch


MAX_STL_BYTES = 128 * 1024 * 1024
MAX_VERTICES = 20_000
MAX_TRIANGLES = 20_000
MAX_EDGES = 60_000
BOUNDARY_FACES = {"x_min", "x_max", "y_min", "y_max", "z_min", "z_max"}
ALLOWED_PARAMETERS = {
    "initial_temperature_c",
    "hot_temperature_c",
    "cold_temperature_c",
    "hot_face",
    "cold_face",
    "thermal_diffusivity_mm2_s",
    "duration_s",
    "steps",
    "face_band_fraction",
    "precision",
    "history_frames",
}


def bounded_float(
    parameters: dict, name: str, default: float, minimum: float, maximum: float
) -> float:
    try:
        value = float(parameters.get(name, default))
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a finite number") from error
    if not math.isfinite(value) or value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def bounded_integer(
    parameters: dict, name: str, default: int, minimum: int, maximum: int
) -> int:
    value = parameters.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def parameter_text(parameters: dict, name: str, default: str) -> str:
    value = parameters.get(name, default)
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    return value.strip().lower()


def read_ascii_stl(file: Path) -> tuple[np.ndarray, np.ndarray, int]:
    stat = file.stat()
    if stat.st_size > MAX_STL_BYTES:
        raise ValueError(f"CAD mesh exceeds {MAX_STL_BYTES} bytes")
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    index_by_coordinate: dict[tuple[float, float, float], int] = {}
    pending: list[int] = []
    degenerate_triangles = 0
    with file.open("r", encoding="utf-8", errors="strict") as handle:
        for raw in handle:
            parts = raw.strip().split()
            if len(parts) != 4 or parts[0].lower() != "vertex":
                continue
            try:
                coordinate = tuple(float(item) for item in parts[1:4])
            except ValueError as error:
                raise ValueError("CAD mesh contains a non-numeric vertex") from error
            if not all(math.isfinite(item) for item in coordinate):
                raise ValueError("CAD mesh contains a non-finite vertex")
            vertex_index = index_by_coordinate.get(coordinate)
            if vertex_index is None:
                if len(vertices) >= MAX_VERTICES:
                    raise ValueError(
                        f"CAD surface solver is limited to {MAX_VERTICES} unique vertices"
                    )
                vertex_index = len(vertices)
                index_by_coordinate[coordinate] = vertex_index
                vertices.append(list(coordinate))
            pending.append(vertex_index)
            if len(pending) == 3:
                if len(set(pending)) == 3:
                    if len(faces) >= MAX_TRIANGLES:
                        raise ValueError(
                            f"CAD surface solver is limited to {MAX_TRIANGLES} triangles"
                        )
                    faces.append(pending)
                else:
                    degenerate_triangles += 1
                pending = []
    if pending:
        raise ValueError("CAD mesh is not a complete ASCII STL triangle stream")
    if not vertices or not faces:
        raise ValueError("CAD mesh has no non-degenerate ASCII STL triangles")
    return (
        np.asarray(vertices, dtype=np.float64),
        np.asarray(faces, dtype=np.int64),
        degenerate_triangles,
    )


def mesh_edges(faces: np.ndarray) -> np.ndarray:
    unique: set[tuple[int, int]] = set()
    for left, middle, right in faces.tolist():
        for first, second in ((left, middle), (middle, right), (right, left)):
            edge = (first, second) if first < second else (second, first)
            unique.add(edge)
            if len(unique) > MAX_EDGES:
                raise ValueError(
                    f"CAD surface solver is limited to {MAX_EDGES} unique edges"
                )
    if not unique:
        raise ValueError("CAD mesh has no usable triangle edges")
    return np.asarray(sorted(unique), dtype=np.int64)


def connected_components(vertex_count: int, edges: np.ndarray) -> int:
    parents = list(range(vertex_count))

    def root(value: int) -> int:
        while parents[value] != value:
            parents[value] = parents[parents[value]]
            value = parents[value]
        return value

    for first, second in edges.tolist():
        left = root(first)
        right = root(second)
        if left != right:
            parents[right] = left
    return len({root(index) for index in range(vertex_count)})


def boundary_mask(
    vertices: torch.Tensor, face: str, band_fraction: float
) -> tuple[torch.Tensor, float, float]:
    axis = {"x": 0, "y": 1, "z": 2}[face[0]]
    coordinates = vertices[:, axis]
    lower = torch.amin(coordinates)
    upper = torch.amax(coordinates)
    span = upper - lower
    if float(span.detach().cpu().item()) <= 0:
        raise ValueError(f"{face} cannot be used because the mesh has zero span on that axis")
    band = span * band_fraction
    if face.endswith("_min"):
        mask = coordinates <= lower + band
        plane = lower
    else:
        mask = coordinates >= upper - band
        plane = upper
    return (
        mask,
        float(plane.detach().cpu().item()),
        float(band.detach().cpu().item()),
    )


def stats(values: torch.Tensor) -> dict[str, float]:
    return {
        "minimum_c": float(torch.amin(values).detach().cpu().item()),
        "maximum_c": float(torch.amax(values).detach().cpu().item()),
        "mean_c": float(torch.mean(values).detach().cpu().item()),
    }


def write_scalar_ply(
    target: Path,
    vertices: np.ndarray,
    faces: np.ndarray,
    temperatures: np.ndarray,
    mesh_sha256: str,
) -> None:
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("ply\n")
        handle.write("format ascii 1.0\n")
        handle.write("comment ScienceCode bounded surface graph heat diffusion\n")
        handle.write(f"comment cad_mesh_sha256 {mesh_sha256}\n")
        handle.write("comment temperature_c unit degree_Celsius\n")
        handle.write(f"element vertex {len(vertices)}\n")
        handle.write("property double x\n")
        handle.write("property double y\n")
        handle.write("property double z\n")
        handle.write("property double temperature_c\n")
        handle.write(f"element face {len(faces)}\n")
        handle.write("property list uchar int vertex_indices\n")
        handle.write("end_header\n")
        for coordinate, temperature in zip(vertices, temperatures, strict=True):
            handle.write(
                " ".join(f"{value:.12g}" for value in coordinate)
                + f" {float(temperature):.12g}\n"
            )
        for face in faces:
            handle.write("3 " + " ".join(str(int(item)) for item in face) + "\n")


def main() -> None:
    output = Path(os.environ["SCIENCECODE_OUTPUT_DIR"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    mesh = Path(os.environ["SCIENCECODE_CAD_MESH_PATH"]).resolve()
    parameters = json.loads(os.environ.get("SCIENCECODE_PARAMETERS_JSON", "{}"))
    if not isinstance(parameters, dict):
        raise ValueError("SCIENCECODE_PARAMETERS_JSON must contain an object")
    unknown = sorted(set(parameters) - ALLOWED_PARAMETERS)
    if unknown:
        raise ValueError("Unknown surface heat parameter: " + unknown[0])

    initial_temperature = bounded_float(
        parameters, "initial_temperature_c", 20.0, -273.15, 5_000.0
    )
    hot_temperature = bounded_float(
        parameters, "hot_temperature_c", 80.0, -273.15, 5_000.0
    )
    cold_temperature = bounded_float(
        parameters, "cold_temperature_c", 20.0, -273.15, 5_000.0
    )
    if hot_temperature <= cold_temperature:
        raise ValueError("hot_temperature_c must be greater than cold_temperature_c")
    hot_face = parameter_text(parameters, "hot_face", "x_min")
    cold_face = parameter_text(parameters, "cold_face", "x_max")
    if hot_face not in BOUNDARY_FACES or cold_face not in BOUNDARY_FACES:
        raise ValueError("hot_face and cold_face must name x/y/z min/max faces")
    if hot_face == cold_face:
        raise ValueError("hot_face and cold_face must be different")
    diffusivity = bounded_float(
        parameters, "thermal_diffusivity_mm2_s", 0.1, 1e-9, 1_000_000.0
    )
    duration = bounded_float(parameters, "duration_s", 10.0, 1e-9, 1_000_000.0)
    steps = bounded_integer(parameters, "steps", 200, 1, 10_000)
    band_fraction = bounded_float(
        parameters, "face_band_fraction", 0.02, 1e-6, 0.25
    )
    history_frames = bounded_integer(parameters, "history_frames", 50, 2, 500)
    precision = parameter_text(parameters, "precision", "float64")
    if precision not in {"float32", "float64"}:
        raise ValueError("precision must be float32 or float64")
    dtype = torch.float32 if precision == "float32" else torch.float64
    requested_device = os.environ.get("SCIENCECODE_DEVICE", "cpu")

    started = time.perf_counter()
    vertices_np, faces_np, degenerate_triangles = read_ascii_stl(mesh)
    edges_np = mesh_edges(faces_np)
    components = connected_components(len(vertices_np), edges_np)
    edge_vectors = vertices_np[edges_np[:, 1]] - vertices_np[edges_np[:, 0]]
    edge_lengths = np.linalg.norm(edge_vectors, axis=1)
    if not np.all(np.isfinite(edge_lengths)) or np.any(edge_lengths <= 0):
        raise ValueError("CAD mesh contains a zero-length or non-finite graph edge")
    mean_edge_length = float(np.mean(edge_lengths))
    dt = duration / steps
    diffusion_number = diffusivity * dt / (mean_edge_length * mean_edge_length)
    if not math.isfinite(diffusion_number) or diffusion_number > 0.45:
        raise ValueError(
            "Unstable explicit surface step: thermal_diffusivity_mm2_s * "
            "duration_s / steps / mean_edge_length_mm^2 must be at most 0.45; "
            "increase steps or reduce duration/diffusivity"
        )

    vertices = torch.as_tensor(vertices_np, dtype=dtype, device=requested_device)
    edges = torch.as_tensor(edges_np, dtype=torch.long, device=requested_device)
    directed_source = torch.cat((edges[:, 0], edges[:, 1]))
    directed_target = torch.cat((edges[:, 1], edges[:, 0]))
    degrees = torch.zeros(len(vertices_np), dtype=dtype, device=requested_device)
    degrees.scatter_add_(
        0, directed_target, torch.ones_like(directed_target, dtype=dtype)
    )
    if bool(torch.any(degrees <= 0).detach().cpu().item()):
        raise ValueError("CAD mesh contains an isolated surface vertex")

    hot_mask, hot_plane, hot_band = boundary_mask(vertices, hot_face, band_fraction)
    cold_mask, cold_plane, cold_band = boundary_mask(vertices, cold_face, band_fraction)
    overlap = hot_mask & cold_mask
    if bool(torch.any(overlap).detach().cpu().item()):
        raise ValueError(
            "Hot and cold boundary bands overlap; reduce face_band_fraction or "
            "choose different boundary faces"
        )
    hot_count = int(torch.count_nonzero(hot_mask).detach().cpu().item())
    cold_count = int(torch.count_nonzero(cold_mask).detach().cpu().item())
    if hot_count == 0 or cold_count == 0:
        raise ValueError("Each boundary face must select at least one mesh vertex")

    temperature = torch.full(
        (len(vertices_np),), initial_temperature, dtype=dtype, device=requested_device
    )
    temperature[hot_mask] = hot_temperature
    temperature[cold_mask] = cold_temperature
    initial_stats = stats(temperature)
    sample_steps = set(
        int(round(index * steps / (history_frames - 1)))
        for index in range(history_frames)
    )
    sample_steps.add(0)
    sample_steps.add(steps)
    history: list[dict[str, float | int]] = []

    def sample(step: int, last_delta: float) -> None:
        current = stats(temperature)
        history.append(
            {
                "step": step,
                "time_s": step * dt,
                "minimum_c": current["minimum_c"],
                "maximum_c": current["maximum_c"],
                "mean_c": current["mean_c"],
                "last_maximum_delta_c": last_delta,
            }
        )

    sample(0, 0.0)
    last_delta = 0.0
    for step in range(1, steps + 1):
        neighbor_sum = torch.zeros_like(temperature)
        neighbor_sum.scatter_add_(0, directed_target, temperature[directed_source])
        neighbor_mean = neighbor_sum / degrees
        updated = temperature + diffusion_number * (neighbor_mean - temperature)
        updated[hot_mask] = hot_temperature
        updated[cold_mask] = cold_temperature
        last_delta = float(
            torch.amax(torch.abs(updated - temperature)).detach().cpu().item()
        )
        temperature = updated
        if step in sample_steps:
            sample(step, last_delta)

    if temperature.device.type == "cuda":
        torch.cuda.synchronize(temperature.device)
    elapsed_seconds = time.perf_counter() - started
    temperatures_np = temperature.detach().cpu().numpy()
    final_stats = stats(temperature)
    tolerance = 1e-5 if precision == "float32" else 1e-10
    finite_check = bool(np.all(np.isfinite(temperatures_np)))
    hot_pin_error = float(np.max(np.abs(temperatures_np[
        hot_mask.detach().cpu().numpy()
    ] - hot_temperature)))
    cold_pin_error = float(np.max(np.abs(temperatures_np[
        cold_mask.detach().cpu().numpy()
    ] - cold_temperature)))
    lower_bound = min(initial_temperature, cold_temperature, hot_temperature)
    upper_bound = max(initial_temperature, cold_temperature, hot_temperature)
    maximum_principle = bool(
        np.min(temperatures_np) >= lower_bound - tolerance
        and np.max(temperatures_np) <= upper_bound + tolerance
    )
    bbox_lower = np.min(vertices_np, axis=0)
    bbox_upper = np.max(vertices_np, axis=0)

    resolved_parameters = {
        "initial_temperature_c": initial_temperature,
        "hot_temperature_c": hot_temperature,
        "cold_temperature_c": cold_temperature,
        "hot_face": hot_face,
        "cold_face": cold_face,
        "thermal_diffusivity_mm2_s": diffusivity,
        "duration_s": duration,
        "steps": steps,
        "face_band_fraction": band_fraction,
        "precision": precision,
        "history_frames": history_frames,
    }
    summary = {
        "model": "Bounded CAD surface-graph heat diffusion",
        "classification": "surface_graph_heat_diffusion_not_volumetric_fea",
        "equation": "T_next = T + lambda * (neighbor_mean(T) - T)",
        "spatial_model": "unweighted triangle-mesh vertex adjacency normalized by mean edge length",
        "cad_build_id": os.environ["SCIENCECODE_CAD_BUILD_ID"],
        "cad_project_id": os.environ["SCIENCECODE_CAD_PROJECT_ID"],
        "mesh_path": str(mesh),
        "mesh_sha256": os.environ["SCIENCECODE_CAD_MESH_SHA256"],
        "device": str(temperature.device),
        "precision": precision,
        "units": {
            "length": "mm",
            "time": "s",
            "temperature": "degree_Celsius",
            "thermal_diffusivity": "mm^2/s",
        },
        "parameters": resolved_parameters,
        "mesh": {
            "vertices": int(len(vertices_np)),
            "triangles": int(len(faces_np)),
            "edges": int(len(edges_np)),
            "connected_components": components,
            "discarded_degenerate_triangles": degenerate_triangles,
            "mean_edge_length_mm": mean_edge_length,
            "bounding_box_mm": {
                "min": bbox_lower.tolist(),
                "max": bbox_upper.tolist(),
                "size": (bbox_upper - bbox_lower).tolist(),
            },
        },
        "integration": {
            "time_step_s": dt,
            "diffusion_number_lambda": diffusion_number,
            "stability_limit": 0.45,
            "steps": steps,
            "history_samples": len(history),
            "last_maximum_delta_c": last_delta,
        },
        "boundaries": {
            "hot": {
                "face": hot_face,
                "plane_mm": hot_plane,
                "band_width_mm": hot_band,
                "vertices": hot_count,
                "temperature_c": hot_temperature,
            },
            "cold": {
                "face": cold_face,
                "plane_mm": cold_plane,
                "band_width_mm": cold_band,
                "vertices": cold_count,
                "temperature_c": cold_temperature,
            },
        },
        "initial": initial_stats,
        "final": final_stats,
        "checks": {
            "finite": finite_check,
            "hot_boundary_pinned": hot_pin_error <= tolerance,
            "cold_boundary_pinned": cold_pin_error <= tolerance,
            "maximum_principle": maximum_principle,
            "hot_boundary_maximum_error_c": hot_pin_error,
            "cold_boundary_maximum_error_c": cold_pin_error,
            "tolerance_c": tolerance,
        },
        "elapsed_seconds": elapsed_seconds,
        "reproducibility": {
            "seed": int(os.environ.get("SCIENCECODE_SEED", "0")),
            "algorithm_has_random_sampling": False,
            "note": (
                "CPU arithmetic is repeatable for the same pinned runtime; "
                "floating-point reduction order may vary across accelerator devices."
            ),
        },
        "artifacts": {
            "temperature_field": "temperature-field.ply",
            "history": "temperature-history.csv",
            "summary": "summary.json",
        },
        "limitations": [
            "This is diffusion on a surface adjacency graph, not a volumetric heat equation or finite-element solve.",
            "No thickness, heat capacity, conductivity tensor, convection, radiation, contact resistance, phase change, or internal heat source is modeled.",
            "thermal_diffusivity_mm2_s controls a normalized graph approximation and must not be treated as validated material behavior.",
            "Boundary conditions are fixed vertex bands selected from the requested bounding-box faces.",
            "Disconnected components without a hot or cold boundary can remain at the initial temperature.",
            "Results are exploratory and are not structural, thermal-safety, manufacturing, or printer certification.",
        ],
    }
    if not all(summary["checks"][name] for name in (
        "finite", "hot_boundary_pinned", "cold_boundary_pinned", "maximum_principle"
    )):
        raise RuntimeError("Surface heat validation checks failed")

    write_scalar_ply(
        output / "temperature-field.ply",
        vertices_np,
        faces_np,
        temperatures_np,
        summary["mesh_sha256"],
    )
    with (output / "temperature-history.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=list(history[0]))
        writer.writeheader()
        writer.writerows(history)
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
