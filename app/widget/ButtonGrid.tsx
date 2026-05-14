'use client'
import type { Button } from './types'

interface ButtonGridProps {
  buttons: Button[]
  onClick: (button: Button) => void
}

export function ButtonGrid({ buttons, onClick }: ButtonGridProps) {
  if (buttons.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4">
        No buttons configured. Ask an admin to add one in the configuration page.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {buttons.map(button => (
        <button
          key={button.id}
          type="button"
          onClick={() => onClick(button)}
          // Hex colors can't be Tailwind classes — inline style is the
          // simplest route to per-button colors at admin-configurable hex.
          style={{ backgroundColor: button.color }}
          className="rounded-md px-3 py-2 text-white text-sm font-medium shadow-sm transition-opacity hover:opacity-90"
        >
          {button.label}
        </button>
      ))}
    </div>
  )
}
