/**
 * Accepts only a literal colour: the hex the dashboard's picker writes, or the
 * rgba() it writes once the alpha slider moves off full. Anything else —
 * names, functions, a stray `;` — is refused, because these values land in a
 * style attribute and in the settings document the editor writes back.
 */
export function safeColor(value: unknown): string | undefined {
  const color = typeof value === 'string' ? value.trim() : '';

  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
    return color;
  }

  return /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(
    color,
  )
    ? color
    : undefined;
}

/**
 * Whether a colour is light enough that the browser should draw its native
 * controls — scrollbars, select menus, form fields — the light way.
 *
 * Only the two literal shapes `safeColor` accepts get an answer; anything else
 * is `undefined`, and the caller keeps the app's dark default rather than
 * guessing.
 *
 * The threshold is 0.179 relative luminance — where black text overtakes white
 * for contrast, which is the same question the browser is asking when it picks
 * a scrollbar. It sits well below the midpoint of the hex range: #808080 is a
 * light background by this test, and correctly so.
 */
export function isLightColor(value: unknown): boolean | undefined {
  const color = safeColor(value);

  if (!color) {
    return undefined;
  }

  const rgb = color.startsWith('#') ? fromHex(color) : fromRgb(color);

  if (!rgb) {
    return undefined;
  }

  // WCAG relative luminance: sRGB channels, gamma-expanded, weighted for the
  // eye's response.
  const [r, g, b] = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179;
}

function fromHex(color: string): [number, number, number] | undefined {
  const hex = color.slice(1);
  // #rgb and #rgba carry one digit per channel; #rrggbb and #rrggbbaa carry
  // two. Alpha is ignored either way — it is the paint underneath that decides.
  const size = hex.length <= 4 ? 1 : 2;
  const channels = [0, 1, 2].map((i) => {
    const digits = hex.slice(i * size, i * size + size);
    return parseInt(size === 1 ? digits + digits : digits, 16);
  });

  return channels.every((c) => Number.isFinite(c))
    ? (channels as [number, number, number])
    : undefined;
}

function fromRgb(color: string): [number, number, number] | undefined {
  const parts = color
    .slice(color.indexOf('(') + 1, color.lastIndexOf(')'))
    .split(',')
    .slice(0, 3)
    .map((part) => Number(part.trim()));

  return parts.length === 3 && parts.every((c) => Number.isFinite(c))
    ? (parts as [number, number, number])
    : undefined;
}
