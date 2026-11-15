export function graphBounds(points) {
  if (!points.length) return { center: { x: 0, y: 0, z: 0 }, radius: 24 };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  points.forEach(point => {
    for (const axis of ["x", "y", "z"]) {
      min[axis] = Math.min(min[axis], point[axis] ?? 0);
      max[axis] = Math.max(max[axis], point[axis] ?? 0);
    }
  });
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  const radius = Math.max(24, ...points.map(point =>
    Math.hypot(point.x - center.x, point.y - center.y, (point.z ?? 0) - center.z) + 18));
  return { center, radius };
}

export function graph3DCameraFrame(points, aspect, fov = 48) {
  const { center, radius } = graphBounds(points);
  const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, Math.max(0.1, aspect)));
  const minDistance = radius + 24;
  const distance = Math.max(minDistance, radius / Math.sin(halfFov) * 1.12);
  return { center, distance, minDistance, maxDistance: Math.max(640, distance * 4) };
}

export function graphNodeScale(radius, depth, fov, viewportHeight, emphasis) {
  if (viewportHeight <= 0) return emphasis;
  const pixels = emphasis > 1 ? 32 : 22;
  const screenLimit = pixels * Math.max(0, depth) * Math.tan(fov * Math.PI / 360) / (viewportHeight * radius);
  return Math.max(0, Math.min(emphasis, screenLimit));
}

export function graph2DFrame(points) {
  if (!points.length) return { zoom: 1, panX: 0, panY: 0 };
  const { center } = graphBounds(points);
  const width = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)) + 80;
  const height = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)) + 80;
  const zoom = Math.min(3, 900 / width, 600 / height);
  return { zoom, panX: 500 - center.x * zoom, panY: 350 - center.y * zoom };
}

export function createGraphTransition({
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
  now = () => performance.now(),
} = {}) {
  let frame;
  let generation = 0;
  function cancel() {
    generation += 1;
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
  }
  return {
    cancel,
    start(update, duration = 240) {
      cancel();
      if (duration <= 0) {
        update(1);
        return;
      }
      const current = generation;
      const started = now();
      const tick = time => {
        if (current !== generation) return;
        const progress = Math.min(1, Math.max(0, (time - started) / duration));
        frame = undefined;
        update(1 - (1 - progress) ** 3);
        if (progress < 1 && current === generation) frame = requestFrame(tick);
      };
      update(0);
      frame = requestFrame(tick);
    },
  };
}
