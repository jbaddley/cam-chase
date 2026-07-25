/**
 * Minimal structured JSON logger (docs/02 observability). Emits one JSON object
 * per line to an injectable sink — CloudWatch Logs parses these into fields.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface LogRecord extends LogFields {
  level: LogLevel;
  msg: string;
  time: string;
}

export type LogSink = (record: LogRecord) => void;

export const consoleSink: LogSink = (record) => {
  console.log(JSON.stringify(record));
};

/** Discards records — used to keep test output clean. */
export const noopSink: LogSink = () => {};

export class Logger {
  constructor(
    private readonly sink: LogSink = consoleSink,
    private readonly base: LogFields = {},
    private readonly now: () => number = Date.now,
  ) {}

  /** Derive a logger that stamps every record with additional context. */
  child(fields: LogFields): Logger {
    return new Logger(this.sink, { ...this.base, ...fields }, this.now);
  }

  log(level: LogLevel, msg: string, fields?: LogFields): void {
    this.sink({ level, msg, time: new Date(this.now()).toISOString(), ...this.base, ...fields });
  }

  debug(msg: string, fields?: LogFields): void {
    this.log('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.log('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.log('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.log('error', msg, fields);
  }
}
