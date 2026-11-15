import { graphRefKey } from "./graph.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function graph3dMotionSettings(prefersReducedMotion) {
  return {
    enableDamping: false,
    autoRotate: false,
    rotateSpeed: prefersReducedMotion ? 0.65 : 1,
  };
}

export function graph3dEdgeStyle(origin) {
  if (origin === "manual") return { color: "#16a34a", dashSize: 8, gapSize: 5 };
  if (origin === "derived") return { color: "#f59e0b", dashSize: 2, gapSize: 4 };
  return { color: "#6366f1" };
}

export function layoutGraphNodes3D(nodes, edges) {
  const positions = new Map();
  if (!nodes.length) return positions;

  const nodeIndices = new Map(nodes.map((node, index) => [graphRefKey(node), index]));
  const count = nodes.length;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const height = 1 - 2 * (index + 0.5) / count;
    const radius = Math.sqrt(Math.max(0, 1 - height * height)) * (count === 1 ? 0 : 135);
    const angle = index * GOLDEN_ANGLE;
    x[index] = Math.cos(angle) * radius;
    y[index] = height * (count === 1 ? 0 : 135);
    z[index] = Math.sin(angle) * radius;
  }

  const activeEdges = edges
    .map(edge => [nodeIndices.get(graphRefKey(edge.source)), nodeIndices.get(graphRefKey(edge.target))])
    .filter(pair => pair[0] !== undefined && pair[1] !== undefined);
  const iterations = count > 300 ? 18 : 28;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        const dx = x[left] - x[right];
        const dy = y[left] - y[right];
        const dz = z[left] - z[right];
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= 42 * 42) continue;
        const distance = Math.sqrt(distanceSquared) || 0.01;
        const force = (42 - distance) * 0.018 * cooling / distance;
        x[left] += dx * force;
        y[left] += dy * force;
        z[left] += dz * force;
        x[right] -= dx * force;
        y[right] -= dy * force;
        z[right] -= dz * force;
      }
    }

    activeEdges.forEach(([source, target]) => {
      const dx = x[target] - x[source];
      const dy = y[target] - y[source];
      const dz = z[target] - z[source];
      const distance = Math.hypot(dx, dy, dz) || 0.01;
      const force = (distance - 68) * 0.02 * cooling / distance;
      x[source] += dx * force;
      y[source] += dy * force;
      z[source] += dz * force;
      x[target] -= dx * force;
      y[target] -= dy * force;
      z[target] -= dz * force;
    });
  }

  nodes.forEach((node, index) => {
    positions.set(graphRefKey(node), { x: x[index], y: y[index], z: z[index] });
  });
  return positions;
}
