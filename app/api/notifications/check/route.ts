import { NextRequest, NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api';
import { todoDB } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return apiHandler(request, (session) =>
    NextResponse.json({ success: true, data: todoDB.findDueReminders(session!.userId) }));
}
