await import('./index-v4.js?v=4.1.0');

const VERSION = '4.1.0';

function patchVisibleVersion() {
    document.documentElement.dataset.janimaAutocgVersion = VERSION;
    const header = document.querySelector('#janima_autocg_settings .inline-drawer-header b');
    if (header) header.textContent = header.textContent.replace(/v4\.0\.0/i, `v${VERSION}`);

    const api = globalThis.JANIMA_AUTO_CG;
    if (api && api.version !== VERSION) {
        globalThis.JANIMA_AUTO_CG = Object.freeze({ ...api, version: VERSION });
    }
}

jQuery(() => {
    patchVisibleVersion();
    setTimeout(patchVisibleVersion, 100);
    setTimeout(patchVisibleVersion, 600);
});

console.info(`[JANIMA Galgame 自动CG] v${VERSION} hardening layer loaded`);
