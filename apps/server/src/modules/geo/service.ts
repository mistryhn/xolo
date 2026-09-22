import type { Coordinates } from '@xolo/protocol'
// Fixed geographic cells near one kilometre wide; this avoids retaining raw coordinates.
export function zoneFor({ latitude, longitude }: Coordinates) {
  const lat = Math.floor((latitude + 90) * 111)
  const lng = Math.floor(
    (longitude + 180) * 111 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.2),
  )
  return `z${lat.toString(36)}-${lng.toString(36)}`
}
