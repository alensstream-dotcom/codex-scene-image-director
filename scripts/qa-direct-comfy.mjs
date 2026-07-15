import { writeFile } from 'node:fs/promises';
import { buildAnimaWorkflow } from '../lib/anima-direct-workflow.mjs';

const baseUrl = String(process.env.COMFY_URL || 'http://192.168.1.12:8188').replace(/\/$/, '');
const output = process.argv[2] || '';
const variant = String(process.env.QA_VARIANT || 'impact');
const scene = variant === 'aftermath'
    ? [
        'decisive action: Seraphina kneels beside a shattered black monster claw and wipes glowing blood from her silver sword',
        '1girl, broken monster claw on the floor in the foreground',
        'ruined moonlit chapel after battle', 'relieved but alert expression',
        'dynamic Galgame event CG, cinematic three-quarter medium shot, blue rim light',
    ]
    : [
        "decisive action: Seraphina blocks a huge black monster claw with her silver sword at the exact instant of impact, the claw and blade visibly colliding",
        '1girl, 1monster, heroine on the left, monster black claw entering from the right foreground',
        'ruined moonlit chapel', 'determined gaze',
        'dynamic Galgame event CG, cinematic medium shot, both sword and black claw fully visible, blue rim light',
    ];
const prompt = [
    'safe', 'masterpiece', 'best quality', 'score_7', 'highres', 'newest',
    ...scene,
    'adult woman', 'slim athletic build', 'pale skin', 'oval face',
    'long blue hair', 'amber eyes', 'white and blue combat dress',
].join(', ');

const workflow = buildAnimaWorkflow({
    positive: prompt,
    negative: 'worst quality, low quality, bad anatomy, bad hands, text, logo, watermark, blurry',
    seed: 115568571,
});

const started = performance.now();
const queueResponse = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
});
if (!queueResponse.ok) throw new Error(`Queue failed ${queueResponse.status}: ${await queueResponse.text()}`);
const queued = await queueResponse.json();
const promptId = queued.prompt_id;
let item;
while (!item) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const response = await fetch(`${baseUrl}/history/${promptId}`);
    if (!response.ok) throw new Error(`History failed ${response.status}`);
    item = (await response.json())[promptId];
}
if (item.status?.status_str !== 'success') throw new Error(JSON.stringify(item.status));
const imageInfo = Object.values(item.outputs).flatMap(value => value.images || [])[0];
if (!imageInfo) throw new Error('No image output');
const query = new URLSearchParams({
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder || '',
    type: imageInfo.type || 'output',
});
const imageResponse = await fetch(`${baseUrl}/view?${query}`);
if (!imageResponse.ok) throw new Error(`Image download failed ${imageResponse.status}`);
const bytes = new Uint8Array(await imageResponse.arrayBuffer());
if (output) await writeFile(output, bytes);
console.log(JSON.stringify({
    ok: true,
    promptId,
    elapsedMs: Math.round(performance.now() - started),
    bytes: bytes.length,
    imageInfo,
    output: output || null,
}));
