// Timezone-aware date/hour helpers shared by the cron tick and the pipeline.
// The cron's "already ran today" gate and the pipeline's last_run_date write
// MUST compute the calendar day in the SAME zone, or runs double-fire or skip a
// day near midnight UTC (issue #20).

// Calendar date (YYYY-MM-DD) for `date` as seen in IANA `tz`. Falls back to UTC
// date if the zone is invalid.
export function dateInTz(date: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return fmt.format(date) // en-CA yields ISO-style YYYY-MM-DD
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

// Hour (0-23) for `date` as seen in IANA `tz`. Falls back to UTC hour.
export function hourInTz(date: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
    return Number(fmt.format(date).replace(/[^0-9]/g, ''))
  } catch {
    return date.getUTCHours()
  }
}
