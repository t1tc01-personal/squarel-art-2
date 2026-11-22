/**
 * Prompt templates. General-purpose models are asked for a flat magenta background:
 * it works as a chroma key for normalize()'s background removal, unlike white which
 * collides with white highlights in the sprite.
 */
export function generalPrompt(
  subject: string,
  o: { width: number; height: number; palette?: string[] },
): string {
  const pal = o.palette?.length
    ? `, limited palette of ${o.palette.length} colors`
    : ', limited color palette'
  return [
    `pixel art sprite of ${subject.trim()}`,
    `${o.width}x${o.height} pixel grid, large crisp square pixels, hard edges, no anti-aliasing, no gradients${pal}`,
    'single centered subject, full body visible, flat solid magenta (#ff00ff) background, no text, no border, no shadow on background',
  ].join(', ')
}

export function editPrompt(instruction: string): string {
  return `pixel art, ${instruction.trim()}, keep the same pixel art style, crisp square pixels, flat solid magenta (#ff00ff) background`
}

export function nativePixelPrompt(subject: string): string {
  return subject.trim()
}
