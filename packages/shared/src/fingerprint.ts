/** Page-size normalisation and perceptual-hash comparison used for template matching. */

export function pageSizeKey(widthPt: number, heightPt: number): string {
  return `${Math.round(widthPt)}x${Math.round(heightPt)}`;
}

export function parsePageSizeKey(key: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(key);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Both dimensions must be within `tolerance` (default 2%) of each other, either orientation. */
export function pageSizeMatches(a: string, b: string, tolerance = 0.02): boolean {
  const left = parsePageSizeKey(a);
  const right = parsePageSizeKey(b);
  if (!left || !right) return false;
  const close = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y) <= tolerance;
  return (
    (close(left.width, right.width) && close(left.height, right.height)) ||
    (close(left.width, right.height) && close(left.height, right.width))
  );
}

export function hammingDistance(hexA: string, hexB: string): number {
  const length = Math.min(hexA.length, hexB.length);
  let distance = 0;
  for (let i = 0; i < length; i += 1) {
    const a = parseInt(hexA[i]!, 16);
    const b = parseInt(hexB[i]!, 16);
    if (Number.isNaN(a) || Number.isNaN(b)) return 64;
    let xor = a ^ b;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance + Math.abs(hexA.length - hexB.length) * 4;
}

/** 0..1, 1 = identical. Compares the first min(len) hashes. */
export function fingerprintSimilarity(a: string[], b: string[]): number {
  const count = Math.min(a.length, b.length);
  if (count === 0) return 0;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += 1 - hammingDistance(a[i]!, b[i]!) / 64;
  }
  return total / count;
}
