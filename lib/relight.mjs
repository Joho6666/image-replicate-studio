// Re-lighting an existing photo with the whole-image edit template from flash-photo-skill
// (https://github.com/Leipengpeng/flash-photo-skill, references/maps-and-prompts.md + source-shapes.md),
// rewritten here. Tested 2026-11-04: a frontal-flash edit visibly changed the light (brighter subject,
// hard shadows, catchlights) while keeping pose/outfit/background; the first version made skin oily,
// hence SKIN_CARE.

export const LIGHTS = {
  flash_front: {
    label: '正面直闪',
    plan: 'A small, bright light source at the camera position, hard frontal lighting, strong power.',
    depth: 'The subject and foreground are noticeably brighter than the background, which falls off to its natural exposure.',
    shadow: 'Short hard shadows under the chin and nose, and a crisp short shadow behind the subject on the wall or ground.',
    reflect: 'Small concentrated highlights on skin, a crisp catchlight in the eyes, brighter fabric on the front of the clothes.',
  },
  // 2026-11-05: the first wording ("low power, only slightly brighter, nothing more") gave no visible change
  // on a well-lit daylight photo, so it now asks for a clearly visible fill that still keeps daylight dominant.
  flash_gentle: {
    label: '轻闪补光',
    plan: 'A small on-camera phone flash used as clearly visible fill, medium-low power. Daylight stays the main light, but the flash is obvious on the subject.',
    depth: 'The face and the front of the clothes are lifted about one stop brighter than in the original, flatter and more frontal, while the background keeps its daylight exposure, so the subject separates from it.',
    shadow: 'Daylight shadows on the face are filled in and much lighter; the flash adds a thin, crisp short shadow just behind the subject on the wall or ground.',
    reflect: 'A clear point catchlight in both eyes, small fresh highlights on the nose tip, cheekbones and lips, and a slight flash sheen on the clothes in front.',
  },
  softbox_left: {
    label: '左前大柔光箱',
    plan: 'A large rectangular softbox at the front left, about 45 degrees and slightly above eye level, medium power.',
    depth: 'Light spreads across the subject with a wide, smooth falloff; the background keeps its ambient light.',
    shadow: 'Soft wide shadows on the right side of the face and body, with a gradual brightness transition.',
    reflect: 'Broad soft highlights on skin, a rectangular catchlight in the eyes.',
  },
  ring: {
    label: '环形灯',
    plan: 'A ring light around the camera lens, even frontal fill, medium power.',
    depth: 'Even light on the subject, background keeps its ambient exposure.',
    shadow: 'Almost no visible shadows, a faint soft shadow edge behind the subject.',
    reflect: 'A ring-shaped catchlight in the eyes and on glasses if present.',
  },
  side_hard: {
    label: '左侧硬光',
    plan: 'A small hard light source at the left, about 70 degrees from the camera axis, at head height, strong power.',
    depth: 'The left side of the subject is bright while the right side falls toward shadow; background keeps its ambient light.',
    shadow: 'Short hard shadows extending to the right across the face and onto the wall or ground.',
    reflect: 'A bright rim of light along the left cheek, hair and shoulder.',
  },
  main_rim: {
    label: '主灯 + 右后轮廓灯',
    plan: 'A large softbox at the front left as the main light, plus a strip light behind and to the right as a rim light.',
    depth: 'The main light brightens the face and clothes; the rim light only touches the edges facing it.',
    shadow: 'Soft shadows on the right side from the main light.',
    reflect: 'A thin bright outline along hair and shoulder on the right side, soft highlights on the face.',
  },
  bounce_wall: {
    label: '侧墙跳闪',
    plan: 'A flash bounced off a light wall on the left, giving a large soft source from the left, medium power.',
    depth: 'The side near the wall is brighter; the light takes on the wall tone; the rest keeps ambient light.',
    shadow: 'Soft shadows falling away from the wall side.',
    reflect: 'Soft broad highlights on skin, a faint window-like catchlight in the eyes.',
  },
};

// 2026-11-05: "smart light" = match the light that is already in the scene instead of adding a new source.
// Used by the automatic relight pass after every generation (autoLight) and as a prompt clause (smartLightClause).
LIGHTS.scene_match = {
  label: '智能匹配场景光',
  plan: 'Identify the dominant light source already visible or implied in the scene (window, sun, lamp, overcast sky) and re-light the subject so it is modelled by that same source: same direction, same colour temperature, same softness. Do not add a new light source and do not change the exposure of the background.',
  depth: 'The subject receives that light with a natural gradient from the lit side to the shaded side, separating her gently from the background without looking cut out.',
  shadow: 'Soft directional shadows under the chin, nose and hair, and contact shadows where she touches the ground or furniture, all falling away from the same source.',
  reflect: 'A small natural catchlight in both eyes matching the source, gentle highlights on the cheekbone, nose bridge, lips and hair, fabric folds shaped by the light.',
};

// Prompt-level lighting direction added to every generation (no extra API call, no identity drift).
export const SMART_LIGHT_CLAUSE = 'Lighting: the light on her comes from one clearly motivated source visible or implied in the scene, with the same direction and colour temperature as the background; her face is modelled by it with a soft gradient from lit to shaded side, small natural catchlights in both eyes, a gentle shadow under the chin and nose, and contact shadows on the ground or furniture. Not flat, not evenly lit, no studio light.';
export const withSmartLight = prompt => (prompt || '').includes('Lighting: the light on her comes from') ? prompt : (prompt || '') + ' ' + SMART_LIGHT_CLAUSE;

export const STRENGTH = {
  subtle: '轻微（能看出变化即可）',
  normal: '正常',
  strong: '强烈（效果夸张）',
};

const STRENGTH_TEXT = {
  subtle: 'Keep the effect subtle: a noticeable but restrained change.',
  normal: '',
  strong: 'Make the effect strong and unmistakable.',
};

// Skin was oily on the first test; keep highlights small and skin natural.
const SKIN_CARE = 'Keep skin natural: highlights stay small and controlled, with no oily shine, no blown-out cheeks or forehead, no smoothing, keep fine skin texture.';

export function relightPrompt(key, { strength = 'normal', extra = '' } = {}) {
  const L = LIGHTS[key];
  if (!L) throw new Error('没有这种灯型：' + key);
  return [
    `Edit the original photograph to add ${L.label.replace(/[^\w ]/g, '') ? '' : ''}the following lighting: ${L.plan}`,
    'Preserve the source canvas, camera perspective, identity, face, pose, outfit, objects, textures, text and visible reflections. Keep the ambient light in the far background.',
    `Light response by depth: ${L.depth}`,
    `Place shadows on their actual receiving surfaces, with direction and softness set by the source: ${L.shadow}`,
    `Apply reflections where the light-to-surface-to-camera path allows: ${L.reflect}`,
    SKIN_CARE,
    STRENGTH_TEXT[strength] || '',
    extra.trim(),
    'Return one relit photograph. Keep lighting equipment and guide colors out of frame. No text, no watermark.',
  ].filter(Boolean).join(' ');
}
