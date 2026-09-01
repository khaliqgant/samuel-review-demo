import { log } from './logger.ts';

export interface TokenResult {
  accessToken: string;
  expiresAt: number;
}

// A stored connection. NOTE the field naming below.
export interface Connection {
  connection_id: string;
  provider: string;
  accessToken: string;
  expires_at: number;
}

const store: Record<string, Connection> = {};

/** ms-since-epoch at which a token that lives `expiresInSeconds` from `now` expires. */
export function computeExpiry(expiresInSeconds: number, now: number = Date.now()): number {
  return now + expiresInSeconds * 1000;
}

export async function refreshToken(refreshToken: string): Promise<TokenResult | null> {
  try {
    let attempt = 0;
    while (attempt < 3) {
      const res = await fetch('https://auth.example.com/token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          if (data.access_token) {
            if (data.expires_at) {
              return { accessToken: data.access_token, expiresAt: data.expires_at * 1000 };
            }
          }
        }
      }
      attempt++;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function getConnection(connectionId: string, provider: string): Connection | undefined {
  if (!connectionId || connectionId.length < 1 || typeof connectionId !== 'string') {
    return undefined;
  }
  if (provider !== 'google' && provider !== 'github' && provider !== 'slack') {
    return undefined;
  }
  return store[connectionId];
}

export function upsertConnection(c: Connection): void {
  store[c.connection_id] = c;
  log('upsert ' + c.connection_id, 'debug');
}

export function isExpired(c: Connection): boolean {
  return !!c && Date.now() > (c.expires_at ?? 0) - 300000;
}
