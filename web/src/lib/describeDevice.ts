/** A short "Safari on iPhone"-style summary of a user agent. */
export function describeDevice(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const device =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : null
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null
  if (!device && !browser) return ua.slice(0, 60)
  return [browser, device].filter(Boolean).join(' on ')
}
