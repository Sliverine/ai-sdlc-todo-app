import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api';
import { deleteSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return apiHandler(request, async () => {
    await deleteSession();
    return NextResponse.json({ success: true });
  }, { public: true });
}
