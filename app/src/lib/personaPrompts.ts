// Character replacement prompts preserve the source performance and scene.

/** Legacy default marker used to migrate existing saved personas. */
export const PERSONA_CAPABILITY_PREFIX = '视频中角色替换成参考图中角色';

/** Shared character-replacement prompt for every realtime provider. */
export const PERSONA_PRESERVATION_LINE =
  "Replace the character in the video with the character in the reference image. Completely replace the main person with the reference character; preserve the original person's facial expression, gaze direction, natural eye contact, pose, motion, and gestures with no eye bulging or distortion and eyes proportionate; keep the background static with consistent lighting, no light overlays, no flicker, and camera movement unchanged.";

/** Full default prompt for a persona (reference image = persona appearance). */
export function defaultPersonaPrompt(): string {
  return PERSONA_PRESERVATION_LINE;
}

/** Lucy 2.5 uses the same replacement boundary as Reactor X2. */
export const MORPHLY_PERSONA_PROMPT = PERSONA_PRESERVATION_LINE;

export function defaultMorphlyPrompt(): string {
  return MORPHLY_PERSONA_PROMPT;
}

export const PRO_QUALITY_SUFFIX =
  ' Keep the same person from the reference image (same face and identity, face swap), with natural movements and expressions, natural eye contact without bulging, high detail, sharp focus, stable background and consistent lighting without overlays.';

export function promptForProvider(prompt: string, kind: 'fast' | 'pro', name?: string): string {
  void name;
  const trimmed = prompt.trim();
  if (kind === 'pro') {
    if (!trimmed || trimmed.includes(PERSONA_CAPABILITY_PREFIX)) {
      return `${PERSONA_PRESERVATION_LINE}${PRO_QUALITY_SUFFIX}`;
    }
    // Force quality: ensure identity is preserved even if user prompt is short
    if (!trimmed.includes('reference image')) {
      return `${trimmed}${PRO_QUALITY_SUFFIX}`;
    }
    return trimmed;
  }
  if (!trimmed || trimmed.includes(PERSONA_CAPABILITY_PREFIX)) {
    return defaultPersonaPrompt();
  }
  return trimmed;
}
