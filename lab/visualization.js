export const MAX_PLOT_POINTS = 5000;

const DEFAULT_PADDING = Object.freeze({ left: 58, right: 22, top: 24, bottom: 48 });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function finitePlotNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

export function inferPlotColumns(rows) {
  const source = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
  const width = source.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const first = source[0] ?? [];
  const hasHeader = source.length > 1 && first.some((value) =>
    String(value ?? '').trim() && finitePlotNumber(value) === null
  );
  const startRow = hasHeader ? 1 : 0;
  const columns = Array.from({ length: width }, (_, index) => {
    let numericCount = 0;
    let populatedCount = 0;
    for (let rowIndex = startRow; rowIndex < source.length; rowIndex += 1) {
      const value = source[rowIndex]?.[index];
      if (String(value ?? '').trim()) populatedCount += 1;
      if (finitePlotNumber(value) !== null) numericCount += 1;
    }
    const header = hasHeader ? String(first[index] ?? '').trim() : '';
    return {
      index,
      label: header || columnName(index),
      numeric_count: numericCount,
      populated_count: populatedCount
    };
  });
  return {
    has_header: hasHeader,
    start_row: startRow,
    row_count: Math.max(0, source.length - startRow),
    width,
    columns,
    numeric_columns: columns.filter((column) => column.numeric_count > 0)
  };
}

function sampledPoints(points, maximum) {
  if (points.length <= maximum) return points;
  if (maximum <= 1) return [points[0]];
  const sampled = [];
  let previous = -1;
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(index * (points.length - 1) / (maximum - 1));
    if (sourceIndex !== previous) sampled.push(points[sourceIndex]);
    previous = sourceIndex;
  }
  return sampled;
}

export function plotBounds(points, padding = 0.06) {
  const valid = (Array.isArray(points) ? points : []).filter((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  );
  if (!valid.length) return { x_min: 0, x_max: 1, y_min: 0, y_max: 1 };
  let xMin = Math.min(...valid.map((point) => point.x));
  let xMax = Math.max(...valid.map((point) => point.x));
  let yMin = Math.min(...valid.map((point) => point.y));
  let yMax = Math.max(...valid.map((point) => point.y));
  const xPad = xMax === xMin
    ? Math.max(Math.abs(xMin) * 0.05, 0.5)
    : (xMax - xMin) * clamp(padding, 0, 0.5);
  const yPad = yMax === yMin
    ? Math.max(Math.abs(yMin) * 0.05, 0.5)
    : (yMax - yMin) * clamp(padding, 0, 0.5);
  xMin -= xPad;
  xMax += xPad;
  yMin -= yPad;
  yMax += yPad;
  return { x_min: xMin, x_max: xMax, y_min: yMin, y_max: yMax };
}

export function buildPlotSeries(rows, {
  xColumn = null,
  yColumn = null,
  maxPoints = MAX_PLOT_POINTS
} = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const layout = inferPlotColumns(source);
  const y = layout.numeric_columns.find((column) => column.index === Number(yColumn)) ??
    layout.numeric_columns[0] ?? null;
  const requestedX = xColumn === null || xColumn === 'index' ? null : Number(xColumn);
  const x = requestedX === null
    ? null
    : layout.numeric_columns.find((column) => column.index === requestedX) ?? null;
  if (!y) {
    return {
      layout,
      x_column: null,
      y_column: null,
      x_label: 'Row',
      y_label: 'No numeric column',
      points: [],
      source_point_count: 0,
      truncated: false,
      bounds: plotBounds([])
    };
  }
  const points = [];
  for (let rowIndex = layout.start_row; rowIndex < source.length; rowIndex += 1) {
    const row = source[rowIndex] ?? [];
    const yValue = finitePlotNumber(row[y.index]);
    const xValue = x ? finitePlotNumber(row[x.index]) : rowIndex - layout.start_row + 1;
    if (xValue === null || yValue === null) continue;
    points.push({
      x: xValue,
      y: yValue,
      row: rowIndex + 1,
      source_x: x ? String(row[x.index] ?? '') : String(rowIndex - layout.start_row + 1),
      source_y: String(row[y.index] ?? '')
    });
  }
  const limit = clamp(Number.isInteger(maxPoints) ? maxPoints : MAX_PLOT_POINTS, 1, MAX_PLOT_POINTS);
  const selected = sampledPoints(points, limit);
  return {
    layout,
    x_column: x?.index ?? null,
    y_column: y.index,
    x_label: x?.label ?? 'Row',
    y_label: y.label,
    points: selected,
    source_point_count: points.length,
    truncated: selected.length < points.length,
    bounds: plotBounds(points)
  };
}

function paddingValue(padding) {
  return { ...DEFAULT_PADDING, ...(padding ?? {}) };
}

function plotArea(width, height, padding) {
  const edge = paddingValue(padding);
  return {
    ...edge,
    width: Math.max(1, width - edge.left - edge.right),
    height: Math.max(1, height - edge.top - edge.bottom)
  };
}

export function fitPlotView(bounds) {
  const source = bounds ?? plotBounds([]);
  return {
    x_min: Number(source.x_min),
    x_max: Number(source.x_max),
    y_min: Number(source.y_min),
    y_max: Number(source.y_max)
  };
}

export function plotToCanvas(point, view, width, height, padding) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  const area = plotArea(width, height, padding);
  const xSpan = Math.max(Number.EPSILON, view.x_max - view.x_min);
  const ySpan = Math.max(Number.EPSILON, view.y_max - view.y_min);
  return {
    x: area.left + (point.x - view.x_min) / xSpan * area.width,
    y: area.top + (view.y_max - point.y) / ySpan * area.height
  };
}

