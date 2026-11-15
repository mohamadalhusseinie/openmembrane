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
