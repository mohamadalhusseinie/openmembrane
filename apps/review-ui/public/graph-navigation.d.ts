interface Point { x: number; y: number; z?: number }
export function graphBounds(points: Point[]): { center: Required<Point>; radius: number };
export function graph3DCameraFrame(points: Point[], aspect: number, fov?: number): {
  center: Required<Point>; distance: number; minDistance: number; maxDistance: number;
};
export function graphNodeScale(radius: number, depth: number, fov: number, viewportHeight: number, emphasis: number): number;
export function graph2DFrame(points: Point[]): { zoom: number; panX: number; panY: number };
export function createGraphTransition(options?: {
  requestFrame?: (callback: (time: number) => void) => number;
  cancelFrame?: (id: number) => void;
  now?: () => number;
}): { cancel(): void; start(update: (progress: number) => void, duration?: number): void };
