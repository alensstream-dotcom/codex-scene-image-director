/** Story wardrobe is mutable state, separate from the appearance prototype. */
const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const garment = /\b(?:dress|gown|shirt|t-shirt|blouse|top|sweater|jacket|coat|cardigan|robe|skirt|shorts|pants|trousers|jeans|leggings|tights|stockings|shoes|heels|boots|sandals|sneakers|uniform|suit|swimsuit|bikini)\b/i;
const lower = /\b(?:skirt|shorts|pants|trousers|jeans|leggings|tights|stockings|shoes|heels|boots|sandals|sneakers)\b/i;
const clothingKey = value => JSON.stringify(value ?? null);

export function inferClothing(scene) {
    const text = String(scene).split(/;\s*(?:###|$)/)[0];
    const matches = [...text.matchAll(/\b(?:wearing|dressed in|clad in|changed into|changes into)\s+([^.;\n]+)/gi), ...text.matchAll(/\bin\s+([^.;\n]+)/gi)];
    for (const match of matches) {
        const parts = match[1].split(/,\s*/);
        if (!garment.test(parts[0])) continue;
        const selected = parts.filter(part => garment.test(part) && !/\b(?:holding|carrying|gripping|looking|gazing|stands|sits|walks)\b/i.test(part));
        const description = normalize(selected.join(', ')).replace(/^(?:her|his|an?|the)\s+/i, '');
        if (description) return description;
    }
    return '';
}

export function wardrobeText(wardrobe, { back=false } = {}) {
    if (back && wardrobe?.manager_fields) return [...new Set([wardrobe.manager_fields.upperBodyBack, wardrobe.manager_fields.fullBodyBack].filter(Boolean))].join(', ');
    return [...new Set([wardrobe?.description, ...(wardrobe?.tags || [])].filter(Boolean))].join(', ');
}

export function garmentFields(wardrobe) {
    if (wardrobe?.manager_fields) return { ...wardrobe.manager_fields };
    const text = wardrobeText(wardrobe), upper = [], bottom = [];
    for (const part of text.split(/,\s*|\s+and\s+/i).filter(Boolean)) {
        (lower.test(part) && !/\b(?:dress|gown|robe|uniform|suit)\b/i.test(part) ? bottom : upper).push(part);
    }
    return { upperBody:upper.join(', '), upperBodyBack:upper.join(', '), fullBody:bottom.join(', '), fullBodyBack:bottom.join(', ') };
}

export function resolveWardrobe(previous, spec, scene, selectedOutfit) {
    let current = previous ? structuredClone(previous) : null;
    const control = spec.clothing;
    const warnings = [];
    if (control !== undefined && (!control || typeof control !== 'object' || Array.isArray(control)))
        return { wardrobe:current, changed:false, warnings:['clothing must be an object'] };
    const action = control?.action || (spec.outfit ? 'change' : 'keep');
    if (!['keep', 'initial', 'change'].includes(action))
        return { wardrobe:current, changed:false, warnings:['clothing.action must be keep, initial, or change'] };
    // Explicit outfit selection remains an intentional change, not a hidden reroll.
    const mayReplace = !current || action === 'change';
    if (mayReplace) {
        const description = normalize(control?.description || inferClothing(scene));
        const tags = control?.tags ?? selectedOutfit?.prepared.outfit_tags ?? [];
        if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string') || /[;{}@]/.test(description) || tags.some(tag => /[;{}@]/.test(tag)))
            return { wardrobe:current, changed:false, warnings:['clothing description/tags contain invalid control syntax'] };
        if (description || tags.length) current = { version:1, description, tags:[...new Set(tags.map(normalize).filter(Boolean))], outfit_id:selectedOutfit?.id || null, source:selectedOutfit ? 'catalog' : 'story' };
        else if (action === 'change') warnings.push('A clothing change needs a complete new outfit description or matching outfit query; previous outfit retained');
    }
    return { wardrobe:current, changed:clothingKey(current) !== clothingKey(previous), warnings };
}

export function bootstrapWardrobes(state, messages, readControls) {
    const next = structuredClone(state);
    const needs = new Set(Object.values(next.people || {}).filter(person => !person.wardrobe && person.scope === next.scope).map(person => person.person));
    let changed = false;
    for (const message of messages || []) {
        if (message.is_user) continue;
        for (const block of String(message.mes || '').matchAll(/image###([\s\S]*?)###/g)) {
            const controls = readControls(block[1]);
            for (const [index, marker] of controls.entries()) {
                const entry = Object.values(next.people || {}).find(person => person.scope === next.scope && person.person === marker.spec.person);
                if (!entry || !needs.has(entry.person)) continue;
                const scene = block[1].slice(marker.end, controls[index + 1]?.start);
                const legacyChange = /\b(?:changed|changes|switched|switches)\s+(?:into|to)\b/i.test(scene);
                const spec = legacyChange && !marker.spec.clothing ? { ...marker.spec, clothing:{action:'change'} } : marker.spec;
                const result = resolveWardrobe(entry.wardrobe || null, spec, scene, null);
                if (result.changed) { entry.wardrobe = result.wardrobe; changed = true; }
            }
        }
    }
    return { state:next, changed };
}
