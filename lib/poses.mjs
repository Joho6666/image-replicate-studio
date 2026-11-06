// Pose library, written for this project (not copied from any tutorial pack). Each pose is everyday and modest.
// `framing` is the framing the pose reads best in; `text` goes into the prompt as the pose clause.
export const POSES = {
  stand_hand_hair: { label: '站姿·手拢头发', framing: 'half', text: 'standing relaxed with one hand tucking a lock of hair behind her ear, weight on one leg, looking at the camera' },
  stand_look_back: { label: '站姿·回头看', framing: 'half', text: 'standing with her body turned away and her head turned back over her shoulder toward the camera, arms relaxed' },
  stand_bag_hand: { label: '站姿·单手拎包', framing: 'full', text: 'standing with her weight on one leg, one hand holding the strap of her bag, the other hand relaxed at her side, looking slightly off to the side' },
  stand_wall_lean: { label: '站姿·靠墙', framing: 'full', text: 'leaning one shoulder against a wall, one foot crossed over the other, hands loosely in her pockets or at her sides, calm expression' },
  walk_toward: { label: '走路·迎面走来', framing: 'full', text: 'walking toward the camera at a normal pace, mid-step, arms swinging naturally, a candid look slightly past the lens' },
  walk_away_turn: { label: '走路·侧身回眸', framing: 'full', text: 'walking away from the camera and glancing back over her shoulder with a small natural smile' },
  stand_adjust_sleeve: { label: '站姿·整理袖口', framing: 'half', text: 'standing and looking down at her sleeve cuff while adjusting it with the other hand, head slightly lowered' },
  stand_hands_front: { label: '站姿·双手在身前', framing: 'half', text: 'standing straight with both hands lightly clasped in front of her, shoulders relaxed, a faint smile, looking at the camera' },
  stand_arms_crossed: { label: '站姿·抱臂', framing: 'half', text: 'standing with her arms loosely crossed, head tilted slightly, a relaxed confident look at the camera' },
  stand_hand_collar: { label: '站姿·手扶领口', framing: 'half', text: 'standing with one hand lightly touching her collar or necklace, the other arm relaxed, looking calmly at the camera' },
  sit_chair_upright: { label: '坐姿·椅子端坐', framing: 'full', text: 'sitting upright on a chair with her knees together and her hands resting on her lap, looking at the camera' },
  sit_chair_side: { label: '坐姿·侧坐看向旁边', framing: 'half', text: 'sitting sideways on a chair with one arm resting on the backrest, looking away to the side in a quiet moment' },
  sit_step: { label: '坐姿·台阶坐着', framing: 'full', text: 'sitting on a step with her knees together and her forearms resting on her knees, looking at the camera with a soft smile' },
  sit_floor_cross: { label: '坐姿·盘腿坐地', framing: 'full', text: 'sitting cross-legged on the floor with her hands resting on her knees, relaxed posture' },
  sit_table_chin: { label: '坐姿·手托下巴', framing: 'half', text: 'sitting at a table with her elbow on the table and her hand supporting her chin, looking at the camera' },
  sit_table_cup: { label: '坐姿·双手捧杯', framing: 'half', text: 'sitting at a table holding a cup with both hands near her chest, looking down at the cup then up toward the camera' },
  crouch_bag: { label: '蹲姿·蹲着看镜头', framing: 'full', text: 'crouching with her knees together and her forearms resting on her knees, holding her phone or a small bag, looking up at the camera' },
  close_hand_cheek: { label: '近景·手贴脸颊', framing: 'close', text: 'close-up with one hand resting lightly against her cheek, head tilted a little, soft eyes looking at the lens' },
  close_look_down: { label: '近景·低头', framing: 'close', text: 'close-up with her head slightly lowered and her eyes looking down, a quiet unposed moment' },
  close_laugh: { label: '近景·自然笑', framing: 'close', text: 'close-up caught mid-laugh, eyes crinkled, looking slightly off-camera, natural and unposed' },
  close_hair_wind: { label: '近景·风吹头发', framing: 'close', text: 'close-up with a breeze lifting a few strands of her hair across her face, one hand moving them aside, looking at the camera' },
  half_hold_flowers: { label: '半身·手拿花', framing: 'half', text: 'half-body holding a small bunch of flowers against her chest with both hands, looking down at them with a small smile' },
  half_phone_check: { label: '半身·看手机', framing: 'half', text: 'half-body looking at her phone in one hand, the other hand in her pocket, an absorbed natural expression' },
  half_hold_fan: { label: '半身·手执折扇', framing: 'half', text: 'half-body holding a folded fan in front of her with both hands, head slightly lowered, a calm look' },
};

export const poseClause = key => POSES[key] ? `Pose (this overrides any other pose mentioned above): ${POSES[key].text}.` : '';
