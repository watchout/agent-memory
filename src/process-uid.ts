/**
 * The numeric id of the user running this process; null on a platform that has
 * none (for example Windows). One definition for the hooks and the watcher; what
 * a missing id means is decided by the caller.
 */
export function currentUid(proc: { getuid?: () => number } = process): number | null {
  return proc.getuid ? proc.getuid() : null;
}
