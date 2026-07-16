function canonicalChar(char) {
    if (/\s/.test(char)) return ' ';
    if (/[“”「」『』]/.test(char)) return '"';
    if (/[‘’]/.test(char)) return "'";
    return char;
}

export function canonicalText(value = '') {
    let result = '';
    let whitespace = false;
    for (const raw of String(value || '').replace(/[\u200b-\u200d\ufeff]/g, '')) {
        const char = canonicalChar(raw);
        if (char === ' ') {
            if (!whitespace && result) result += ' ';
            whitespace = true;
        } else {
            result += char;
            whitespace = false;
        }
    }
    return result.trim();
}

function visibleTextNodes(root) {
    const nodes = [];
    if (!root) return nodes;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || !String(node.nodeValue || '').trim()) return NodeFilter.FILTER_REJECT;
            if (parent.closest('.janima-autocg-slot, .janima-autocg-anchor-marker, script, style, textarea')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
}

export function buildRenderedTextMap(root) {
    const text = [];
    const points = [];
    let whitespace = false;
    for (const node of visibleTextNodes(root)) {
        const value = String(node.nodeValue || '');
        for (let offset = 0; offset < value.length; offset++) {
            const char = canonicalChar(value[offset]);
            if (char === ' ') {
                if (!whitespace && text.length) {
                    text.push(' ');
                    points.push({ node, offset: offset + 1 });
                }
                whitespace = true;
            } else {
                text.push(char);
                points.push({ node, offset: offset + 1 });
                whitespace = false;
            }
        }
    }
    while (text.at(-1) === ' ') {
        text.pop();
        points.pop();
    }
    return { text: text.join(''), points };
}

function occurrences(haystack, needle) {
    const result = [];
    if (!needle) return result;
    let from = 0;
    while (from <= haystack.length - needle.length) {
        const index = haystack.indexOf(needle, from);
        if (index < 0) break;
        result.push(index);
        from = index + Math.max(1, needle.length);
    }
    return result;
}

function contextScore(rendered, start, end, spec = {}) {
    let score = 0;
    const before = canonicalText(spec.before).slice(-120);
    const after = canonicalText(spec.after).slice(0, 120);
    if (before) {
        const actual = rendered.slice(Math.max(0, start - before.length - 30), start);
        if (actual.endsWith(before)) score += 200 + before.length;
        else if (actual.includes(before.slice(-Math.min(40, before.length)))) score += 40;
    }
    if (after) {
        const actual = rendered.slice(end, Math.min(rendered.length, end + after.length + 30));
        if (actual.startsWith(after)) score += 200 + after.length;
        else if (actual.includes(after.slice(0, Math.min(40, after.length)))) score += 40;
    }
    return score;
}

export function resolveRenderedAnchor(root, spec = {}) {
    const map = buildRenderedTextMap(root);
    const quote = canonicalText(spec.quote);
    if (!quote || !map.text || !map.points.length) return null;
    const exact = occurrences(map.text, quote);
    let candidates = exact.map(start => ({ start, end: start + quote.length, score: contextScore(map.text, start, start + quote.length, spec) }));

    if (!candidates.length) {
        const fragments = [160, 120, 88, 64, 42, 26]
            .filter(length => quote.length >= length)
            .flatMap(length => [quote.slice(0, length), quote.slice(-length)]);
        for (const fragment of fragments) {
            const starts = occurrences(map.text, fragment);
            if (!starts.length) continue;
            candidates = starts.map(start => ({ start, end: start + fragment.length, score: length + contextScore(map.text, start, start + fragment.length, spec) }));
            if (candidates.length) break;
        }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || a.start - b.start);
    const best = candidates[0];
    const point = map.points[Math.max(0, Math.min(map.points.length - 1, best.end - 1))];
    return point ? { ...point, score: best.score, matchedText: map.text.slice(best.start, best.end) } : null;
}

function insertionBlock(marker, root) {
    const block = marker.closest('p, blockquote, li, pre, table, details');
    if (block && root.contains(block)) return block;
    let current = marker.parentElement;
    while (current && current.parentElement !== root) current = current.parentElement;
    return current || marker;
}

export function insertSlotAtExactAnchor(root, slot, spec = {}, previousByKey = new Map()) {
    const resolved = resolveRenderedAnchor(root, spec);
    if (!resolved) return { inserted: false, reason: 'exact-text-anchor-not-found' };
    const range = document.createRange();
    range.setStart(resolved.node, resolved.offset);
    range.collapse(true);
    const marker = document.createElement('span');
    marker.className = 'janima-autocg-anchor-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.dataset.anchorScore = String(resolved.score || 0);
    range.insertNode(marker);
    const block = insertionBlock(marker, root);
    const key = spec.rawStart ?? resolved.matchedText;
    const prior = previousByKey.get(key);
    const anchor = prior?.isConnected ? prior : block;
    anchor.insertAdjacentElement('afterend', slot);
    previousByKey.set(key, slot);
    return { inserted: true, marker, block, score: resolved.score };
}

export function clearAnchorArtifacts(root) {
    root?.querySelectorAll?.('.janima-autocg-anchor-marker, .janima-autocg-anchor-errors')?.forEach(node => node.remove());
}
