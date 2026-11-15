export function initializeGraphRenderer<TModule, TRenderer>(
  loadModule: () => Promise<TModule>,
  isCurrent: () => boolean,
  mount: (module: TModule) => TRenderer,
): Promise<TRenderer | undefined>;
export function disposeGraphRenderer(renderer: { destroy(): void } | undefined): void;
