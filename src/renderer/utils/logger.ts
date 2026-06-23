const IS_DEV = import.meta.env.DEV;

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// Only debug/info filtered in production; warn + error always shown
const MIN: Level = IS_DEV ? 'debug' : 'warn';

// [tag style, message style] pairs
const STYLES: Record<Level, [string, string]> = {
  debug: ['color:#6b7280;font-size:11px',       'color:#6b7280'],
  info:  ['color:#38bdf8;font-weight:600',       'color:#cbd5e1'],
  warn:  ['color:#f2ca83;font-weight:600',       'color:#f2ca83'],
  error: ['color:#f87171;font-weight:700',       'color:#f87171'],
};

function log(level: Level, module: string, message: string, data?: unknown) {
  if (ORDER[level] < ORDER[MIN]) return;

  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const tag = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}]`;
  const [tagStyle, msgStyle] = STYLES[level];

  const fn = level === 'error' ? console.error
    : level === 'warn'         ? console.warn
    : console.log;

  if (data !== undefined) {
    fn(`%c${tag}%c ${message}`, tagStyle, msgStyle, data);
  } else {
    fn(`%c${tag}%c ${message}`, tagStyle, msgStyle);
  }
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: unknown) => log('debug', module, msg, data),
    info:  (msg: string, data?: unknown) => log('info',  module, msg, data),
    warn:  (msg: string, data?: unknown) => log('warn',  module, msg, data),
    error: (msg: string, data?: unknown) => log('error', module, msg, data),
  };
}

export type AppLogger = ReturnType<typeof createLogger>;
