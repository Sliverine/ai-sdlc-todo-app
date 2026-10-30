export type Priority = 'high' | 'medium' | 'low'

export const PRIORITY_VALUES: Priority[] = ['high', 'medium', 'low']
export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export function validatePriority(value: unknown, operation: 'create' | 'update' = 'create'): Priority {
  if (operation === 'create' && (value === undefined || value === null)) return 'medium'
  if (typeof value === 'string' && PRIORITY_VALUES.includes(value as Priority)) return value as Priority
  throw new Error(`Invalid priority: ${String(value)}. Must be 'high', 'medium', or 'low'.`)
}