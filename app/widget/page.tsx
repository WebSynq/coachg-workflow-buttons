import { Widget } from './Widget'

export default async function WidgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const contactId = typeof sp.contactId === 'string' ? sp.contactId : ''
  const contactName = typeof sp.contactName === 'string' ? sp.contactName : ''
  return (
    <main className="p-4">
      <Widget contactId={contactId} contactName={contactName} />
    </main>
  )
}
