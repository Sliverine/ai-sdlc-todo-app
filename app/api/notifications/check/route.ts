import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  void request;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: todoDB.findDueReminders(session.userId) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Reminder lookup failed', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ error: 'Unable to check reminders' }, { status: 500 });
  }
}
