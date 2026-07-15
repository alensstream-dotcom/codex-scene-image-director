import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAnimaWorkflow } from '../lib/anima-direct-workflow.mjs';
import { compilePrompt, createBible, seedForPacket } from '../lib/director-core.mjs';

const baseUrl = String(process.env.COMFY_URL || 'http://192.168.1.12:8188').replace(/\/$/, '');
const outputDir = path.resolve(process.argv[2] || 'diagnostics/continuity');
await mkdir(outputDir, { recursive: true });

const cast = [{
    id: '樱',
    prompt_name: 'Sakura',
    dna: 'female character, 樱粉色双马尾, 粉色眼睛, petite build',
    outfit: '粉色针织开衫, 白衬衫, 深蓝百褶校裙, 黑色及膝袜, 棕色小皮鞋, 粉色书包',
}];
const beats = [
    {
        id: 'school_walk',
        quote: '清晨，樱背着粉色书包，两条樱粉色马尾随着脚步晃动。她走在男生前面，回头催他一起跑向校门。',
        action: '樱回头拉住男生的手，两个人一起跑向学校门口。',
        setting: '清晨阳光，安静住宅街，小学校门。',
        expression: '活泼又有一点得意的笑容',
        composition: 'full body two-shot, heroine and male companion equally clear, dynamic visual novel event CG',
    },
    {
        id: 'classroom_snack',
        quote: '午休教室里，樱坐在男生旁边，把一只奶油泡芙递到他嘴边，粉色双马尾垂在肩侧。',
        action: '樱把奶油泡芙递到男生嘴边喂他，两个人面对面互动。',
        setting: '明亮的日式学校教室，午后阳光，课桌。',
        expression: '害羞又期待地看着他',
        composition: 'intimate waist-up two-shot, both faces clearly visible, visual novel event CG',
    },
    {
        id: 'walk_home',
        quote: '放学后，樱抱着装泡芙的纸袋走在前面，男生跟在她身后半步。她回头说了一句，粉色双马尾被夕阳照亮。',
        action: '樱回头和身后的男生说话，两个人一起走在放学回家的路上。',
        setting: '夕阳下的住宅街和商店街，放学途中。',
        expression: '脸颊微红，努力装作不在意',
        composition: 'full body two-shot from the side, both characters prominent, visual novel event CG',
    },
].map(item => ({
    version: 1,
    people: '1girl, 1boy',
    cast,
    stage: 'story_action',
    safety: 'safe',
    ...item,
}));

async function generate(packet, referenceImage = '') {
    const compiled = compilePrompt(packet, createBible());
    const workflow = buildAnimaWorkflow({
        positive: compiled.positive,
        negative: compiled.negative,
        seed: seedForPacket(packet),
        referenceImage,
        referenceDenoise: Number(process.env.QA_REFERENCE_DENOISE || 0.9),
    });
    const started = performance.now();
    const queuedResponse = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
    });
    if (!queuedResponse.ok) throw new Error(`Queue failed ${queuedResponse.status}: ${await queuedResponse.text()}`);
    const { prompt_id: promptId } = await queuedResponse.json();
    let item;
    while (!item) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const response = await fetch(`${baseUrl}/history/${promptId}`);
        item = (await response.json())[promptId];
    }
    if (item.status?.status_str !== 'success') throw new Error(JSON.stringify(item.status));
    const imageInfo = Object.values(item.outputs).flatMap(value => value.images || [])[0];
    const query = new URLSearchParams({
        filename: imageInfo.filename,
        subfolder: imageInfo.subfolder || '',
        type: imageInfo.type || 'output',
    });
    const imageResponse = await fetch(`${baseUrl}/view?${query}`);
    const blob = await imageResponse.blob();
    return { blob, elapsedMs: Math.round(performance.now() - started), positive: compiled.positive, negative: compiled.negative };
}

async function uploadReference(blob) {
    const form = new FormData();
    form.append('image', blob, 'janima_identity_sakura_qa.png');
    form.append('type', 'input');
    form.append('overwrite', 'true');
    const response = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`Upload failed ${response.status}: ${await response.text()}`);
    const result = await response.json();
    return [result.subfolder, result.name].filter(Boolean).join('/');
}

const results = [];
let referenceImage = '';
for (let index = 0; index < beats.length; index++) {
    const result = await generate(beats[index], index === 0 ? '' : referenceImage);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const file = path.join(outputDir, `${index + 1}-${beats[index].id}.png`);
    await writeFile(file, bytes);
    if (index === 0) referenceImage = await uploadReference(result.blob);
    results.push({ id: beats[index].id, file, bytes: bytes.length, elapsedMs: result.elapsedMs });
}

console.log(JSON.stringify({ ok: true, referenceImage, results }, null, 2));
