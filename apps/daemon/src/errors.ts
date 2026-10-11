export class DaemonLifecycleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DaemonLifecycleError";
  }
}
