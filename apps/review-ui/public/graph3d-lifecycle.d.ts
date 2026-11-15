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
export function createGraphPointerSelectionGuard(): {
  pointerDown(pointerId: number, x: number, y: number): void;
  pointerMove(pointerId: number, x: number, y: number): void;
  pointerUp(pointerId: number, x: number, y: number): boolean;
  pointerCancel(pointerId: number): void;
};
