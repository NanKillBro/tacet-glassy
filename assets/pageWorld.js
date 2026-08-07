(function () {
  const TRANSFER_TYPE = "blk-spike-transfer";
  const TRANSFER_OK_TYPE = "blk-spike-transfer-ok";
  const READY_TYPE = "blk-spike-page-ready";

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== TRANSFER_TYPE) return;

    const floats = data.payload;
    let intact = floats instanceof Float32Array && floats.length === 256;
    if (intact) {
      for (let i = 0; i < 256; i++) {
        if (floats[i] !== i * 0.5) {
          intact = false;
          break;
        }
      }
    }

    window.postMessage({ type: TRANSFER_OK_TYPE, intact }, "*");
  });

  window.postMessage({ type: READY_TYPE }, "*");
})();
