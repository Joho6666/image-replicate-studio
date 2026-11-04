// Prompt recipe validated on 2026-11-01 against the 普渡众神花 EP9/EP10 Korean street/selfie case.
// Keep the wording: each phrase fixed a specific failure (idol face, freckle spots, logos, flash whitening).

export const DEFAULT_FACE = 'An adult Korean woman in her twenties with a distinctive, real-looking face rather than an idol or doll-like face, natural-sized eyes and a fuller face shape: wide-set almond eyes with soft inner double eyelids, low nose bridge with a rounded tip, full slightly pouty lips, one tiny mole on her left cheek, otherwise clear skin. Rosy-pink blush across both cheeks and over the bridge of her nose, glossy lips, otherwise bare dewy skin.';

export const SHOTS = {
  selfie: { label: '前置自拍', text: 'front-camera selfie from a modern iPhone, standard photo mode, phone held slightly above and close to her face so the slight wide-angle front-lens perspective makes her face fill much of the frame, casual off-centre framing, her selfie arm enters the foreground, no camera visible in frame' },
  friend: { label: '朋友后置帮拍', text: 'candid snapshot taken by a friend standing close, modern iPhone rear 1x main camera, standard photo mode' },
  mirror: { label: '对镜自拍', text: 'mirror selfie: she photographs her reflection in a mirror with a modern iPhone rear camera held at chest height so her whole face stays visible' },
  ccd: { label: 'CCD 小数码', text: 'snapshot in early Canon IXUS compact CCD camera style taken by a friend, gentle CCD colour with slightly lifted blacks, mild compact-camera softness and fine digital noise' },
};

export const FLASH = {
  off: { label: '不开闪', text: 'flash off, natural ambient light only' },
  gentle: { label: '轻闪补光', text: 'built-in flash as a subtle daytime fill: a crisp catchlight in her eyes and a slight sheen on her cheeks without whitening her face, the background keeps normal daylight brightness' },
  direct: { label: '直闪', text: 'bright direct on-camera flash with crisp highlights on skin and clothes and a slightly darker background' },
};

export const FRAMING = {
  close: { label: '近景（脸+肩）', text: 'close-up' },
  half: { label: '半身', text: 'half-body' },
  full: { label: '全身', text: 'full-body, both shoes in frame' },
};

export const TAIL = 'Natural phone colours with a slightly muted warm cast, realistic skin texture, no beauty filter, no retouching, slight phone noise in the shadows. Everyday Instagram photo, not a professional shoot, no text, no watermark, no brand logos.';

const sentence = s => {
  const t = String(s || '').trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : t + '.';
};

// fields: aspect, framing, shot, flash, face, hair, expression, outfit, action, scene, light, extra
export function buildPrompt(f = {}) {
  const shot = SHOTS[f.shot] || SHOTS.friend;
  const flash = FLASH[f.flash] || FLASH.off;
  const framing = FRAMING[f.framing]?.text;
  const head = `Vertical ${f.aspect || '3:4'} ${framing ? framing + ' ' : ''}${shot.text}, ${flash.text}.`;
  return [head, f.face?.trim() ? f.face : DEFAULT_FACE, f.hair, f.expression, f.outfit, f.action, f.scene, f.light, f.extra, TAIL]
    .map(sentence).filter(Boolean).join(' ');
}

// Instructions prepended when reference images are attached. Reference order: face (if any) first, then moodboard.
export function referencePreamble({ hasFace = false, moodboard = 0 } = {}) {
  const parts = [];
  if (hasFace) parts.push('The first reference photo shows the model: keep her identity exactly — same face shape, eyes, nose, lips, moles, blush and hair colour.');
  if (moodboard) {
    const which = hasFace ? `The other ${moodboard} reference photo${moodboard > 1 ? 's are' : ' is'}` : `The ${moodboard} reference photo${moodboard > 1 ? 's are' : ' is'}`;
    parts.push(`${which} a style moodboard only: borrow their photographic look — framing, light, colour, skin rendering and casual styling. Do not copy their faces, outfits, poses or backgrounds; ${hasFace ? 'keep the model from the first photo' : 'create a new woman'} in the new setting described.`);
  }
  return parts.join(' ');
}

export function composePrompt(prompt, refs) {
  const pre = referencePreamble(refs);
  return pre ? pre + ' ' + prompt : prompt;
}

// Face swap: first reference = base image to keep, second = the model's face.
export function swapPrompt(faceDesc = '', { openEyes = true } = {}) {
  const desc = faceDesc.trim() ? ` (${faceDesc.trim()})` : '';
  return 'Edit the first image. Replace only the woman\'s face and hair with the woman from the second image so it is clearly the same person' + desc +
    ': same face shape, eyes, nose, lips, moles, blush and hair colour. Keep the first image\'s pose, outfit, bag, props, background, lighting, flash, camera angle, framing and colour unchanged, and keep her hair the same colour as the second image even in strong light; blend the face into the scene\'s light naturally.' +
    (openEyes ? ' If her eyes are closed in the first image, open them so her face is recognisable, keeping the same mood.' : '') +
    ' Natural dewy skin, no beauty filter, no text, no watermark.';
}

