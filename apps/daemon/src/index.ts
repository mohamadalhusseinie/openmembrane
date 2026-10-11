import { reportDaemonFailure, runDaemonCommand } from "./lifecycle";

try {
  await runDaemonCommand("serve");
} catch (error) {
  await reportDaemonFailure(error);
}
