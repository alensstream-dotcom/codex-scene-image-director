export const ANIMA_ACCURACY_WORKFLOW_ID = 'JANIMA_Galgame_Turbo_8步_角色锁_v1';

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
    'plain white bodysuit',
    'white bodycon dress',
    'skintight bodysuit',
    'latex bodysuit',
    'lingerie',
    'swimsuit',
    'leotard',
    'bikini',
    'floating mascot',
    'mascot off shoulder',
    'animal instead of plush mascot',
];

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
                strength_model: 0.35,
                strength_clip: 0.25,
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
                cfg: 4.5,
                sampler_name: 'er_sde',
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
        || Number(chatu8Settings.cfg_comfyui) !== 4.5
        || chatu8Settings.comfyuisamplerName !== 'er_sde'
        || chatu8Settings.comfyui_scheduler !== 'normal';
    chatu8Settings.workers[ANIMA_ACCURACY_WORKFLOW_ID] = workflow;
    chatu8Settings.workerid = ANIMA_ACCURACY_WORKFLOW_ID;
    chatu8Settings.worker = workflow;
    chatu8Settings.comfyui_steps = 8;
    chatu8Settings.cfg_comfyui = 4.5;
    chatu8Settings.comfyuisamplerName = 'er_sde';
    chatu8Settings.comfyui_scheduler = 'normal';

    chatu8Settings.yushe ||= {};
    chatu8Settings.yushe['默认'] ||= { fixedPrompt: '', fixedPrompt_end: '', negativePrompt: '' };
    const preset = chatu8Settings.yushe['默认'];
    const existing = String(preset.negativePrompt || '').split(',').map(tag => tag.trim()).filter(Boolean);
    const keys = new Set(existing.map(tag => tag.toLowerCase()));
    const additions = IDENTITY_NEGATIVE_TAGS.filter(tag => !keys.has(tag.toLowerCase()));
    if (additions.length) {
        preset.negativePrompt = [...existing, ...additions].join(', ');
        changed = true;
    }
    return changed;
}
