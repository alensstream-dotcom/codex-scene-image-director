export class ComfyHttpError extends Error {
    constructor(message, { status = 0, body = '', url = '' } = {}) {
        super(message);
        this.name = 'ComfyHttpError';
        this.status = status;
        this.body = body;
        this.url = url;
    }
}

export function normalizeComfyUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('请先填写 ComfyUI 地址');
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error(`ComfyUI 地址无效：${raw}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('ComfyUI 地址必须以 http:// 或 https:// 开头');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
}

function abortError(reason = 'aborted') {
    return new DOMException(String(reason || 'aborted'), 'AbortError');
}

function combinedController(parentSignal, timeoutMs) {
    const controller = new AbortController();
    let timer = null;
    const onAbort = () => controller.abort(parentSignal?.reason || 'aborted');
    if (parentSignal) {
        if (parentSignal.aborted) controller.abort(parentSignal.reason || 'aborted');
        else parentSignal.addEventListener('abort', onAbort, { once: true });
    }
    if (Number(timeoutMs) > 0) timer = setTimeout(() => controller.abort('request-timeout'), Number(timeoutMs));
    return {
        controller,
        cleanup() {
            if (timer) clearTimeout(timer);
            parentSignal?.removeEventListener?.('abort', onAbort);
        },
    };
}

async function readResponseBody(response) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); }
    catch { return text; }
}

export async function fetchComfyJson(url, options = {}, {
    fetchImpl = globalThis.fetch,
    timeoutMs = 12000,
    signal,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('当前浏览器不支持 fetch');
    const guard = combinedController(signal, timeoutMs);
    try {
        const response = await fetchImpl(url, { ...options, signal: guard.controller.signal });
        const body = await readResponseBody(response);
        if (!response.ok) {
            const details = typeof body === 'string' ? body : JSON.stringify(body || {});
            throw new ComfyHttpError(`ComfyUI HTTP ${response.status}${details ? `：${details.slice(0, 500)}` : ''}`, {
                status: response.status,
                body: details,
                url,
            });
        }
        return body;
    } catch (error) {
        if (guard.controller.signal.aborted && error?.name !== 'AbortError') throw abortError(guard.controller.signal.reason);
        throw error;
    } finally {
        guard.cleanup();
    }
}

export async function pingComfyNative(baseUrl, options = {}) {
    const base = normalizeComfyUrl(baseUrl);
    const attempts = ['/system_stats', '/system/stats', '/object_info'];
    const errors = [];
    for (const path of attempts) {
        try {
            await fetchComfyJson(`${base}${path}`, { method: 'GET' }, options);
            return { ok: true, endpoint: path };
        } catch (error) {
            errors.push(`${path}: ${error?.message || error}`);
            if (error?.name === 'AbortError') throw error;
        }
    }
    throw new Error(`无法连接 ComfyUI。已尝试 ${attempts.join('、')}。${errors.join(' | ')}`);
}

export async function submitComfyPrompt(baseUrl, workflow, {
    clientId = '',
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = 15000,
} = {}) {
    const base = normalizeComfyUrl(baseUrl);
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('ComfyUI 工作流无效');
    const body = {
        prompt: workflow,
        client_id: clientId || globalThis.crypto?.randomUUID?.() || `janima-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    const result = await fetchComfyJson(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, { fetchImpl, signal, timeoutMs });
    const promptId = String(result?.prompt_id || '').trim();
    if (!promptId) {
        const nodeErrors = result?.node_errors ? JSON.stringify(result.node_errors).slice(0, 800) : '';
        throw new Error(`ComfyUI 没有返回 prompt_id${nodeErrors ? `：${nodeErrors}` : ''}`);
    }
    return { promptId, number: result?.number, nodeErrors: result?.node_errors || {} };
}

export function historyEntry(payload, promptId) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload[promptId]) return payload[promptId];
    if (payload.prompt_id === promptId || payload.outputs || payload.status) return payload;
    const first = Object.values(payload).find(value => value && typeof value === 'object' && (value.outputs || value.status));
    return first || null;
}

export function historyFailure(entry) {
    const status = entry?.status;
    if (!status) return '';
    const statusText = String(status.status_str || status.status || '').toLowerCase();
    if (statusText === 'error' || statusText === 'failed') return `ComfyUI 任务失败：${status.status_str || status.status}`;
    const messages = Array.isArray(status.messages) ? status.messages : [];
    const executionError = messages.find(item => Array.isArray(item) && item[0] === 'execution_error');
    if (executionError) return `ComfyUI 执行错误：${JSON.stringify(executionError[1] || {}).slice(0, 800)}`;
    return '';
}

export function extractHistoryImages(payload, promptId) {
    const entry = historyEntry(payload, promptId);
    const outputs = entry?.outputs;
    if (!outputs || typeof outputs !== 'object') return [];
    const images = [];
    for (const [nodeId, output] of Object.entries(outputs)) {
        for (const image of output?.images || []) {
            if (!image?.filename) continue;
            images.push({
                nodeId,
                filename: String(image.filename),
                subfolder: String(image.subfolder || ''),
                type: String(image.type || 'output'),
            });
        }
    }
    return images;
}

export function buildComfyViewUrl(baseUrl, image) {
    const base = normalizeComfyUrl(baseUrl);
    if (!image?.filename) throw new Error('图片输出缺少 filename');
    const params = new URLSearchParams({
        filename: String(image.filename),
        subfolder: String(image.subfolder || ''),
        type: String(image.type || 'output'),
    });
    return `${base}/view?${params.toString()}`;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError(signal.reason));
        const cleanup = () => signal?.removeEventListener?.('abort', onAbort);
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(abortError(signal.reason));
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

export async function waitForComfyResult(baseUrl, promptId, {
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = 180000,
    pollIntervalMs = 1000,
    requestTimeoutMs = 12000,
    onPoll = null,
} = {}) {
    const base = normalizeComfyUrl(baseUrl);
    const started = Date.now();
    let polls = 0;
    while (Date.now() - started < Math.max(5000, Number(timeoutMs) || 180000)) {
        if (signal?.aborted) throw abortError(signal.reason);
        const payload = await fetchComfyJson(`${base}/history/${encodeURIComponent(promptId)}`, { method: 'GET' }, {
            fetchImpl,
            signal,
            timeoutMs: requestTimeoutMs,
        });
        polls++;
        const entry = historyEntry(payload, promptId);
        const failure = historyFailure(entry);
        if (failure) throw new Error(failure);
        const images = extractHistoryImages(payload, promptId);
        onPoll?.({ polls, elapsedMs: Date.now() - started, entry, images });
        if (images.length) return { entry, images, polls, elapsedMs: Date.now() - started };
        if (entry?.status?.completed === true) throw new Error('ComfyUI 任务已完成，但没有找到 SaveImage 输出');
        await sleep(Math.max(250, Number(pollIntervalMs) || 1000), signal);
    }
    throw new Error(`ComfyUI 生成超时（${Math.round((Date.now() - started) / 1000)} 秒）`);
}
