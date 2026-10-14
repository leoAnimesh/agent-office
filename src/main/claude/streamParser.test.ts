import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LineSplitter, parseLine } from './streamParser';

const fixture = readFileSync(path.resolve('test/fixtures/stream/read-file.jsonl'), 'utf8');

describe('LineSplitter', () => {
  it('reassembles lines split across chunks, including CRLF split between chunks', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\r')).toEqual([]);
    expect(s.push('\n{"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.push('{"c":3}')).toEqual([]);
    expect(s.flush()).toEqual(['{"c":3}']);
    expect(s.flush()).toEqual([]);
  });
});

describe('parseLine', () => {
  it('turns the real fixture into the expected event sequence', () => {
    const events = fixture.split('\n').filter(Boolean).flatMap(parseLine);
    expect(events.map((e) => e.type)).toEqual(['init', 'thinking', 'tool_use', 'tool_result', 'text', 'result']);
    expect(events[0]).toEqual({ type: 'init', sessionId: 'sess-fixture-1', model: 'claude-haiku-5-5' });
    expect(events[2]).toMatchObject({ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/a.txt' } });
    expect(events[3]).toMatchObject({ type: 'tool_result', toolUseId: 'toolu_1', isError: false, preview: '1\thello\n2\t' });
    expect(events[5]).toEqual({ type: 'result', ok: true, text: 'DONE', sessionId: 'sess-fixture-1', costUsd: 0.0057, durationMs: 5587, numTurns: 2 });
  });

  it('never throws on junk and reports it as raw', () => {
    expect(parseLine('not json at all')).toEqual([{ type: 'raw', text: 'not json at all' }]);
    expect(parseLine('{"type":"brand_new_event"}')).toEqual([]);
    expect(parseLine('{"type":"assistant"}')).toEqual([]);
    expect(parseLine('null')).toEqual([]);
  });

  it('marks error results as not ok and falls back to the subtype for text', () => {
    expect(parseLine('{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"s"}')[0]).toMatchObject({ type: 'result', ok: false, text: 'error_max_turns' });
  });

  it('reads tool_result content given as an array of text blocks', () => {
    const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'oops' }] }] } });
    expect(parseLine(line)).toEqual([{ type: 'tool_result', toolUseId: 't', isError: true, preview: 'oops' }]);
  });
});
