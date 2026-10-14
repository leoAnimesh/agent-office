import { describe, expect, it } from 'vitest';
import { describeToolCall } from './describe';

describe('describeToolCall', () => {
  it('summarises the boss tools in plain words', () => {
    expect(describeToolCall('assign_task', { agent: 'Pixel', title: 'Build toggle', brief: 'x' })).toBe('Pixel: Build toggle');
    expect(describeToolCall('hire', { role_id: 'qa', name: 'Quinn' })).toBe('qa as Quinn');
    expect(describeToolCall('hire', { role_id: 'qa' })).toBe('qa');
    expect(describeToolCall('request_merge', { task_id: 'T-101' })).toBe('T-101');
    expect(describeToolCall('message_agent', { agent: 'Pixel', text: 'a'.repeat(200) })).toMatch(/^Pixel: a{60}…$/);
    expect(describeToolCall('list_team', {})).toBe('');
    expect(describeToolCall('mystery', { a: 1 })).toBe('{"a":1}');
  });
});
