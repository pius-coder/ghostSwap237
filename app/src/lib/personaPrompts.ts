// Character replacement prompts preserve the source performance and scene.

/** Legacy default marker used to migrate existing saved personas. */
export const PERSONA_CAPABILITY_PREFIX = '视频中角色替换成参考图中角色';

/** Shared character-replacement prompt for every realtime provider. */
export const PERSONA_PRESERVATION_LINE =
  "Completely replace the main character in the video with the character from the reference image. Match the reference character's identity and appearance as closely and consistently as possible in every frame: facial structure and features, eyes, nose, mouth, jawline, head shape, skin tone, hairstyle and hair color, age, body shape, height, proportions, physique and weight, clothing, accessories, and distinctive details. Do not blend with or retain the source person's face, body, hair, clothing, or identity. Preserve only the original video's facial expression, gaze direction, pose, motion, gestures, timing, framing, background, lighting, and camera movement. Keep the replacement coherent, natural, and stable across the full body, profile views, occlusions, and motion.";

/** Full default prompt for a persona (reference image = persona appearance). */
export function defaultPersonaPrompt(): string {
  return PERSONA_PRESERVATION_LINE;
}

/** Lucy 2.5 uses the same replacement boundary as Reactor X2. */
export const MORPHLY_PERSONA_PROMPT = PERSONA_PRESERVATION_LINE;

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
