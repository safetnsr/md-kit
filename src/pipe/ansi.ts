/**
 * Minimal ANSI color helpers — replaces chalk.
 * Zero external dependencies. Respects NO_COLOR env var.
 */

const enabled = !process.env.NO_COLOR && process.stdout.isTTY;

function wrap(code: number, reset: number) {
  return (s: string): string => enabled ? `\x1b[${code}m${s}\x1b[${reset}m` : s;
}

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const green = wrap(32, 39);
export const red = wrap(31, 39);
export const yellow = wrap(33, 39);
export const cyan = wrap(36, 39);
export const magenta = wrap(35, 39);
