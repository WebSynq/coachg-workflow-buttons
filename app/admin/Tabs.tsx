'use client'

interface Tab<K extends string> {
  key: K
  label: string
}

interface TabsProps<K extends string> {
  tabs: readonly Tab<K>[]
  active: K
  onSelect: (key: K) => void
}

export function Tabs<K extends string>({ tabs, active, onSelect }: TabsProps<K>) {
  return (
    <div role="tablist" className="flex border-b border-gray-200">
      {tabs.map(tab => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              isActive
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
