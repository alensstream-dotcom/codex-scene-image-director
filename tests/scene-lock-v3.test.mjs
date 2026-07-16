import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneLock, findBestDomAnchor } from '../lib/scene-lock-v3.mjs';

test('ancient scene hard-blocks academy clothing', () => {
    const story = '青青身穿浅青色交领汉服，腰间系着白色丝带。\n\n她在庭院中握着木剑练习剑招。';
    const lock = buildSceneLock({ story, paragraphIndex: 1 });
    assert.match(lock.positive, /hanfu/i);
    assert.match(lock.positive, /浅青色交领汉服/);
    assert.match(lock.negative, /school uniform/i);
    assert.match(lock.negative, /academy uniform/i);
    assert.match(lock.negative, /western military uniform/i);
});

test('manual character and outfit locks override automatic extraction', () => {
    const lock = buildSceneLock({
        story: '她走进房间。',
        paragraphIndex: 0,
        manualCharacterLock: 'adult woman, long silver hair, violet eyes',
        manualOutfitLock: 'black silk hanfu, red sash',
    });
    assert.match(lock.positive, /long silver hair/);
    assert.match(lock.positive, /black silk hanfu/);
});

test('finds real DOM block by anchor text instead of saved paragraph index', () => {
    const blocks = [
        { textContent: '第一段普通对话。' },
        { textContent: '师父把手覆在青青手背上，纠正木剑角度。' },
        { textContent: '最后她们走到湖边。' },
    ];
    const matched = findBestDomAnchor(blocks, '把手覆在青青手背上，纠正木剑角度', 2);
    assert.equal(matched, blocks[1]);
});
