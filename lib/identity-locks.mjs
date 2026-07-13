export const BUILTIN_VISUAL_LOCKS = [
    {
        id: 'lucifer',
        names: ['lucifer', '路西法'],
        prompt: 'Lucifer: adult woman, tall voluptuous build, pale skin, elegant oval face, very long golden-blonde hair, blue eyes, proud mature expression, black thorn chains as Garb of Punishment; keep the same face, hair, eyes, build and current story outfit in every image.',
        anchorGroups: [
            /(?:golden[- ]blonde|blonde|golden)\s+(?:long\s+)?hair|(?:long\s+)?(?:golden[- ]blonde|blonde|golden)\s+hair/i,
            /blue eyes/i,
            /(?:adult woman|mature woman|tall|voluptuous|curvy)/i,
            /(?:thorn|chain|garb of punishment)/i,
        ],
    },
    {
        id: 'leviathan',
        names: ['leviathan', '利维坦'],
        prompt: 'Leviathan: petite adult woman, slim build, pale skin, round doll-like face, long light-purple twin tails, straight bangs, large round purple eyes, navy and black-purple gothic dress with water-pattern trim; keep the same face, hair, eyes and build in every image.',
        anchorGroups: [
            /(?:light[- ]purple|lavender|purple)\s+(?:long\s+)?(?:twin ?tails?|twintails?)|(?:twin ?tails?|twintails?).{0,20}(?:light[- ]purple|lavender|purple)/i,
            /purple eyes/i,
            /(?:petite adult woman|petite|slim build|doll[- ]like face|round doll face)/i,
            /(?:gothic dress|gothic lolita|water[- ]pattern)/i,
        ],
    },
    {
        id: 'behemoth',
        names: ['behemoth', '贝希摩斯'],
        prompt: 'Behemoth: one small black or navy stuffed demon mascot, fabric doll body, tiny bat wings, old gas mask; it is a plush doll, never a bird or real animal.',
        anchorGroups: [
            /(?:plush|stuffed|fabric doll|mascot)/i,
            /bat wings?/i,
            /gas mask/i,
        ],
    },
];

export function visualLocksForText(source = '') {
    const text = String(source).toLowerCase();
    return BUILTIN_VISUAL_LOCKS.filter(lock => lock.names.some(name => text.includes(name.toLowerCase())));
}

export function buildVisualDnaHint(source = '', explicitHint = '', extraEntries = []) {
    const parts = [];
    if (String(explicitHint || '').trim()) parts.push(`USER DNA:\n${String(explicitHint).trim()}`);
    const locks = visualLocksForText(source);
    if (locks.length) parts.push(`CANONICAL VISUAL LOCKS:\n${locks.map(lock => lock.prompt).join('\n')}`);
    const extras = [...new Set(extraEntries.map(value => String(value || '').trim()).filter(Boolean))];
    if (extras.length) parts.push(`ACTIVE CHARACTER CARD EVIDENCE:\n${extras.join('\n\n')}`);
    return parts.join('\n\n') || 'No explicit DNA was supplied. Derive immutable appearance only from the character card and adjacent story, then repeat it in every prompt.';
}

export function identityAnchorIssues(prompt = '') {
    const text = String(prompt);
    const issues = [];
    for (const lock of visualLocksForText(text)) {
        const matched = lock.anchorGroups.filter(pattern => pattern.test(text)).length;
        if (matched < lock.anchorGroups.length) {
            issues.push({
                code: lock.id === 'behemoth' ? 'ambiguous_named_prop' : 'identity_anchor_missing',
                // An incomplete DNA block can reduce continuity, but hiding the
                // only native Chatu8 button is worse than showing a usable shot.
                // Named-prop ambiguity remains blocking because it changes the
                // depicted subject (for example a plush mascot into an animal).
                severity: lock.id === 'behemoth' ? 'error' : 'warning',
                message: `${lock.id} 缺少固定外貌/道具锚点（${matched}/${lock.anchorGroups.length}）`,
                identity: lock.id,
            });
        }
    }
    const lower = text.toLowerCase();
    const hasLucifer = lower.includes('lucifer');
    const hasLeviathan = lower.includes('leviathan');
    if (hasLucifer && hasLeviathan && /\b(?:2girls|two (?:adult )?women|duo)\b/i.test(text)) {
        const separated = /\b(?:left|right|foreground|background|front|back|beside|separate bodies|both (?:women|girls|faces)|clear separation)\b/i.test(text);
        if (!separated) {
            issues.push({
                code: 'multi_character_separation_missing',
                severity: 'warning',
                message: '双人镜头缺少左右/前后位置和两具独立身体约束',
            });
        }
    }
    return issues;
}
