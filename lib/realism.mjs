// Realism prompt packs appended to a generation prompt.
//  v1 = the pack validated on 2026-11-04/05 (iPhone Photo mode, Smart HDR flat tones, noise, amateur framing, uneven skin).
//  v2 = v1 + ideas from public "remove the plastic-AI look" tutorials (Douyin 2026-11, LightNING / 啊布): asymmetry, uneven
//       motivated light with environment colour bounce, wear on clothes and props, hand anatomy, off-centre framing.
//       Deliberately does NOT ask for pores, freckles or redness: those gave blotchy skin in our own tests (see prompt.mjs).
export const REALISM = {
  off: { label: '不加', text: '' },
  v1: {
    label: '写实包 v1（已验证）',
    text: 'Camera realism: shot on an iPhone in the default Camera app, Photo mode, so the background stays mostly in focus; Smart HDR processing with slightly flat tones; focus a little soft; mild sensor noise; imperfect amateur framing; ordinary background clutter. Her skin shows natural uneven tone and subtle visible texture; light makeup. Not retouched, not cinematic, not a professional portrait.',
  },
  v2: {
    label: '写实包 v2（实验：不对称、光影、旧感）',
    text: [
      'Camera realism: shot on an iPhone in the default Camera app, Photo mode, so the background stays mostly in focus; Smart HDR processing with slightly flat tones; focus a little soft, slightly soft edges on fine hair; mild sensor noise; not retouched, not cinematic, not a professional portrait.',
      'Real person, not a rendered model: slightly asymmetrical face (one eyebrow a little higher, mouth corners not perfectly level), natural uneven skin tone with a matte finish and only a faint shine on the forehead and nose, light makeup, a few flyaway strands and fine baby hairs at the hairline, relaxed unposed expression with slightly lowered eyelids.',
      'Light is uneven and motivated by the scene: one side of the face a little brighter than the other, soft shadow in the eye sockets and under the nose and jaw, and a subtle colour bounce from the surroundings on her skin (greenish near plants, cool near white walls, warm near evening light). Never evenly lit, no glowing skin.',
      'Clothes and props look lived-in: natural creases and pressure folds that follow her body, slightly uneven hems, small wear on bags and accessories. Anatomically correct hands with five fingers, visible knuckles and slightly different finger lengths. Her weight sits on one side, shoulders not perfectly level, nothing perfectly symmetrical.',
      'Framing is casual and slightly off-centre, a little cropping at the edges is fine, ordinary background clutter, passers-by or objects softly out of focus.',
    ].join(' '),
  },
};

export const withRealism = (prompt, key) => {
  const r = REALISM[key];
  return r && r.text ? `${prompt} ${r.text}` : prompt;
};
