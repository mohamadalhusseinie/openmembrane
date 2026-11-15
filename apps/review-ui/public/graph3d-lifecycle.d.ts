export function initializeGraphRenderer<TModule, TRenderer>(
  loadModule: () => Promise<TModule>,
  isCurrent: () => boolean,
  mount: (module: TModule) => TRenderer,
): Promise<TRenderer | undefined>;
export function disposeGraphRenderer(renderer: { destroy(): void } | undefined): void;
export function clearGraphObjects(
  scene: { remove(object: object): void },
  objects: object[],
  instancedMeshes: Array<{ dispose(): void }>,
  resources: Array<{ dispose(): void }>,
): void;
