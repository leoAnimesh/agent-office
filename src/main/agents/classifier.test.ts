import { describe, expect, it } from 'vitest';
import { FALLBACK_MODEL, SIZE_MODEL, classifierPrompt, fallbackPick, launchModel, parseClassification } from './classifier';

describe('parseClassification', () => {
  it('reads clean JSON', () => {
    expect(parseClassification('{"size":"small","reason":"one-line copy change"}')).toEqual({ size: 'small', reason: 'one-line copy change' });
  });
  it('reads JSON inside a code fence or surrounded by prose', () => {
    expect(parseClassification('Here you go:\n```json\n{"size": "large", "reason": "new subsystem"}\n```')).toEqual({ size: 'large', reason: 'new subsystem' });
    expect(parseClassification('I think {"size":"medium","reason":"a few files"} fits.')).toEqual({ size: 'medium', reason: 'a few files' });
  });
  it('rejects unknown sizes, missing reasons and junk', () => {
    expect(parseClassification('{"size":"huge","reason":"x"}')).toBeNull();
    expect(parseClassification('{"size":"small"}')).toBeNull();
    expect(parseClassification('{"size":"small","reason":"   "}')).toBeNull();
    expect(parseClassification('echo: hello')).toBeNull();
    expect(parseClassification('{not json}')).toBeNull();
  });
  it('clips long reasons to 200 code points', () => {
    const r = parseClassification(JSON.stringify({ size: 'small', reason: '🙂'.repeat(300) }))!;
    expect(Array.from(r.reason)).toHaveLength(200);
  });
});

describe('model mapping', () => {
  it('maps sizes to models', () => {
    expect(SIZE_MODEL).toEqual({ small: 'haiku', medium: 'sonnet', large: 'opus' });
  });
  it('falls back to sonnet with the cause in the reason', () => {
    expect(fallbackPick('timed out')).toEqual({ model: FALLBACK_MODEL, reason: 'Classifier unavailable: timed out', source: 'fallback' });
  });
  it('never launches with auto', () => {
    expect(launchModel('auto', 'haiku')).toBe('haiku');
    expect(launchModel('auto')).toBe(FALLBACK_MODEL);
    expect(launchModel('opus')).toBe('opus');
    expect(launchModel('opus', 'haiku')).toBe('haiku');
  });
});

describe('classifierPrompt', () => {
  it('includes the task and asks for strict JSON', () => {
    const p = classifierPrompt({ title: 'Fix typo', brief: 'README says "teh"', roleName: 'Writer' });
    expect(p).toContain('Fix typo');
    expect(p).toContain('README says "teh"');
    expect(p).toContain('Writer');
    expect(p).toContain('{"size"');
  });
});
