import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlotSeries,
  canvasToPlot,
  canvasToFigurePoint,
  clampUnitPoint,
  figureLayout,
  figurePointToCanvas,
  fitPlotView,
  formatPlotNumber,
  inferPlotColumns,
  nearestPlotPoint,
  panPlotView,
  plotToCanvas,
  zoomFigureView,
  zoomPlotView
} from '../lab/visualization.js';

test('plot data inference preserves source rows and chooses numeric columns', () => {
  const rows = [
    ['time_s', 'signal', 'group'],
    ['0', '1.5', 'control'],
    ['1', '2.25', 'control'],
    ['2', 'missing', 'treated'],
    ['3', '4.75', 'treated']
  ];
  const layout = inferPlotColumns(rows);
  assert.equal(layout.has_header, true);
  assert.equal(layout.start_row, 1);
  assert.deepEqual(layout.numeric_columns.map((column) => column.label), ['time_s', 'signal']);

  const series = buildPlotSeries(rows, { xColumn: 0, yColumn: 1 });
  assert.equal(series.x_label, 'time_s');
  assert.equal(series.y_label, 'signal');
  assert.equal(series.source_point_count, 3);
  assert.deepEqual(series.points.map((point) => point.row), [2, 3, 5]);
  assert.deepEqual(series.points.map(({ x, y }) => ({ x, y })), [
    { x: 0, y: 1.5 },
    { x: 1, y: 2.25 },
    { x: 3, y: 4.75 }
  ]);
});

test('large plot series are evenly bounded while keeping endpoints', () => {
  const rows = [['x', 'y']];
  for (let index = 0; index < 100; index += 1) rows.push([String(index), String(index * index)]);
  const series = buildPlotSeries(rows, { xColumn: 0, yColumn: 1, maxPoints: 9 });
  assert.equal(series.source_point_count, 100);
  assert.equal(series.points.length, 9);
  assert.equal(series.points[0].x, 0);
  assert.equal(series.points.at(-1).x, 99);
  assert.equal(series.truncated, true);
  assert.ok(series.bounds.x_min < 0);
  assert.ok(series.bounds.y_max > 9801);
});

test('plot transforms, selection, zoom, and pan remain reversible and deterministic', () => {
  const view = fitPlotView({ x_min: 0, x_max: 10, y_min: -5, y_max: 5 });
  const canvas = plotToCanvas({ x: 4, y: 2 }, view, 800, 500);
  const restored = canvasToPlot(canvas, view, 800, 500);
  assert.ok(Math.abs(restored.x - 4) < 1e-10);
  assert.ok(Math.abs(restored.y - 2) < 1e-10);
  const points = [{ x: 1, y: 1, row: 2 }, { x: 4, y: 2, row: 3 }];
  assert.equal(nearestPlotPoint(points, canvas, view, 800, 500)?.row, 3);
  assert.equal(nearestPlotPoint(points, { x: 799, y: 499 }, view, 800, 500, 2), null);

  const zoomed = zoomPlotView(view, { x: 5, y: 0 }, 0.5);
  assert.deepEqual(zoomed, { x_min: 2.5, x_max: 7.5, y_min: -2.5, y_max: 2.5 });
  const panned = panPlotView(zoomed, 72, -42.8, 800, 500, {
    left: 58, right: 22, top: 24, bottom: 48
  });
  assert.ok(panned.x_min < zoomed.x_min);
  assert.ok(panned.y_min < zoomed.y_min);
  assert.equal(panned.x_max - panned.x_min, zoomed.x_max - zoomed.x_min);
});

test('figure points and number labels are normalized for safe interaction records', () => {
  assert.deepEqual(clampUnitPoint({ x: -2, y: 1.4 }), { x: 0, y: 1 });
  assert.deepEqual(clampUnitPoint({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
  const dimensions = {
    imageWidth: 1000,
    imageHeight: 500,
    canvasWidth: 600,
    canvasHeight: 400
  };
  const view = { zoom: 1, pan_x: 0, pan_y: 0 };
  const layout = figureLayout({ ...dimensions, view });
  assert.equal(layout.left, 16);
  assert.equal(layout.width, 568);
  const sourcePoint = { x: 0.72, y: 0.31 };
  const canvasPoint = figurePointToCanvas(sourcePoint, layout);
  const restored = canvasToFigurePoint(canvasPoint, layout);
  assert.ok(Math.abs(restored.x - sourcePoint.x) < 1e-12);
  assert.ok(Math.abs(restored.y - sourcePoint.y) < 1e-12);
  const zoomed = zoomFigureView(view, 2, canvasPoint, dimensions);
  const zoomedLayout = figureLayout({ ...dimensions, view: zoomed });
  const anchored = figurePointToCanvas(sourcePoint, zoomedLayout);
  assert.ok(Math.abs(anchored.x - canvasPoint.x) < 1e-10);
  assert.ok(Math.abs(anchored.y - canvasPoint.y) < 1e-10);
  assert.equal(formatPlotNumber(0.000012345), '1.234e-5');
  assert.equal(formatPlotNumber(123.456789), '123.457');
});
