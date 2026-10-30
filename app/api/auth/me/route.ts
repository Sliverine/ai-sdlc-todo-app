import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return apiHandler(request, (session) => NextResponse.json(session));
}
