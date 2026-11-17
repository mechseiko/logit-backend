import { spawnSync } from 'node:child_process';

const cache = new Map<string, boolean>();

/** True when a system binary (gs, pdftoppm, ...) is installed. Cached per process. */
export function hasCommand(bin: string): boolean {
  const cached = cache.get(bin);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    const result = spawnSync(bin, ['-v'], { stdio: 'ignore', timeout: 5000 });
    available = result.status === 0 || result.status === 1;
    if (!available) {
      const alt = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 5000 });
      available = alt.status === 0;
    }
  } catch {
    available = false;
  }
  cache.set(bin, available);
  return available;
}

export function runCommand(
  bin: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(bin, args, {
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}
