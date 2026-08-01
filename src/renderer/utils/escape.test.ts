import { describe, it, expect } from 'vitest';
import { esc } from './escape';

describe('esc', () => {
  it('escapes all five HTML-sensitive characters', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves safe text unchanged', () => {
    expect(esc('Lightning Bolt')).toBe('Lightning Bolt');
  });

  it('coerces non-string input', () => {
    expect(esc(42 as unknown as string)).toBe('42');
  });
});
