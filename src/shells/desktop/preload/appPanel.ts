// Preload of a custom panel's webview (spec 008). Jalon 1: the page gets
// nothing from Cate, no `window.cate`, no `cateDesktop`, no Node. The bridge
// of jalon 2 is exposed from here. It stays self-contained: the sandboxed
// preload loader cannot require a shared chunk (preload.test.ts).

export {}
