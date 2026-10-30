import { NextRequest, NextResponse } from 'next/server';
import { ApiError, apiHandler, readJson } from '@/lib/api';
import { todoDB } from '@/lib/db';
import { todoUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

async function todoId(context: Context): Promise<number> {
  const { id } = await context.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new ApiError(404, 'Todo not found');
  return Number(id);
}

export async function GET(request: NextRequest, context: Context) {
  return apiHandler(request, async (session) => {
    const todo = todoDB.findById(await todoId(context), session!.userId);
    if (!todo) throw new ApiError(404, 'Todo not found');
    return NextResponse.json(todo);
  });
}

export async function PUT(request: NextRequest, context: Context) {
  return apiHandler(request, async (session) => {
    const id = await todoId(context);
    const existing = todoDB.findById(id, session!.userId);
    if (!existing) throw new ApiError(404, 'Todo not found');
    const body = await readJson(request);
    try {
      const input = todoUpdateSchema.parse(body);
      const todo = todoDB.update(id, session!.userId, input);
      return NextResponse.json(todo);
    } catch (error) {
      throw new ApiError(400, error instanceof Error && !('code' in error) ? error.message : 'Invalid todo input');
    }
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  return apiHandler(request, async (session) => {
    if (!todoDB.delete(await todoId(context), session!.userId)) throw new ApiError(404, 'Todo not found');
    return NextResponse.json({ success: true });
  });
}
