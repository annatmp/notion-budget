/**
 * Translation between Notion's property envelope and plain values.
 *
 * Notion represents every property as an object wrapped in a type tag
 * (`{ title: [...] }`, `{ select: { name } }`, …). Keeping that translation in
 * one place means the repositories read like the domain rather than like the
 * API.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Notion's payloads are
   only loosely typed at the edges; each reader narrows immediately. */

export type NotionProperty = Record<string, any>;

/** Plain text of a title property, or an empty string when it is unset. */
export function readTitle(properties: Record<string, NotionProperty>, name: string): string {
  const title = properties[name]?.title;
  if (!Array.isArray(title)) {
    return '';
  }
  return title
    .map((part: NotionProperty) => part?.plain_text ?? '')
    .join('')
    .trim();
}

/** The option name of a select property, or an empty string when it is unset. */
export function readSelect(properties: Record<string, NotionProperty>, name: string): string {
  const option = properties[name]?.select;
  return typeof option?.name === 'string' ? option.name : '';
}

/** Writes a title property. */
export function titleProperty(value: string): NotionProperty {
  return { title: [{ type: 'text', text: { content: value } }] };
}

/** Writes a number property. */
export function numberProperty(value: number): NotionProperty {
  return { number: value };
}

/** Writes a select property, matched literally against the budget's options. */
export function selectProperty(value: string): NotionProperty {
  return { select: { name: value } };
}

/** Writes a date property from an ISO `YYYY-MM-DD` string. */
export function dateProperty(isoDate: string): NotionProperty {
  return { date: { start: isoDate } };
}

/** Writes a relation property pointing at an existing row. */
export function relationProperty(id: string): NotionProperty {
  return { relation: [{ id }] };
}