// Tested scene presets (fields for buildPrompt).
export const PRESETS = {
  selfie_cafe: {
    label: '自拍·咖啡店（冷淡脸）', shot: 'selfie', flash: 'off', framing: 'close',
    hair: 'Long dark reddish-brown hair in loose, slightly messy waves, half-up with a small clip, flyaway strands around her face',
    expression: 'Neutral, calm expression, lips relaxed, looking straight into the lens without smiling',
    outfit: 'She wears an open cream cable-knit cardigan over a white petal-lace top and a thin gold chain with a small heart pendant',
    scene: 'Behind her is a small ordinary bakery café with white tiled walls, a pastry counter, wooden stools and a window onto a quiet street',
    light: 'Soft, flat ambient daylight from the window to her left, low contrast, slightly muted warm colour with a soft beige cast, gentle haze in the highlights',
  },
  street_crouch: {
    label: '街拍·斑马线蹲拍（轻闪）', shot: 'friend', flash: 'gentle', framing: 'full',
    hair: 'Long dark reddish-brown hair in loose, slightly messy waves, flyaway strands moving in the breeze',
    expression: 'Laughing openly, cheeks lifted',
    outfit: 'She wears an oversized faded sage zip-up track jacket over a white tee, an ivory tiered cotton midi skirt, white crew socks and plain unbranded grey suede sneakers',
    action: 'Shot from a slightly high angle, she crouches on a worn crosswalk stripe, knees bent, one hand holding her phone with a short beaded strap, a canvas tote on the asphalt beside her',
    scene: 'Grey asphalt, a drain grate, a low kerb and a black metal railing surround her on a quiet residential street',
    light: "Bright afternoon sun from the upper left rims her hair and throws the railing's diagonal shadows across the road",
  },
  street_glasses: {
    label: '街拍·红砖店前抱臂（直闪）', shot: 'friend', flash: 'gentle', framing: 'half',
    hair: 'Long dark reddish-brown hair loosely tied in a low ponytail with face-framing strands',
    expression: 'A lively, curious half-smile, looking just past the camera',
    outfit: 'She wears thin oval black glasses, small silver hoops, a white ribbed tank top under an unbuttoned washed-blue denim shirt, and a woven straw shoulder bag',
    action: 'She crosses her arms',
    scene: "Behind her are green street trees, a café's red-brick facade, a bicycle leaning on a pole and a narrow road",
    light: 'Clean cool daylight with soft dappled leaf shadows on the wall; nose and jaw keep soft shadows',
  },
  street_wall: {
    label: '街拍·老街石墙全身（无闪）', shot: 'friend', flash: 'off', framing: 'full',
    hair: 'Long dark reddish-brown waves half clipped up with a small tortoiseshell claw clip',
    expression: 'Gaze drifting sideways, unposed',
    outfit: 'She wears a cropped oatmeal knit cardigan buttoned up, pale grey-blue wide-leg jeans, brown suede loafers and a burgundy leather shoulder bag',
    action: 'Taken from waist height, she rests one hand on top of her head, weight on one leg, mid-step',
    scene: 'Beside a weathered stone wall and a white iron gate in an old hillside neighbourhood',
    light: 'Leafy late-afternoon daylight, soft natural colour',
  },
  ccd_cafe: {
    label: 'CCD·咖啡店托腮', shot: 'ccd', flash: 'off', framing: 'half',
    hair: 'Long dark reddish-brown messy waves half clipped up',
    expression: 'Calm, slightly sleepy expression, looking at the lens',
    outfit: 'She wears a dusty-pink fine-knit polo cardigan with small pearl buttons and thin gold hoops',
    action: 'She sits at a small marble table with a latte and a half-eaten slice of strawberry cake, chin resting on her interlaced fingers',
    scene: 'Behind her: a white-tiled wall, a wooden shelf with jars and a dried-flower vase',
    light: 'Soft window light from frame left',
  },
  mirror_room: {
    label: '对镜自拍·卧室', shot: 'mirror', flash: 'off', framing: 'full',
    hair: 'Long dark reddish-brown messy waves',
    expression: 'Soft, unbothered expression, looking at the phone screen',
    outfit: 'She wears a cropped black ribbed cardigan, a long pale-grey pleated satin skirt, white socks and black ballet flats, a small silver shoulder bag',
    action: 'One hip popped, free hand touching the ends of her hair',
    scene: 'A small, slightly messy bedroom: a bed with rumpled white sheets, a clothes rail and a tote bag on the floor visible in the mirror',
    light: 'Warm late-afternoon light through a sheer curtain',
  },
};

// Pull the creator's prompt out of a douyin caption ("…prompt：<text> #AIGC #…"). Returns '' when none.
export function extractAuthorPrompt(desc = '') {
  const m = String(desc).match(/prompt\s*[:：]\s*([\s\S]+)/i);
  if (!m) return '';
  const text = m[1].replace(/(^|\s)[#@][^\s#@]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return text.length >= 40 ? text : '';
}
