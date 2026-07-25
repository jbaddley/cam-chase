import { describe, expect, it } from 'vitest';
import { Logger, type LogRecord } from './logger.js';

function capturing() {
  const records: LogRecord[] = [];
  return { records, sink: (r: LogRecord) => records.push(r) };
}

describe('Logger', () => {
  it('emits level, message, ISO time and fields', () => {
    const { records, sink } = capturing();
    const log = new Logger(sink, {}, () => 0);
    log.info('hello', { a: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({ level: 'info', msg: 'hello', time: '1970-01-01T00:00:00.000Z', a: 1 });
  });

  it('supports all levels', () => {
    const { records, sink } = capturing();
    const log = new Logger(sink);
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(records.map((r) => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('merges base and child fields, child overriding base', () => {
    const { records, sink } = capturing();
    const log = new Logger(sink, { service: 'api', env: 'dev' }, () => 0);
    log.child({ requestId: 'r1', env: 'prod' }).info('scoped', { extra: true });
    expect(records[0]).toMatchObject({ service: 'api', env: 'prod', requestId: 'r1', extra: true, msg: 'scoped' });
  });

  it('per-call fields override base/child fields', () => {
    const { records, sink } = capturing();
    const log = new Logger(sink, { a: 'base' }).child({ a: 'child' });
    log.info('m', { a: 'call' });
    expect(records[0]!.a).toBe('call');
  });
});
