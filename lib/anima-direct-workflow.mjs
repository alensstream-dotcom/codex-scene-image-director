export const DEFAULT_ANIMA_PROFILE = Object.freeze({
    model: 'JANIMA_v10.safetensors',
    clip: 'qwen_3_06b_base.safetensors',
    vae: 'qwen_image_vae.safetensors',
    lora: 'anima-turbo-lora-v0.2.safetensors',
    width: 768,
    height: 1024,
    steps: 8,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'normal',
});

function integer(value, fallback, minimum, maximum) {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function number(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function normalizeProfile(input = {}) {
    return {
        ...DEFAULT_ANIMA_PROFILE,
        ...input,
        width: integer(input.width, DEFAULT_ANIMA_PROFILE.width, 256, 1536),
        height: integer(input.height, DEFAULT_ANIMA_PROFILE.height, 256, 1536),
        steps: integer(input.steps, DEFAULT_ANIMA_PROFILE.steps, 1, 30),
        cfg: number(input.cfg, DEFAULT_ANIMA_PROFILE.cfg, 0.1, 20),
    };
}

export function buildAnimaWorkflow({ positive, negative, seed, profile = {}, referenceImage = '', referenceDenoise = 0.9 }) {
    const p = normalizeProfile(profile);
    const graph = {
        2: {
            inputs: { unet_name: p.model, weight_dtype: 'default' },
            class_type: 'UNETLoader',
            _meta: { title: 'JANIMA model' },
        },
        5: {
            inputs: { clip_name: p.clip, type: 'stable_diffusion', device: 'default' },
            class_type: 'CLIPLoader',
            _meta: { title: 'Qwen text encoder' },
        },
        6: {
            inputs: { vae_name: p.vae },
            class_type: 'VAELoader',
            _meta: { title: 'Anima VAE' },
        },
        7: {
            inputs: {
                lora_name: p.lora,
                strength_model: 1,
                strength_clip: 1,
                model: ['2', 0],
                clip: ['5', 0],
            },
            class_type: 'LoraLoader',
            _meta: { title: 'Anima Turbo LoRA' },
        },
        8: {
            inputs: { text: String(positive || ''), clip: ['7', 1] },
            class_type: 'CLIPTextEncode',
            _meta: { title: 'Positive prompt' },
        },
        9: {
            inputs: { text: String(negative || ''), clip: ['7', 1] },
            class_type: 'CLIPTextEncode',
            _meta: { title: 'Negative prompt' },
        },
        10: referenceImage ? {
            inputs: { image: String(referenceImage) },
            class_type: 'LoadImage',
            _meta: { title: 'Locked heroine reference' },
        } : {
            inputs: { width: p.width, height: p.height, batch_size: 1 },
            class_type: 'EmptyLatentImage',
            _meta: { title: 'Portrait canvas' },
        },
        11: {
            inputs: {
                seed: integer(seed, 1, 1, Number.MAX_SAFE_INTEGER),
                steps: p.steps,
                cfg: p.cfg,
                sampler_name: p.sampler,
                scheduler: p.scheduler,
                denoise: referenceImage ? number(referenceDenoise, 0.9, 0.55, 0.95) : 1,
                model: ['7', 0],
                positive: ['8', 0],
                negative: ['9', 0],
                latent_image: referenceImage ? ['14', 0] : ['10', 0],
            },
            class_type: 'KSampler',
            _meta: { title: 'Turbo sampler' },
        },
        12: {
            inputs: { samples: ['11', 0], vae: ['6', 0] },
            class_type: 'VAEDecode',
            _meta: { title: 'Decode' },
        },
        13: {
            inputs: { filename_prefix: 'ST_JANIMA_AUTO_CG', images: ['12', 0] },
            class_type: 'SaveImage',
            _meta: { title: 'Save image' },
        },
    };
    if (referenceImage) {
        graph[14] = {
            inputs: { pixels: ['10', 0], vae: ['6', 0] },
            class_type: 'VAEEncode',
            _meta: { title: 'Reference latent' },
        };
    }
    return graph;
}

export function buildComfyProxyBody(url, workflow) {
    return {
        url,
        prompt: JSON.stringify({ prompt: workflow }),
    };
}

