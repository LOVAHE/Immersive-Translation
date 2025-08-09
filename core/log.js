// core/log.js

function normalize(arg) {
  if (arg instanceof Error) return { name: arg.name, message: arg.message, stack: arg.stack };
  if (typeof arg === 'object' && arg) {
    try { return JSON.parse(JSON.stringify(arg)); } catch { return String(arg); }
  }
  return arg;
}
export function createLogger(scope = 'app') {
  const tag = `[IT][${scope}]`;
  const out = (level, ...args) => {
    const xs = args.map(normalize);
    const fn = level === 'error' ? console.error
            : level === 'warn'  ? console.warn
            : level === 'debug' ? console.debug
            : console.log;
    fn(tag, ...xs);
  };
  return {
    debug: (...a) => out('debug', ...a),
    info:  (...a) => out('info',  ...a),
    warn:  (...a) => out('warn',  ...a),
    error: (...a) => out('error', ...a)
  };
}
