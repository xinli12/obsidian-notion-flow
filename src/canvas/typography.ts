/** Display-only hierarchy; scales follow Obsidian's configured note font size. */
export interface TopicTypography {
  scale: number;
  weight: number;
  leading: number;
}

const TOPIC_SCALES = [1.5, 1.25, 1.0625, 1, 0.9375] as const;
const TOPIC_WEIGHTS = [700, 600, 500, 400, 400] as const;
const NOTE_SCALES = [1.25, 1.125, 1.0625, 1, 0.9375] as const;
const TYPOGRAPHY_PROPERTIES = ['--nf-size', '--nf-weight', '--nf-leading'] as const;

/**
 * Roots and main branches carry more visual weight. Deep branches stop at
 * 15/16 of the note font so nested ideas remain readable. Rich notes retain a
 * lighter body weight; Markdown headings and emphasis remain their own styles.
 * Missing or invalid depths use ordinary body text rather than root styling.
 */
export function topicTypography(depth?: number, rich = false): TopicTypography {
  const level = depth !== undefined && Number.isInteger(depth) && depth >= 0
    ? Math.min(depth, TOPIC_SCALES.length - 1) : 3;
  return {
    scale: rich ? NOTE_SCALES[level] : TOPIC_SCALES[level],
    weight: rich ? (level === 0 ? 500 : 400) : TOPIC_WEIGHTS[level],
    leading: rich ? 1.6 : 1.5,
  };
}

/** Set only presentation variables, without rewriting card data or Markdown. */
export function applyTopicTypography(element: Pick<HTMLElement, 'style'>, depth?: number, rich = false): boolean {
  const { scale, weight, leading } = topicTypography(depth, rich);
  const values = [scale, weight, leading];
  let changed = false;
  TYPOGRAPHY_PROPERTIES.forEach((property, index) => {
    const value = String(values[index]);
    if (element.style.getPropertyValue(property) === value) return;
    element.style.setProperty(property, value);
    changed = true;
  });
  return changed;
}

/** Remove our variables when a card leaves the map or enhancements turn off. */
export function clearTopicTypography(element: Pick<HTMLElement, 'style'>): boolean {
  let changed = false;
  for (const property of TYPOGRAPHY_PROPERTIES) {
    if (!element.style.getPropertyValue(property)) continue;
    element.style.removeProperty(property);
    changed = true;
  }
  return changed;
}
