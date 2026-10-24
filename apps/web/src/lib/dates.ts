export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatLastSeen(value: string | Date | null, now = new Date()) {
  if (!value) return 'Offline'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return 'Offline'

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isSameDay(date, now)) return `Last seen today at ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return `Last seen yesterday at ${time}`

  const day = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
  return `Last seen ${day} at ${time}`
}

export function formatMessageDay(value: string | Date, now = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value
  if (isSameDay(date, now)) return 'Today'

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
