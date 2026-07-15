export function normalizeAnchorText(value = '') {
    return String(value || '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function splitStoryParagraphs(value = '') {
    const clean = String(value || '')
        .replace(/\r/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
    if (!clean) return [];
    let blocks = clean.split(/\n\s*\n+/).map(item => normalizeAnchorText(item)).filter(Boolean);
    if (blocks.length <= 1) {
        const lines = clean.split(/\n+/).map(item => normalizeAnchorText(item)).filter(Boolean);
        if (lines.length > 1) blocks = lines;
    }
    return blocks.map((text, index) => ({ index, text }));
}

export function paragraphIndexForQuote(story = '', quote = '') {
    const wanted = normalizeAnchorText(quote);
    const paragraphs = splitStoryParagraphs(story);
    if (!paragraphs.length) return -1;
    if (!wanted) return paragraphs.length - 1;
    const exact = paragraphs.find(item => item.text.includes(wanted) || wanted.includes(item.text));
    if (exact) return exact.index;
    const fragments = [120, 88, 64, 42, 26]
        .filter(length => wanted.length >= length)
        .flatMap(length => [wanted.slice(0, length), wanted.slice(-length)]);
    for (const fragment of fragments) {
        const found = paragraphs.find(item => item.text.includes(fragment));
        if (found) return found.index;
    }
    return paragraphs.length - 1;
}

export function clampParagraphIndex(index, count) {
    if (!Number.isFinite(Number(index)) || count <= 0) return Math.max(0, count - 1);
    return Math.max(0, Math.min(count - 1, Math.trunc(Number(index))));
}

export function semanticBlocks(root) {
    if (!root?.querySelectorAll) return [];
    const blocks = [...root.querySelectorAll('p, blockquote, li')]
        .filter(node => !node.closest('.janima-autocg-slot'))
        .filter(node => {
            const parentBlock = node.parentElement?.closest?.('p, blockquote, li');
            return !parentBlock || !root.contains(parentBlock);
        });
    return blocks.length ? blocks : [...root.children].filter(node => !node.matches?.('.janima-autocg-slot'));
}
