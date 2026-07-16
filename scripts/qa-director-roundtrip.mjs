import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildDirectorMessages, parseDirectorResponse } from '../lib/galgame-director.mjs';
import { createBible, mergePacketIntoBible } from '../lib/director-core.mjs';

const settingsPath = process.argv[2];
const baseUrl = process.argv[3] || 'http://127.0.0.1:11451';
if (!settingsPath) throw new Error('Usage: node scripts/qa-director-roundtrip.mjs <settings.json> [sillytavern-url]');
const allSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const settings = allSettings.extension_settings?.['st-chatu8']?.codexGalgameDirector;
if (!settings?.apiKey) throw new Error('Galgame director API key is not configured');

const csrfResponse = await fetch(`${baseUrl}/csrf-token`);
const csrf = await csrfResponse.json();
const cookie = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

async function direct(story, bible) {
    const messages = buildDirectorMessages({ story, lastUserMessage: '继续，让互动自然推进。', bible, settings });
    const started = performance.now();
    const response = await fetch(`${baseUrl}/api/backends/chat-completions/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token, Cookie: cookie },
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: settings.apiUrl,
            custom_include_headers: `Authorization: "Bearer ${settings.apiKey}"`,
            model: settings.model,
            messages,
            temperature: settings.temperature,
            top_p: 0.9,
            max_tokens: settings.maxTokens,
            stream: false,
            response_format: { type: 'json_object' },
        }),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? data?.content ?? '';
    const parsed = parseDirectorResponse(content, { story, bible, settings });
    return {
        elapsedMs: Math.round(performance.now() - started),
        characters: parsed.characters.map(item => ({ id: item.id, age: item.age, dna: item.dna })),
        scenes: parsed.scenes.map(item => ({ stage: item.packet.stage, anchor: item.anchor, cast: item.packet.cast.map(cast => cast.id) })),
    };
}

const bible = createBible();
mergePacketIntoBible(bible, { cast: [{
    id: '樱', prompt_name: 'Sakura',
    dna: 'adult woman, slim build, sakura-pink twin tails, purple eyes',
    outfit: 'pink cardigan, navy school uniform, pleated skirt, pink school bag',
}] });

const normalStory = [
    '清晨的校门前，成年女性樱背着粉色书包跑来。她笑着抓住我的手腕，把我从自行车旁拉到自己面前。',
    '走过商店街时，樱忽然停在橱窗前。她把奶油泡芙递到我的嘴边，紫色眼睛期待地望着我，直到我低头咬下一口。',
    '傍晚的河堤起了风。樱转身扑进我的怀里，双臂紧紧环住我的腰，随后含着眼泪吻住了我。',
].join('\n\n');

const adultStory = [
    '夜里回到公寓，二十四岁的成年女性樱主动关上房门，转身把我按在门板上亲吻。',
    '确认彼此同意后，她脱下粉色开衫，拉着我的手贴近自己，呼吸变得急促。',
    '两名成年人随后改变到更亲密的骑乘姿势，樱俯身抱紧我，在高潮后仍靠在我怀里接受安抚。',
].join('\n\n');

const normal = await direct(normalStory, bible);
const adult = await direct(adultStory, bible);
console.log(JSON.stringify({ normal, adult }, null, 2));
if (normal.scenes.length < 3 || !normal.scenes.some(scene => normalStory.indexOf(scene.anchor) > normalStory.length * 0.6)) process.exitCode = 1;
if (!adult.scenes.length || adult.scenes.some(scene => !scene.cast.includes('樱'))) process.exitCode = 1;

