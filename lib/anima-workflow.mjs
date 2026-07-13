export const ANIMA_ACCURACY_WORKFLOW_ID = 'JANIMA_Galgame_Turbo_8步_Anima原生提示词_v2';
export const ANIMA_PROMPT_PRESET_ID = 'JANIMA Anima 原生 Galgame';

export const ANIMA_NATIVE_QUALITY_TAGS = [
    'masterpiece',
    'best quality',
    'score_7',
    'highres',
    'newest',
];

export const ANIMA_SAFETY_TAGS = ['safe', 'sensitive', 'nsfw', 'explicit'];

export const ANIMA_NATIVE_NEGATIVE_TAGS = [
    'worst quality',
    'low quality',
    'score_1',
    'score_2',
    'score_3',
    'artist name',
    'blurry',
    'jpeg artifacts',
    'chromatic aberration',
    'watermark',
    'text',
    'logo',
    'signature',
];

export const IDENTITY_NEGATIVE_TAGS = [
    'missing character',
    'missing person',
    'merged people',
    'fused bodies',
    'duplicated person',
    'identical twins',
    'wrong character design',
    'wrong face',
    'different face',
    'identity drift',
    'wrong hair color',
    'wrong eye color',
    'wrong clothes',
    'wrong outfit color',
    'floating mascot',
    'mascot off shoulder',
    'animal instead of plush mascot',
];

const LEGACY_WORKFLOW_IDS = ['JANIMA_Galgame_Turbo_8步_角色锁_v1'];

/**
 * Real-time Galgame workflow for JANIMA/Anima checkpoints.
 *
 * JANIMA is an Anima transformer checkpoint, so classic SD1.5/SDXL IP-Adapter
 * graphs are not compatible. Character continuity therefore comes from the
 * complete per-shot visual DNA while the user's Turbo LoRA keeps latency low.
 */
export function buildAnimaAccuracyWorkflow() {
    return JSON.stringify({
        2: {
            inputs: { unet_name: 'JANIMA_v10.safetensors', weight_dtype: 'default' },
            class_type: 'UNETLoader',
            _meta: { title: 'JANIMA 模型' },
        },
        5: {
            inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' },
            class_type: 'CLIPLoader',
            _meta: { title: 'Qwen 文本编码器' },
        },
        6: {
            inputs: { vae_name: 'qwen_image_vae.safetensors' },
            class_type: 'VAELoader',
            _meta: { title: 'Anima VAE' },
        },
        7: {
            inputs: {
                lora_name: 'anima-turbo-lora-v0.2.safetensors',
                strength_model: 1,
                strength_clip: 1,
                model: ['2', 0],
                clip: ['5', 0],
            },
            class_type: 'LoraLoader',
            _meta: { title: 'Anima Turbo 加速 LoRA' },
        },
        8: {
            inputs: { text: '%prompt%', clip: ['7', 1] },
            class_type: 'CLIPTextEncode',
            _meta: { title: '正面提示词' },
        },
        9: {
            inputs: { text: '%negative_prompt%', clip: ['7', 1] },
            class_type: 'CLIPTextEncode',
            _meta: { title: '负面提示词' },
        },
        10: {
            inputs: { width: '%width%', height: '%height%', batch_size: 1 },
            class_type: 'EmptyLatentImage',
            _meta: { title: '画布' },
        },
        11: {
            inputs: {
                seed: '%seed%',
                steps: 8,
                cfg: 1,
                sampler_name: 'euler',
                scheduler: 'normal',
                denoise: 1,
                model: ['7', 0],
                positive: ['8', 0],
                negative: ['9', 0],
                latent_image: ['10', 0],
            },
            class_type: 'KSampler',
            _meta: { title: 'Galgame 8步实时采样' },
        },
        12: {
            inputs: { samples: ['11', 0], vae: ['6', 0] },
            class_type: 'VAEDecode',
            _meta: { title: '解码' },
        },
        13: {
            inputs: { filename_prefix: 'ST_JANIMA_GALGAME', images: ['12', 0] },
            class_type: 'SaveImage',
            _meta: { title: '保存图像' },
        },
    }, null, 2);
}

export function installAnimaAccuracyWorkflow(chatu8Settings) {
    if (!chatu8Settings || typeof chatu8Settings !== 'object') return false;
    chatu8Settings.workers ||= {};
    const workflow = buildAnimaAccuracyWorkflow();
    let changed = chatu8Settings.workers[ANIMA_ACCURACY_WORKFLOW_ID] !== workflow
        || chatu8Settings.workerid !== ANIMA_ACCURACY_WORKFLOW_ID
        || chatu8Settings.worker !== workflow
        || Number(chatu8Settings.comfyui_steps) !== 8
        || Number(chatu8Settings.cfg_comfyui) !== 1
        || chatu8Settings.comfyuisamplerName !== 'euler'
        || chatu8Settings.comfyui_scheduler !== 'normal'
        || chatu8Settings.AQT_comfyui !== ''
        || chatu8Settings.UCP_comfyui !== ANIMA_NATIVE_NEGATIVE_TAGS.join(', ')
        || chatu8Settings.yusheid_comfyui !== ANIMA_PROMPT_PRESET_ID;
    for (const legacyId of LEGACY_WORKFLOW_IDS) {
        if (legacyId in chatu8Settings.workers) {
            delete chatu8Settings.workers[legacyId];
            changed = true;
        }
    }
    chatu8Settings.workers[ANIMA_ACCURACY_WORKFLOW_ID] = workflow;
    chatu8Settings.workerid = ANIMA_ACCURACY_WORKFLOW_ID;
    chatu8Settings.worker = workflow;
    chatu8Settings.comfyui_steps = 8;
    chatu8Settings.cfg_comfyui = 1;
    chatu8Settings.comfyuisamplerName = 'euler';
    chatu8Settings.comfyui_scheduler = 'normal';
    // Worldbook and rescue prompts already begin with the model-native quality
    // block. Keep Chatu8 from appending a second, out-of-order quality block.
    chatu8Settings.AQT_comfyui = '';
    chatu8Settings.UCP_comfyui = ANIMA_NATIVE_NEGATIVE_TAGS.join(', ');

    chatu8Settings.yushe ||= {};
    const nextPreset = {
        fixedPrompt: '',
        fixedPrompt_end: '',
        // Character identity is reinforced positively in every inline prompt.
        // Abstract negatives such as "identity drift" are not native Anima
        // tags and did not improve the same-seed QA comparisons.
        negativePrompt: '',
    };
    if (JSON.stringify(chatu8Settings.yushe[ANIMA_PROMPT_PRESET_ID]) !== JSON.stringify(nextPreset)) {
        chatu8Settings.yushe[ANIMA_PROMPT_PRESET_ID] = nextPreset;
        changed = true;
    }
    chatu8Settings.yusheid_comfyui = ANIMA_PROMPT_PRESET_ID;
    return changed;
}
