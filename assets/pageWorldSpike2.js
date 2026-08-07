"use strict";
// -- Path A: page-world blob worker -----------------------------------------
//
// Runs as a real injected page script (not a content script), so it carries
// the page's own origin and CSP. Fetches the production worker from its
// extension URL, rewrites its relative import to a blob URL, wraps the
// result in a Trusted Types policy, and spawns it as a module worker. This
// file has no chrome.* access; the isolated-world content script hands it
// the extension's base URL over window.postMessage.
//
// Kept free of imports so tsc emits it as a classic script, matching how
// this file is loaded: a plain <script src> tag, not type="module". The
// whole body is wrapped in an IIFE, matching pageWorld.js, so none of these
// names leak into the page's shared global scope.
(function () {
    const READY_TYPE = "blk-spike2-page-ready";
    const BASE_URL_TYPE = "blk-spike2-base-url";
    const DONE_TYPE = "blk-spike2-path-a-done";
    const WORKER_TIMEOUT_MS = 15000;
    const ALL_STEPS = [
        "trustedTypesPolicy",
        "workerSourceFetched",
        "blobWorkerConstructed",
        "workerPing",
        "ortWasmLoaded",
        "webgpuSession",
    ];
    const reportedSteps = new Set();
    // -- Message helpers ----------------------------------------------------
    function isBaseUrlMessage(data) {
        return (typeof data === "object" &&
            data !== null &&
            data.type === BASE_URL_TYPE &&
            typeof data.baseUrl === "string");
    }
    function reportStep(step, ok, error) {
        reportedSteps.add(step);
        const message = { type: "blk-spike2-step", path: "A", step, ok };
        if (error !== undefined)
            message.error = error;
        window.postMessage(message, "*");
    }
    function reportRemainingAsFailed(error) {
        for (const step of ALL_STEPS) {
            if (!reportedSteps.has(step))
                reportStep(step, false, error);
        }
    }
    function toErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
    }
    function describeWorkerError(event) {
        const message = event.message.length > 0 ? event.message : "(empty message)";
        return `ErrorEvent message="${message}" filename="${event.filename}" lineno=${event.lineno}`;
    }
    function describeMessageError(event) {
        return `messageerror origin="${event.origin}"`;
    }
    // -- Trusted Types blob worker construction ------------------------------
    async function buildTrustedWorkerUrl(baseUrl) {
        const factory = window.trustedTypes;
        if (!factory)
            throw new Error("window.trustedTypes is unavailable");
        const policy = factory.createPolicy(`blk-spike2-${crypto.randomUUID()}`, {
            createScriptURL: (input) => input,
        });
        reportStep("trustedTypesPolicy", true);
        const protocolResponse = await fetch(`${baseUrl}assets/protocol.js`);
        if (!protocolResponse.ok)
            throw new Error(`protocol.js fetch failed: ${protocolResponse.status}`);
        const protocolSource = await protocolResponse.text();
        const separatorResponse = await fetch(`${baseUrl}assets/separator.js`);
        if (!separatorResponse.ok)
            throw new Error(`separator.js fetch failed: ${separatorResponse.status}`);
        const separatorSource = await separatorResponse.text();
        reportStep("workerSourceFetched", true);
        const protocolBlobUrl = URL.createObjectURL(new Blob([protocolSource], { type: "text/javascript" }));
        const rewrittenSeparatorSource = separatorSource.replace('"./protocol.js"', `"${protocolBlobUrl}"`);
        if (rewrittenSeparatorSource === separatorSource) {
            throw new Error('separator.js import rewrite found no match for "./protocol.js"');
        }
        const separatorBlobUrl = URL.createObjectURL(new Blob([rewrittenSeparatorSource], { type: "text/javascript" }));
        return policy.createScriptURL(separatorBlobUrl);
    }
    function constructWorkerFromTrustedUrl(url) {
        // The Worker(TrustedScriptURL) overload from the CSP spec is missing from
        // TypeScript's bundled DOM lib, which only types scriptURL as string | URL.
        const WorkerCtor = Worker;
        return new WorkerCtor(url, { type: "module" });
    }
    // -- Worker round trip ----------------------------------------------------
    function runWorkerRoundTrip(trustedUrl, baseUrl) {
        return new Promise(resolve => {
            let worker;
            try {
                worker = constructWorkerFromTrustedUrl(trustedUrl);
                reportStep("blobWorkerConstructed", true);
            }
            catch (error) {
                reportRemainingAsFailed(toErrorMessage(error));
                resolve();
                return;
            }
            let settled = false;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                worker.terminate();
                resolve();
            };
            worker.addEventListener("error", event => {
                if (settled)
                    return;
                reportRemainingAsFailed(describeWorkerError(event));
                finish();
            });
            worker.addEventListener("messageerror", event => {
                if (settled)
                    return;
                reportRemainingAsFailed(describeMessageError(event));
                finish();
            });
            worker.addEventListener("message", event => {
                if (settled)
                    return;
                const data = event.data;
                reportStep("workerPing", true);
                if (typeof data !== "object" || data === null || data.type !== "result")
                    return;
                const result = data;
                if (result.ortLoaded === true) {
                    reportStep("ortWasmLoaded", true);
                }
                else {
                    reportStep("ortWasmLoaded", false, typeof result.ortError === "string" ? result.ortError : "ORT did not load");
                }
                if (result.webgpuSession === true) {
                    reportStep("webgpuSession", true);
                }
                else {
                    reportStep("webgpuSession", false, typeof result.webgpuError === "string" ? result.webgpuError : "webgpu session not built");
                }
                finish();
            });
            worker.postMessage({ type: "load", ortBaseUrl: `${baseUrl}assets/ort/` });
            setTimeout(() => {
                if (settled)
                    return;
                reportRemainingAsFailed("timed out waiting for worker response");
                finish();
            }, WORKER_TIMEOUT_MS);
        });
    }
    // -- Orchestration ----------------------------------------------------------
    async function runPathA(baseUrl) {
        try {
            const trustedUrl = await buildTrustedWorkerUrl(baseUrl);
            await runWorkerRoundTrip(trustedUrl, baseUrl);
        }
        catch (error) {
            reportRemainingAsFailed(`unhandled: ${toErrorMessage(error)}`);
        }
    }
    window.addEventListener("message", event => {
        if (event.source !== window)
            return;
        const data = event.data;
        if (!isBaseUrlMessage(data))
            return;
        runPathA(data.baseUrl).finally(() => {
            window.postMessage({ type: DONE_TYPE }, "*");
        });
    });
    window.postMessage({ type: READY_TYPE }, "*");
})();
