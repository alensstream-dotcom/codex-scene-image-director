import test from 'node:test';
import assert from 'node:assert/strict';
import { clampParagraphIndex, paragraphIndexForQuote, splitStoryParagraphs } from '../lib/scene-anchor.mjs';

test('splits blank-line story paragraphs', () => {
    const parts = splitStoryParagraphs('第一段。\n\n第二段。\n\n第三段。');
    assert.deepEqual(parts.map(item => item.text), ['第一段。', '第二段。', '第三段。']);
});

test('maps quote to paragraph index before DOM rendering', () => {
    const story = '她推开门。\n\n樱探进半个脑袋，粉色长发滑过肩头。\n\n他抬头看她。';
    assert.equal(paragraphIndexForQuote(story, '樱探进半个脑袋'), 1);
});

test('falls back to final paragraph inside the same message', () => {
    assert.equal(paragraphIndexForQuote('一。\n\n二。', '不存在'), 1);
    assert.equal(clampParagraphIndex(99, 3), 2);
});
