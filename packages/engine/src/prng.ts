/**
 * Fast, deterministic 32-bit pseudo-random number generator (Mulberry32).
 */
export class PRNG {
  private state: number;

  constructor(seed: number | string) {
    if (typeof seed === 'string') {
      this.state = PRNG.hashString(seed);
    } else {
      this.state = seed >>> 0;
    }
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  private static hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Generates a pseudo-random 32-bit unsigned integer.
   */
  public nextInt(): number {
    let z = (this.state += 0x6d2b79f5);
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return (z ^ (z >>> 14)) >>> 0;
  }

  /**
   * Generates a floating point number in [0, 1).
   */
  public nextFloat(): number {
    return this.nextInt() / 4294967296;
  }

  /**
   * Returns a random integer in [min, max] inclusive.
   */
  public nextRange(min: number, max: number): number {
    if (min >= max) return min;
    const range = max - min + 1;
    return min + (this.nextInt() % range);
  }

  /**
   * Shuffles an array in place using Fisher-Yates with this PRNG.
   */
  public shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextRange(0, i);
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }
}
