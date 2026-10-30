import { z } from 'zod'
import { filterStateSchema } from './filters'

const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  filters: filterStateSchema,
  createdAt: z.iso.datetime(),
})

export type FilterPreset = z.infer<typeof presetSchema>
export const PRESETS_KEY = 'todo-app:filter-presets'

function readPresets(): FilterPreset[] {
  const raw = localStorage.getItem(PRESETS_KEY)
  if (!raw) return []
  try {
    return z.array(presetSchema).parse(JSON.parse(raw))
  } catch (error) {
    console.error('Failed to parse filter presets:', error)
    return []
  }
}

export function loadPresets(): FilterPreset[] {
  try {
    return readPresets()
  } catch (error) {
    console.error('Failed to load filter presets:', error)
    return []
  }
}

function updatePresets(update: (current: FilterPreset[]) => FilterPreset[]): FilterPreset[] {
  try {
    const presets = update(readPresets())
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
    return presets
  } catch (error) {
    console.error('Failed to update filter presets:', error)
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Could not update preset - storage full.')
    }
    throw new Error('Could not update preset - browser storage is unavailable.')
  }
}

export function savePreset(preset: FilterPreset): FilterPreset[] {
  const validated = presetSchema.parse(preset)
  return updatePresets((current) => [...current, validated])
}

export function deletePreset(id: string): FilterPreset[] {
  return updatePresets((current) => current.filter((preset) => preset.id !== id))
}
