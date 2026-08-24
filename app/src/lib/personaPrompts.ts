// X2 character-replacement prompts aligned with docs.reactor.inc X2 prompt guide.
// Use the stable Chinese capability prefix; the source supplies scene/background.

/** Stable prefix for character-only replacement (not style transfer). */
export const PERSONA_CAPABILITY_PREFIX = '视频中角色替换成参考图中角色';

/**
 * Official XMAX X2 character-replacement line (prompt guide).
 * One target, one change, one preservation boundary — no extra people.
 */
export const PERSONA_PRESERVATION_LINE =
  '将画面中央人物替换为参考图角色。保留原人物的表情、视线、姿势和动作；背景和镜头保持不变。';

/** Full default prompt for a persona (reference image = persona appearance). */
export function defaultPersonaPrompt(): string {
  return `${PERSONA_CAPABILITY_PREFIX}\n${PERSONA_PRESERVATION_LINE}`;
}

/** Lucy 2.5 default — identity is the reference image; keep motion from the camera. */
export const MORPHLY_PERSONA_PROMPT =
  'Full body swap. Replace the person with the one in the reference image. Keep natural movements and expressions.';

export function defaultMorphlyPrompt(): string {
  return MORPHLY_PERSONA_PROMPT;
}

export function promptForProvider(prompt: string, kind: 'fast' | 'pro', name?: string): string {
  void name;
  const trimmed = prompt.trim();
  if (kind === 'pro') {
    if (!trimmed || trimmed.includes(PERSONA_CAPABILITY_PREFIX)) {
      return defaultMorphlyPrompt();
    }
    return trimmed;
  }
  if (!trimmed || trimmed.includes(PERSONA_CAPABILITY_PREFIX)) {
    return defaultPersonaPrompt();
  }
  return trimmed;
}
