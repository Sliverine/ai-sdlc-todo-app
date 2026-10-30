import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiHandler, readJson } from '@/lib/api';
import { todoDB } from '@/lib/db';
import { prioritySchema, validateTodo } from '@/lib/validation';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return apiHandler(request, (session) => {
    const priority = request.nextUrl.searchParams.get('priority');
    const filter = priority === null ? null : prioritySchema.parse(priority);
    const todos = todoDB.findAllByUser(session!.userId);
    return NextResponse.json(filter ? todos.filter((todo) => todo.priority === filter) : todos);
  });
}

export async function POST(request: NextRequest) {
  return apiHandler(request, async (session) => {
    const body = await readJson(request);
    try {
      const input = validateTodo(body);
      return NextResponse.json(todoDB.create(session!.userId, input), { status: 201 });
    } catch (error) {
      throw new ApiError(400, error instanceof Error && !('code' in error) ? error.message : 'Invalid todo input');
    }
  });
}
