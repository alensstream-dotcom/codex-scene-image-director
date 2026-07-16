import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildAnimaWorkflow } from '../lib/anima-direct-workflow.mjs';
import { NEGATIVE_TAGS } from '../lib/director-core.mjs';

const comfyUrl = String(process.argv[2] || 'http://192.168.1.12:8188').replace(/\/+$/, '');
const outputDirectory = path.resolve(process.argv[3] || 'qa-output');
fs.mkdirSync(outputDirectory, { recursive: true });

const identity = '(adult woman:1.3), (sakura-pink twin tails:1.9), (purple eyes:1.8), slim build, pale skin, pink cardigan, navy school uniform, pleated skirt';
const prompts = [
    `masterpiece, best quality, very aesthetic, newest, anime visual novel event CG, 1girl, 1boy, ${identity}, (close-up of heroine's right hand wrapped around her male companion's left wrist:1.5), (her fingers visibly circling his sleeve cuff:1.4), wrist contact point centered in frame, his hand open and empty, their arms extended between them, she pulls him toward herself at a Japanese school gate, parked bicycle behind the characters, both hands dedicated to the wrist contact, a small gap between their bodies, both faces visible, dynamic medium shot, morning rim light, consistent character design`,
    `masterpiece, best quality, very aesthetic, newest, anime visual novel event CG, 1girl, 1boy, ${identity}, heroine offering a cream puff directly to her male companion's mouth, he takes a bite, both faces visible, sunlit neighborhood shopping street, intimate cinematic close shot, consistent character design`,
];
const negative = [...NEGATIVE_TAGS, 'male only', 'scenery only', 'different woman', 'black hair', 'blue hair', 'blonde hair', 'green eyes', 'wrong clothes'].join(', ');
const seed = 1548236793;

async function waitForImage(promptId, timeoutMs = 45000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
        const response = await fetch(`${comfyUrl}/history/${encodeURIComponent(promptId)}`);
        if (response.ok) {
            const history = await response.json();
            const item = history[promptId];
            if (item?.status?.status_str === 'error') throw new Error(`ComfyUI job ${promptId} failed`);
            const images = Object.values(item?.outputs || {}).flatMap(output => output.images || []);
            if (images.length) return { image: images[0], elapsedMs: Math.round(performance.now() - started) };
        }
        await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw new Error(`ComfyUI job ${promptId} timed out`);
}

const results = [];
for (const [index, positive] of prompts.entries()) {
    const workflow = buildAnimaWorkflow({ positive, negative, seed });
    const response = await fetch(`${comfyUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: `st-chatu8-qa-${Date.now()}-${index}` }),
    });
    if (!response.ok) throw new Error(`ComfyUI submit HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const submitted = await response.json();
    const completed = await waitForImage(submitted.prompt_id);
    const query = new URLSearchParams({
        filename: completed.image.filename,
        subfolder: completed.image.subfolder || '',
        type: completed.image.type || 'output',
    });
    const imageResponse = await fetch(`${comfyUrl}/view?${query}`);
    if (!imageResponse.ok) throw new Error(`ComfyUI image HTTP ${imageResponse.status}`);
    const destination = path.join(outputDirectory, `continuity-${index + 1}.png`);
    fs.writeFileSync(destination, Buffer.from(await imageResponse.arrayBuffer()));
    results.push({ index: index + 1, elapsedMs: completed.elapsedMs, file: destination });
}
console.log(JSON.stringify(results, null, 2));
