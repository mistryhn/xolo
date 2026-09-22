import { create } from 'zustand'
export const useZoneStore = create<{ zoneKey: string | null; setZone: (zoneKey: string) => void }>(
  (set) => ({ zoneKey: null, setZone: (zoneKey) => set({ zoneKey }) }),
)
