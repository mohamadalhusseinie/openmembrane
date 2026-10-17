export function printPendingReminderCount(count: number): void {
  if (count > 0) {
    const noun = count === 1 ? "candidate is" : "candidates are";
    process.stderr.write(`\nNote: ${count} memory ${noun} waiting for review.\n`);
  }
}
