'use client'

// Tailwind utility presets that map cleanly to the admin UI's brand-ish
// palette. Tens are deliberate — the spec says "10 presets + hex fallback".
// The fallback below lets admins pick anything outside this set.
export const COLOR_PRESETS = [
  '#EF4444', // red
  '#F97316', // orange
  '#F59E0B', // amber
  '#EAB308', // yellow
  '#22C55E', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#6366F1', // indigo
  '#A855F7', // purple
  '#6B7280', // gray
]

interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const normalized = value.toUpperCase()
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Color presets"
        className="flex flex-wrap gap-2 mb-2"
      >
        {COLOR_PRESETS.map(hex => {
          const checked = normalized === hex.toUpperCase()
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-label={`Select ${hex}`}
              aria-checked={checked}
              onClick={() => onChange(hex)}
              style={{ backgroundColor: hex }}
              className={
                'h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ' +
                (checked ? 'border-gray-900' : 'border-transparent')
              }
            />
          )
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        Hex
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          aria-label="Hex color"
          placeholder="#000000"
          maxLength={7}
          className="rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs uppercase text-gray-900"
        />
      </label>
    </div>
  )
}
