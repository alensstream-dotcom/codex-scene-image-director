import { buildAnimaAccuracyWorkflow } from '../lib/anima-workflow.mjs';

const endpoint = process.env.COMFYUI_URL || 'http://127.0.0.1:8188';
const prompt = process.env.ANIMA_QA_PROMPT;
const negative = process.env.ANIMA_QA_NEGATIVE || 'worst quality, low quality, lowres, score_1, score_2, score_3, blurry, jpeg artifacts, long fingers, bad anatomy, missing fingers, watermark, artist name';
const seed = Number(process.env.ANIMA_QA_SEED || 246813579);
const prefix = process.env.ANIMA_QA_PREFIX || 'JANIMA_PROFILE_QA';

if (!prompt) throw new Error('ANIMA_QA_PROMPT is required');

const graph = JSON.parse(buildAnimaAccuracyWorkflow());
graph['8'].inputs.text = prompt;
graph['9'].inputs.text = negative;
graph['10'].inputs.width = 768;
graph['10'].inputs.height = 1024;
graph['11'].inputs.seed = seed;
graph['13'].inputs.filename_prefix = prefix;

const queued = await fetch(`${endpoint}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: `janima-profile-${Date.now()}`, prompt: graph }),
});
if (!queued.ok) throw new Error(`queue failed: ${queued.status} ${await queued.text()}`);
const { prompt_id: promptId } = await queued.json();

const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
    const response = await fetch(`${endpoint}/history/${promptId}`);
    if (!response.ok) throw new Error(`history failed: ${response.status}`);
    const history = await response.json();
    const item = history[promptId];
    const images = Object.values(item?.outputs || {}).flatMap(output => output.images || []);
    if (images.length) {
        process.stdout.write(JSON.stringify({ promptId, seed, images }));
        process.exit(0);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
}

throw new Error(`generation timed out: ${promptId}`);
