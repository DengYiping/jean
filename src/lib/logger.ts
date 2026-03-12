/**
 * Environment-aware logging utility
 * - debug/info: only log in development
 * - warn/error: always log (even in production)
 */

type LogArgs = unknown[]

interface Logger {
  debug: (...args: LogArgs) => void
  info: (...args: LogArgs) => void
  warn: (...args: LogArgs) => void
  error: (...args: LogArgs) => void
  tag: (name: string) => Logger
}

const isDev = import.meta.env.DEV
const noop = (() => {}) as (...args: LogArgs) => void // eslint-disable-line @typescript-eslint/no-empty-function

function createLogger(tagName?: string): Logger {
  const prefix = tagName ? `[${tagName}]` : ''

  const formatArgs = (level: string, args: LogArgs): LogArgs => {
    const levelTag = `[${level}]`
    return prefix ? [levelTag, prefix, ...args] : [levelTag, ...args]
  }

  return {
    debug: isDev
      ? (...args: LogArgs) => {
          console.debug(...formatArgs('DEBUG', args))
        }
      : noop,

    info: isDev
      ? (...args: LogArgs) => {
          console.info(...formatArgs('INFO', args))
        }
      : noop,

    warn: (...args: LogArgs) => {
      console.warn(...formatArgs('WARN', args))
    },

    error: (...args: LogArgs) => {
      console.error(...formatArgs('ERROR', args))
    },

    tag: (name: string) => {
      const newTag = prefix ? `${tagName}:${name}` : name
      return createLogger(newTag)
    },
  }
}

export const logger = createLogger()
export { createLogger }
export type { Logger }
