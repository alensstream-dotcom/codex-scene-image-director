import { buildAnimaWorkflow } from '../lib/anima-direct-workflow.mjs';
import { compilePrompt, createBible, mergePacketIntoBible } from '../lib/director-core.mjs';

const base = String(process.env.COMFY_URL || 'http://192.168.1.12:8188').replace(/\/$/, '');
const heroine = {
    id: 'Eileen',
    prompt_name: 'Eileen',
    dna: 'clearly adult woman, fair skin, slim build, long silver-white hair, blunt straight bangs, purple eyes',
    outfit: 'wet dark navy school uniform, white shirt, red ribbon tie, pleated skirt',
};
const packets = [
    {
        id: 'coffee_handoff',
        quote: '艾琳端着两杯热咖啡走来，把其中一杯递进他的手里，杯子在两人的手之间冒着热气。',
        people: '1girl, 1boy', cast: [heroine],
        action: 'Eileen hands a steaming coffee cup directly to the adult man; the cup is centered between both of their visible hands',
        setting: 'sunlit old train-station cafe, table and coffee steam visible',
        expression: 'gentle relieved smile',
        composition: 'medium two-shot, adult man on the right, Eileen on the left, coffee cup centered in foreground',
        stage: 'coffee_handoff', safety: 'safe',
    },
    {
        id: 'morning_kiss',
        quote: '晨光里艾琳环住他的腰，抬头主动吻住他的嘴唇，两人的脸和接触点清楚可见。',
        people: '1girl, 1boy', cast: [heroine],
        action: 'Eileen wraps both arms around the adult man waist and kisses him on the lips; exactly one woman and one man',
        setting: 'sunlit old train-station platform after rain',
        expression: 'tender relieved affection',
        composition: 'close two-shot, Eileen on the left and dark-haired adult man on the right, lips touching in profile',
        stage: 'morning_kiss', safety: 'safe',
    },
];

const bible = createBible();
for (const packet of packets) mergePacketIntoBible(bible, packet);

async function waitFor(promptId, timeoutMs = 45_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const history = await fetch(`${base}/history/${promptId}`).then(response => response.json());
        const item = history[promptId];
        if (item) {
            const images = Object.values(item.outputs || {}).flatMap(output => output.images || []);
            if (images.length) return { elapsedMs: Date.now() - started, images };
            if (item.status?.status_str === 'error') throw new Error(`ComfyUI failed ${promptId}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for ${promptId}`);
}

const results = [];
for (const [index, packet] of packets.entries()) {
    const compiled = compilePrompt(packet, bible);
    const graph = buildAnimaWorkflow({ positive: compiled.positive, negative: compiled.negative, seed: 1548236793 });
    graph[13].inputs.filename_prefix = `ST_JANIMA_V307_QA_${index + 1}`;
    const accepted = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: `codex-v307-${index + 1}` }),
    }).then(response => response.json());
    if (!accepted.prompt_id) throw new Error(JSON.stringify(accepted));
    const completed = await waitFor(accepted.prompt_id);
    results.push({ id: packet.id, promptId: accepted.prompt_id, ...completed });
}

console.log(JSON.stringify(results, null, 2));
