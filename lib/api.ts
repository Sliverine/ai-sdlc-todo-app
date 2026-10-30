import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getSession } from './auth';
import type { Session } from './db';
import { getSingaporeNow } from './timezone';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function expectedOrigin(): string {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new Error('APP_ORIGIN is required');
  const url = new URL(configured);
  if (url.origin !== configured || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' &&
      url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')) {
    throw new Error('APP_ORIGIN must be an origin and use HTTPS in production');
  }
  return url.origin;
}

const apiGlobal = globalThis as typeof globalThis & { __todoRateBuckets?: Map<string, { count: number; reset: number }> };
const buckets = apiGlobal.__todoRateBuckets ?? new Map<string, { count: number; reset: number }>();
apiGlobal.__todoRateBuckets = buckets;

function enforceRateLimit(request: NextRequest, session: Session | null, isPublic: boolean): void {
  const now = getSingaporeNow().getTime();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
  const trustedIP = process.env.TRUST_PROXY === 'true' ? request.headers.get('x-forwarded-for')?.split(',')[0].trim() : undefined;
  const identity = isPublic ? `auth:${trustedIP || 'shared'}` : `user:${session!.userId}`;
  const limit = isPublic ? 60 : 240;
  const bucket = buckets.get(identity);
  if (bucket && bucket.count >= limit) throw new ApiError(429, 'Too many requests. Please try again later.');
  if (bucket) buckets.set(identity, { ...bucket, count: bucket.count + 1 });
  else {
    if (buckets.size >= 10_000) throw new ApiError(429, 'Too many requests. Please try again later.');
    buckets.set(identity, { count: 1, reset: now + 60_000 });
  }
}

export async function readJson(request: NextRequest): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'Content-Type must be application/json');
  }
  const maxBytes = 65_536;
  if (Number(request.headers.get('content-length')) > maxBytes) throw new ApiError(413, 'Request is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'A JSON body is required');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'Request is too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError(400, 'Invalid JSON body'); }
}

export async function apiHandler(
  request: NextRequest,
  callback: (session: Session | null) => Promise<NextResponse> | NextResponse,
  options: { public?: boolean } = {},
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!options.public && !session) throw new ApiError(401, 'Not authenticated');
    enforceRateLimit(request, session, options.public ?? false);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.get('origin') !== expectedOrigin()) throw new ApiError(403, 'Invalid request origin');
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'Invalid request origin');
    }
    const response = await callback(session);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : 500;
    const message = error instanceof ApiError ? error.message :
      error instanceof ZodError ? error.issues[0]?.message ?? 'Invalid input' : 'An unexpected error occurred';
    const response = NextResponse.json({ error: message }, { status });
    response.headers.set('Cache-Control', 'no-store');
    if (status === 429) response.headers.set('Retry-After', '60');
    return response;
  }
}
