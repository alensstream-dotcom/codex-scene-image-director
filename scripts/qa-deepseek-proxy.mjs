import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const settingsPath = process.argv[2];
const baseUrl = process.argv[3] || 'http://127.0.0.1:11451';
if (!settingsPath) throw new Error('Usage: node scripts/qa-deepseek-proxy.mjs <settings.json> [sillytavern-url]');

const allSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const director = allSettings.extension_settings?.['st-chatu8']?.codexGalgameDirector;
if (!director?.apiKey) throw new Error('Galgame director API key is not configured');

const csrfResponse = await fetch(`${baseUrl}/csrf-token`);
if (!csrfResponse.ok) throw new Error(`CSRF HTTP ${csrfResponse.status}`);
const csrf = await csrfResponse.json();
const cookie = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const payload = {
    chat_completion_source: 'custom',
    custom_url: director.apiUrl,
    custom_include_headers: `Authorization: "Bearer ${director.apiKey}"`,
    model: director.model,
    messages: [
        { role: 'system', content: 'Return one strict JSON object only.' },
        { role: 'user', content: 'Return {"ok":true,"service":"director"}' },
    ],
    temperature: 0.1,
    top_p: 0.9,
    max_tokens: 64,
    stream: false,
    response_format: { type: 'json_object' },
};

const started = performance.now();
const response = await fetch(`${baseUrl}/api/backends/chat-completions/generate`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf.token,
        Cookie: cookie,
    },
    body: JSON.stringify(payload),
});
const raw = await response.text();
let content = '';
try {
    const data = JSON.parse(raw);
    content = data?.choices?.[0]?.message?.content ?? data?.content ?? '';
} catch {
    // The response body is intentionally not echoed because it may contain
    // upstream diagnostics. The summarized result below is enough for QA.
}
console.log(JSON.stringify({
    status: response.status,
    elapsedMs: Math.round(performance.now() - started),
    contentLength: content.length,
    returnedJson: content.trim().startsWith('{'),
}));
if (!response.ok || !content) process.exitCode = 1;

