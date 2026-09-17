import { describe, expect, it } from 'vitest';

import { buildImageMessage, buildSystemPrefix, buildTextMessage } from './prompt';

const lines = [
  { id: 'line-b', name: 'Food Sydney', category: 'Food' },
  { id: 'line-a', name: "Coffee's and snacks", category: 'Food' },
];

const input = {
  categories: ['Accomodation', 'Food', 'Activity'],
  currencies: ['EURO', 'AUD'],
  defaultCurrency: 'AUD',
  budgetLines: lines,
  today: '2026-09-17',
  timezone: 'Australia/Melbourne',
};

describe('the cacheable system prefix', () => {
  it('is byte-identical across two calls with an unchanged budget', () => {
    // The prefix only earns a cache hit if it repeats exactly, so any incidental
    // variation — ordering, whitespace, a timestamp — costs real money.
    expect(buildSystemPrefix(input)).toBe(buildSystemPrefix(input));
  });

  it('is byte-identical across two reads that arrive in a different order', () => {
    const second = buildSystemPrefix({ ...input, budgetLines: [...lines].reverse() });

    expect(second).toBe(buildSystemPrefix(input));
  });

  it('changes when a line is added', () => {
    const grown = buildSystemPrefix({
      ...input,
      budgetLines: [...lines, { id: 'line-c', name: 'Scuba', category: 'Activity' }],
    });

    expect(grown).not.toBe(buildSystemPrefix(input));
  });

  it('changes when a line is renamed', () => {
    // Budget lines are re-read on every capture precisely so that a rename is
    // visible on the next one.
    const renamed = buildSystemPrefix({
      ...input,
      budgetLines: [
        { id: 'line-b', name: 'Food Sydney CBD', category: 'Food' },
        { id: 'line-a', name: "Coffee's and snacks", category: 'Food' },
      ],
    });

    expect(renamed).not.toBe(buildSystemPrefix(input));
  });

  it('carries the budget line list in a stable order', () => {
    const prefix = buildSystemPrefix(input);
    const a = prefix.indexOf('line-a');
    const b = prefix.indexOf('line-b');

    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });

  it('carries every category the budget allows', () => {
    const prefix = buildSystemPrefix(input);

    for (const category of input.categories) {
      expect(prefix).toContain(category);
    }
  });

  it('carries the currencies and the default', () => {
    const prefix = buildSystemPrefix(input);

    expect(prefix).toContain('EURO, AUD');
    expect(prefix).toContain('AUD');
  });

  it('carries the current local date and the zone it belongs to', () => {
    const prefix = buildSystemPrefix(input);

    expect(prefix).toContain('2026-09-17');
    expect(prefix).toContain('Australia/Melbourne');
  });

  it('says so explicitly when the budget has no lines', () => {
    // Silence would read as "no constraint" rather than "nothing to match".
    const prefix = buildSystemPrefix({ ...input, budgetLines: [] });

    expect(prefix).toContain('no lines yet');
  });

  it('instructs the model to use the total, not a subtotal', () => {
    const prefix = buildSystemPrefix(input);

    expect(prefix).toMatch(/total/i);
    expect(prefix).toMatch(/subtotal/i);
  });

  it('instructs the model never to invent a category', () => {
    expect(buildSystemPrefix(input)).toContain('Never invent a category');
  });
});

describe('the user message', () => {
  it('passes the typed text through', () => {
    expect(buildTextMessage('coffee 8 bucks')).toContain('coffee 8 bucks');
  });

  it('carries the image as a data URL, never a public URL', () => {
    const message = buildImageMessage('data:image/jpeg;base64,AAAA');

    expect(message).toContain('data:image/jpeg;base64,AAAA');
    expect(message).not.toContain('http');
  });

  it('includes a caption when there is one, and omits it otherwise', () => {
    expect(buildImageMessage('data:image/jpeg;base64,AAAA', 'split with Sam')).toContain(
      'split with Sam',
    );
    expect(buildImageMessage('data:image/jpeg;base64,AAAA', '   ')).not.toContain('user added');
  });
});
