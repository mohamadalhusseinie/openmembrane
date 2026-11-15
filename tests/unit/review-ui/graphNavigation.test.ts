import { describe, expect, it, vi } from "vitest";
import {
  createGraphTransition,
  graph2DFrame,
  graph3DCameraFrame,
  graphBounds,
  graphNodeScale,
} from "../../../apps/review-ui/public/graph-navigation.js";

describe("graph camera navigation", () => {
  it("fits translated neighborhoods outside their bounds at wide and narrow aspect ratios", () => {
    const points = [{ x: 100, y: -50, z: 80 }, { x: 180, y: 30, z: 160 }];
    const { center, radius } = graphBounds(points);
    for (const aspect of [0.4, 1, 2]) {
      const frame = graph3DCameraFrame(points, aspect);
      expect(frame.center).toEqual(center);
      expect(frame.minDistance).toBeGreaterThan(radius);
      expect(frame.distance).toBeGreaterThanOrEqual(frame.minDistance);
      const halfFov = Math.atan(Math.tan(48 * Math.PI / 360) * Math.min(aspect, 1));
      expect(Math.asin(radius / frame.distance)).toBeLessThan(halfFov);
      expect(frame.maxDistance).toBeGreaterThan(frame.distance);
    }
    expect(graph3DCameraFrame(points, 0.4).distance).toBeGreaterThan(graph3DCameraFrame(points, 2).distance);
    expect(graph3DCameraFrame([], 1).distance).toBeGreaterThan(0);
    expect(graph3DCameraFrame([points[0]!], 1).center).toEqual(points[0]);
  });

  it("caps projected node diameter even when zooming close to an emphasized foreground node", () => {
    const radius = 11;
    for (const depth of [0.5, 5, 25, 100, 800]) {
      for (const emphasis of [1, 1.4, 1.65]) {
        const scale = graphNodeScale(radius, depth, 48, 700, emphasis);
        const diameterPixels = radius * scale * 700 / (depth * Math.tan(48 * Math.PI / 360));
        expect(diameterPixels).toBeLessThanOrEqual((emphasis > 1 ? 32 : 22) + 0.001);
        expect(scale).toBeLessThanOrEqual(emphasis);
      }
    }
  });

  it("centers selected 2D nodes and fits the complete visible neighborhood", () => {
    const point = { x: 750, y: 580 };
    const selected = graph2DFrame([point]);
    expect(point.x * selected.zoom + selected.panX).toBe(500);
    expect(point.y * selected.zoom + selected.panY).toBe(350);
    const points = [{ x: 200, y: 50 }, { x: 800, y: 650 }];
    const frame = graph2DFrame(points);
    for (const point of points) {
      expect(point.x * frame.zoom + frame.panX).toBeGreaterThan(0);
      expect(point.x * frame.zoom + frame.panX).toBeLessThan(1000);
      expect(point.y * frame.zoom + frame.panY).toBeGreaterThan(0);
      expect(point.y * frame.zoom + frame.panY).toBeLessThan(700);
    }
  });

  it("runs only during transitions and cancels superseded or disposed work", () => {
    const frames = new Map<number, (time: number) => void>();
    let nextId = 0;
    const transition = createGraphTransition({
      requestFrame: callback => { frames.set(++nextId, callback); return nextId; },
      cancelFrame: id => { frames.delete(id); },
      now: () => 0,
    });
    const update = vi.fn();
    transition.start(update, 240);
    const obsolete = frames.get(1)!;
    const replacement = vi.fn();
    transition.start(replacement, 240);
    obsolete(240);
    expect(update.mock.calls).toEqual([[0]]);
    const finish = frames.get(2)!;
    frames.delete(2);
    finish(240);
    expect(replacement).toHaveBeenLastCalledWith(1);
    expect(frames.size).toBe(0);
    transition.start(update);
    transition.cancel();
    expect(frames.size).toBe(0);
    transition.start(update, 0);
    expect(update).toHaveBeenLastCalledWith(1);
    expect(frames.size).toBe(0);
  });
});