export function canvasToPlot(point, view, width, height, padding) {
  const area = plotArea(width, height, padding);
  const xRatio = (point.x - area.left) / area.width;
  const yRatio = (point.y - area.top) / area.height;
  return {
    x: view.x_min + xRatio * (view.x_max - view.x_min),
    y: view.y_max - yRatio * (view.y_max - view.y_min)
  };
}

export function nearestPlotPoint(points, target, view, width, height, maximumDistance = 18, padding) {
  let nearest = null;
  let distance = maximumDistance;
  for (const point of Array.isArray(points) ? points : []) {
    const canvas = plotToCanvas(point, view, width, height, padding);
    if (!canvas) continue;
    const candidate = Math.hypot(canvas.x - target.x, canvas.y - target.y);
    if (candidate <= distance) {
      distance = candidate;
      nearest = point;
    }
  }
  return nearest;
}

export function zoomPlotView(view, anchor, factor) {
  const scale = clamp(Number(factor) || 1, 0.05, 20);
  const x = Number.isFinite(anchor?.x) ? anchor.x : (view.x_min + view.x_max) / 2;
  const y = Number.isFinite(anchor?.y) ? anchor.y : (view.y_min + view.y_max) / 2;
  return {
    x_min: x - (x - view.x_min) * scale,
    x_max: x + (view.x_max - x) * scale,
    y_min: y - (y - view.y_min) * scale,
    y_max: y + (view.y_max - y) * scale
  };
}

export function panPlotView(view, deltaX, deltaY, width, height, padding) {
  const area = plotArea(width, height, padding);
  const xShift = -Number(deltaX || 0) / area.width * (view.x_max - view.x_min);
  const yShift = Number(deltaY || 0) / area.height * (view.y_max - view.y_min);
  return {
    x_min: view.x_min + xShift,
    x_max: view.x_max + xShift,
    y_min: view.y_min + yShift,
    y_max: view.y_max + yShift
  };
}

export function clampUnitPoint(point) {
  return {
    x: clamp(Number(point?.x) || 0, 0, 1),
    y: clamp(Number(point?.y) || 0, 0, 1)
  };
}

export function figureLayout({ imageWidth, imageHeight, canvasWidth, canvasHeight, view } = {}) {
  const sourceWidth = Math.max(1, Number(imageWidth) || 1);
  const sourceHeight = Math.max(1, Number(imageHeight) || 1);
  const width = Math.max(1, Number(canvasWidth) || 1);
  const height = Math.max(1, Number(canvasHeight) || 1);
  const zoom = clamp(Number(view?.zoom) || 1, 0.2, 20);
  const fit = Math.max(0.0001, Math.min(
    Math.max(1, width - 32) / sourceWidth,
    Math.max(1, height - 32) / sourceHeight
  ));
  const scale = fit * zoom;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    left: (width - drawWidth) / 2 + (Number(view?.pan_x) || 0),
    top: (height - drawHeight) / 2 + (Number(view?.pan_y) || 0),
    width: drawWidth,
    height: drawHeight,
    scale
  };
}

export function figurePointToCanvas(point, layout) {
  const normalized = clampUnitPoint(point);
  return {
    x: layout.left + normalized.x * layout.width,
    y: layout.top + normalized.y * layout.height
  };
}

export function canvasToFigurePoint(point, layout) {
  return clampUnitPoint({
    x: (Number(point?.x) - layout.left) / layout.width,
    y: (Number(point?.y) - layout.top) / layout.height
  });
}

export function zoomFigureView(view, factor, anchor, dimensions) {
  const current = {
    zoom: clamp(Number(view?.zoom) || 1, 0.2, 20),
    pan_x: Number(view?.pan_x) || 0,
    pan_y: Number(view?.pan_y) || 0
  };
  const canvasWidth = Math.max(1, Number(dimensions?.canvasWidth) || 1);
  const canvasHeight = Math.max(1, Number(dimensions?.canvasHeight) || 1);
  const target = {
    x: Number.isFinite(anchor?.x) ? anchor.x : canvasWidth / 2,
    y: Number.isFinite(anchor?.y) ? anchor.y : canvasHeight / 2
  };
  const before = figureLayout({ ...dimensions, canvasWidth, canvasHeight, view: current });
  const sourcePoint = canvasToFigurePoint(target, before);
  const next = { ...current, zoom: clamp(current.zoom * (Number(factor) || 1), 0.2, 20) };
  const after = figureLayout({ ...dimensions, canvasWidth, canvasHeight, view: next });
  const projected = figurePointToCanvas(sourcePoint, after);
  next.pan_x += target.x - projected.x;
  next.pan_y += target.y - projected.y;
  return next;
}

export function formatPlotNumber(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.001) || magnitude >= 1_000_000) {
    return value.toExponential(3);
  }
  return Number(value.toPrecision(6)).toString();
}
