/** Load the same editable JSON on WebViews and in Node regression tests. */
const url=new URL('./worldbook-rules.json',import.meta.url);
export const DEFAULT_DRAWING_RULES=url.protocol==='file:'&&typeof window==='undefined'
    ? JSON.parse(await(await import('node:fs/promises')).readFile(url,'utf8'))
    : await(await fetch(url)).json();
