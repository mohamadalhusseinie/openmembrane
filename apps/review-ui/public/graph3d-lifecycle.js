export async function initializeGraphRenderer(loadModule, isCurrent, mount) {
  const rendererModule = await loadModule();
  if (!isCurrent()) return undefined;
  return mount(rendererModule);
}

export function disposeGraphRenderer(renderer) {
  renderer?.destroy();
}

export function clearGraphObjects(scene, objects, instancedMeshes, resources) {
  objects.forEach(object => scene.remove(object));
  instancedMeshes.forEach(mesh => mesh.dispose());
  resources.forEach(resource => resource.dispose());
}

export function createGraphPointerSelectionGuard() {
  const activePointers = new Set();
  let startPointerId;
  let startPosition;
  let dragging = false;
  let suppressUntilIdle = false;

  function resetIfIdle() {
    if (activePointers.size !== 0) return;
    startPointerId = undefined;
    startPosition = undefined;
    dragging = false;
    suppressUntilIdle = false;
  }

  function clearStart(pointerId) {
    if (startPointerId !== pointerId) return;
    startPointerId = undefined;
    startPosition = undefined;
  }

  return {
    pointerDown(pointerId, x, y) {
      activePointers.add(pointerId);
      if (activePointers.size > 1) suppressUntilIdle = true;
      if (activePointers.size === 1 && !suppressUntilIdle) {
        startPointerId = pointerId;
        startPosition = { x, y };
        dragging = false;
      }
    },
    pointerMove(pointerId, x, y) {
      if (startPointerId === pointerId && startPosition &&
        Math.hypot(x - startPosition.x, y - startPosition.y) > 4) {
        dragging = true;
      }
    },
    pointerUp(pointerId, x, y) {
      if (activePointers.size > 1) suppressUntilIdle = true;
      const shouldSelect = !suppressUntilIdle &&
        activePointers.size === 1 &&
        startPointerId === pointerId &&
        !dragging &&
        startPosition !== undefined &&
        Math.hypot(x - startPosition.x, y - startPosition.y) <= 4;
      activePointers.delete(pointerId);
      clearStart(pointerId);
      resetIfIdle();
      return shouldSelect;
    },
    pointerCancel(pointerId) {
      suppressUntilIdle = true;
      activePointers.delete(pointerId);
      clearStart(pointerId);
      resetIfIdle();
    },
  };
}
