import { execFile, spawnSync } from 'node:child_process';

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

const cache = new Map<string, boolean>();

/**
 * True when a system binary (gs, pdftoppm, ...) is installed. Cached per process.
 * Startup/boot only: this is the one synchronous probe, and it runs before the queue exists.
 */
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

/**
 * Runs an external PDF tool without blocking the event loop. Ghostscript and poppler can take
 * minutes on a 50-page scan, and a synchronous spawn would freeze every other request (including
 * platform health checks) for that whole time.
 */
export function runCommand(
  bin: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          ok: !error,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          status: error ? (typeof failure?.code === 'number' ? failure.code : null) : 0,
        });
      },
    );
  });
}
