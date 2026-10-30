import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { todoDB, type TodoExport } from '@/lib/db'
import { formatSingaporeExportDate, serializeTodosToCsv, toTodoExportItem } from '@/lib/export-utils'
import { getSingaporeNow } from '@/lib/timezone'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const format = request.nextUrl.searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'Unsupported export format' }, { status: 400 })
  }

  try {
    const todos = todoDB.findAllByUser(session.userId)
    const exportedAt = getSingaporeNow()
    const date = formatSingaporeExportDate(exportedAt)
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="todos-${date}.${format}"`,
    }

    if (format === 'csv') {
      return new NextResponse(serializeTodosToCsv(todos), {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
      })
    }

    const payload: TodoExport = {
      version: 1,
      exported_at: exportedAt.toISOString(),
      todos: todos.map(toTodoExportItem),
    }
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    })
  } catch {
    return NextResponse.json({ error: 'Unable to export todos' }, { status: 500 })
  }
}
