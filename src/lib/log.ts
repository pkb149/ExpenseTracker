export function makeLogger(level: string | undefined) {
  const debug = (level ?? 'error') === 'debug'
  return {
    debug: (...args: unknown[]) => { if (debug) console.log(...args) },
    error: (...args: unknown[]) => console.log(...args),
  }
}
