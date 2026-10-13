import { createHash } from 'node:crypto';

/** Hash esadecimale deterministico dei valori forniti. */
export function hashOf(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export const requestIdOf = (hash: string): string => `r-${hash.slice(0, 12)}`;
export const conversationIdOf = (hash: string): string => `c-${hash.slice(12, 24)}`;
export const correlationIdOf = (hash: string): string => hash.slice(24, 32);
