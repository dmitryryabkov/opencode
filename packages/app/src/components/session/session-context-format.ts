import { DateTime } from "luxon"

export function createSessionContextFormatter(locale: string) {
  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale) + "%"
    },
    time(value: number | undefined) {
      if (!value) return "—"
      return DateTime.fromMillis(value).setLocale(locale).toLocaleString(DateTime.DATETIME_MED)
    },
    duration(value: number | undefined) {
      if (value === undefined) return "—"
      const seconds = Math.round(value / 1000)
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const remaining = seconds % 60
      if (hours > 0) return `${hours}h ${minutes}m ${remaining}s`
      if (minutes > 0) return `${minutes}m ${remaining}s`
      return `${remaining}s`
    },
  }
}
