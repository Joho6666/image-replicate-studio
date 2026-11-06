// 复刻换人: keep a real reference photo's background, light and pose, put the model in. Wording validated on client A in
// 2026-11-05 (grass, industrial cafe, manga room, qipao garden sets); the scene itself is not described, the model reads it
// from the last reference image.
export function buildReplicaPrompt({ outfitMode = 'keep', outfit = '', identity = '', hair = '', removeUi = true, keepExpression = false, extra = '' } = {}) {
  const parts = [
    'Edit the LAST reference image, a vertical photo of a woman. Keep the scene exactly: the background and every object in it, the light and shadows, the colour grade, the camera angle and framing, and her pose and position in the frame.',
    'Replace the woman with the person in the first reference photos, so it is clearly the same person: keep her exact face, eyes, nose, lips and any moles' + (identity.trim() ? ' (' + identity.trim().replace(/[.\s]+$/, '') + ')' : '') + (hair.trim() ? ', and ' + hair.trim().replace(/[.\s]+$/, '') : ', and the hair colour and length of the reference photos') + '. She is an adult. Her body proportions follow her own reference photos, not the original model, with a natural unexaggerated figure. ' + (keepExpression ? 'Keep the original expression.' : 'Relaxed, natural expression.'),
  ];
  parts.push(outfitMode === 'change' && outfit.trim()
    ? `Change her clothes: she wears ${outfit.trim().replace(/[.\s]+$/, '')}. Everything else in the scene stays the same.`
    : 'Keep her outfit exactly as in the last image: the same garments, colours, patterns and accessories, fitted naturally to her own body.');
  if (removeUi) parts.push('Remove every phone-screenshot overlay left on the last image: like, comment, star and share buttons and counts on the right edge, the round profile avatar, page counters, badges, the username, date and caption text. Fill those areas with plausible surroundings matching the scene. No text overlay, no icons, no watermark.');
  // free-form instructions from the workbench's prompt nodes
  if (extra.trim()) parts.push('Additional instructions: ' + extra.trim().replace(/\s+/g, ' '));
  parts.push('Photographic realism: an ordinary camera photo, natural uneven skin tone, mild grain, no beauty filter, not an illustration.');
  return parts.join(' ');
}
