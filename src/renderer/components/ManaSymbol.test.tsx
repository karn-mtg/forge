import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { scryfallToMsClass, manaSymbolClass, manaCostToHtml, ManaSymbol, ManaCost } from './ManaSymbol';

describe('scryfallToMsClass', () => {
  it('maps tap/untap/energy/snow shorthands', () => {
    expect(scryfallToMsClass('T')).toBe('tap');
    expect(scryfallToMsClass('Q')).toBe('untap');
    expect(scryfallToMsClass('E')).toBe('e');
    expect(scryfallToMsClass('S')).toBe('s');
  });

  it('strips slashes for hybrid/phyrexian symbols', () => {
    expect(scryfallToMsClass('W/U')).toBe('wu');
    expect(scryfallToMsClass('2/W')).toBe('2w');
  });

  it('lowercases plain symbols', () => {
    expect(scryfallToMsClass('W')).toBe('w');
    expect(scryfallToMsClass('3')).toBe('3');
  });
});

describe('manaSymbolClass', () => {
  it('includes the cost badge class by default', () => {
    expect(manaSymbolClass('W')).toBe('ms ms-w ms-cost');
  });

  it('omits cost badge and adds shadow when requested', () => {
    expect(manaSymbolClass('W', false, true)).toBe('ms ms-w ms-shadow');
  });
});

describe('ManaSymbol component', () => {
  it('renders an <i> with the correct class and aria-label', () => {
    const { container } = render(<ManaSymbol sym="W" />);
    const el = container.querySelector('i');
    expect(el).toHaveClass('ms', 'ms-w', 'ms-cost');
    expect(el).toHaveAttribute('aria-label', 'W');
  });

  it('applies inline font-size when size is given', () => {
    const { container } = render(<ManaSymbol sym="U" size="1.5em" />);
    expect(container.querySelector('i')).toHaveStyle({ fontSize: '1.5em' });
  });
});

describe('ManaCost component', () => {
  it('renders nothing when manaCost is empty', () => {
    const { container } = render(<ManaCost />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one icon per symbol in the cost string', () => {
    const { container } = render(<ManaCost manaCost="{3}{W}{U}" />);
    expect(container.querySelectorAll('i')).toHaveLength(3);
  });
});

describe('manaCostToHtml', () => {
  it('converts a mana cost string into inline <i> tags', () => {
    const html = manaCostToHtml('{2}{G}');
    expect(html).toContain('ms-2');
    expect(html).toContain('ms-g');
    expect(html).toContain('aria-label="2"');
    expect(html).toContain('aria-label="G"');
  });
});
