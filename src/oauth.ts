export interface TokenResult {
  accessToken: string;
  expiresAt: number;
}

/** ms-since-epoch at which a token that lives `expiresInSeconds` from `now` expires. */
export function computeExpiry(expiresInSeconds: number, now: number = Date.now()): number {
  return now + expiresInSeconds * 1000;
}
