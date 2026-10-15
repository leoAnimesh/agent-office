import { describe, expect, it } from 'vitest';
import { projectStatus } from './sidebarStatus';

describe('projectStatus', () => {
  it('says what a running project is doing', () => {
    expect(projectStatus(undefined)).toEqual({ running: false, text: '', attention: false });
    expect(projectStatus({ id: 'a', working: 0, needsYou: 0 })).toEqual({ running: true, text: 'running', attention: false });
    expect(projectStatus({ id: 'a', working: 2, needsYou: 0 })).toEqual({ running: true, text: '2 working', attention: false });
    expect(projectStatus({ id: 'a', working: 1, needsYou: 1 })).toEqual({ running: true, text: 'needs you', attention: true });
  });
});
