export async function initializeGraphRenderer(loadModule, isCurrent, mount) {
  const rendererModule = await loadModule();
  if (!isCurrent()) return undefined;
  return mount(rendererModule);
}

export function disposeGraphRenderer(renderer) {
  renderer?.destroy();
}
