import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisualDnaHint, identityAnchorIssues } from '../lib/identity-locks.mjs';
import { validateTurn } from '../lib/rescue-core.mjs';

test('flags the live two-character prompt that lost Leviathan identity and separation', () => {
    const prompt = 'masterpiece, best quality, anime illustration, 2girls, lucifer and leviathan, lucifer, blonde long hair, blue eyes, thorns binding, chains, leviathan, petite, purple twintails, gothic lolita dress, dark throne room, close-up';
    const codes = identityAnchorIssues(prompt).map(issue => issue.code);
    assert.ok(codes.includes('identity_anchor_missing'));
    assert.ok(codes.includes('multi_character_separation_missing'));
});

test('flags Behemoth when a prompt relies on its name instead of visual prop anchors', () => {
    const codes = identityAnchorIssues('1girl, Leviathan, purple twin tails, purple eyes, petite, gothic lolita dress, Behemoth on shoulder').map(issue => issue.code);
    assert.ok(codes.includes('ambiguous_named_prop'));
});

test('accepts complete independent DNA blocks in a two-character scene', () => {
    const text = [
        '两人同时出现在王座前。',
        '',
        '[masterpiece, best quality, newest, high resolution, anime illustration, 2girls, exactly two adult women, female focus, two separate bodies, both faces visible, clear body separation, Lucifer on the left, adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, black thorn chains, Lucifer shielding Leviathan, determined expression, Leviathan on the right, petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, navy gothic dress, Leviathan looking up in surprise, dark throne room, medium two-shot]',
        '',
        '<!--IMG_COUNT:1-->',
    ].join('\n');
    const result = validateTurn(text);
    assert.equal(result.ok, true);
    assert.equal(result.issues.length, 0);
});

test('DNA hint provides canonical locks even when FM_DNA is empty', () => {
    const hint = buildVisualDnaHint('Lucifer looks at Leviathan while holding Behemoth.');
    assert.match(hint, /very long golden-blonde hair/);
    assert.match(hint, /long light-purple twin tails/);
    assert.match(hint, /old gas mask/);
});

test('incomplete character DNA remains diagnostic without suppressing an otherwise usable image', () => {
    const issues = identityAnchorIssues('1girl, solo, female focus, Lucifer, blonde hair, blue eyes, nude, bedroom, close-up');
    const identity = issues.find(issue => issue.code === 'identity_anchor_missing');
    assert.equal(identity?.severity, 'warning');
});
