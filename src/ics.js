const CRLF = '\r\n'

export function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

export function foldLine(line) {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const decoder = new TextDecoder()
  const chunks = []
  let offset = 0
  let limit = 75

  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length)
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1
    }
    chunks.push(decoder.decode(bytes.slice(offset, end)))
    offset = end
    limit = 74
  }

  return chunks
    .map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`))
    .join(CRLF)
}

function formatTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.toISOString().split('.')[0].replace(/[-:]/g, '')}Z`
}

function eventLines(event) {
  const dtstamp = formatTimestamp(event.dtstamp ?? event.start)
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${dtstamp}`,
    `LAST-MODIFIED:${dtstamp}`
  ]

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${event.startDate}`)
    lines.push(`DTEND;VALUE=DATE:${event.endDate}`)
  } else {
    lines.push(`DTSTART:${formatTimestamp(event.start)}`)
    lines.push(`DTEND:${formatTimestamp(event.end)}`)
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`)
  if (event.categories?.length) {
    lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`)
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  }
  if (event.url) {
    lines.push(`URL:${event.url}`)
  }
  lines.push('TRANSP:TRANSPARENT')
  lines.push('END:VEVENT')
  return lines
}

export function serializeCalendar(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//janejeon//codex-resets-calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'NAME:Codex Resets',
    'X-WR-CALNAME:Codex Resets',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ]

  for (const event of events) {
    lines.push(...eventLines(event))
  }

  lines.push('END:VCALENDAR')

  return `${lines.map(foldLine).join(CRLF)}${CRLF}`
}
