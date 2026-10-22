import fs from 'fs'
import path from 'path'

export interface Logger {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export function redact(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) {
    if (s) out = out.split(s).join('[DISEMBUNYIKAN]')
  }
  return out
}

export function createLogger(logsDir: string, secrets: () => string[]): Logger {
  const write = (level: string, msg: string): void => {
    const now = new Date()
    const file = path.join(logsDir, `alfonso-${now.toISOString().slice(0, 10)}.log`)
    fs.appendFileSync(file, `${now.toISOString()} ${level} ${redact(msg, secrets())}\n`, 'utf8')
  }
  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m)
  }
}
