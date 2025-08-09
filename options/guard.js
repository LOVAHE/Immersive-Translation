(function () {
  const isExt = !!(window.chrome?.runtime?.id || window.browser?.runtime?.id);
  if (isExt) return;
  document.body.innerHTML = `
    <div style="font:14px system-ui; max-width:640px; margin:48px auto; line-height:1.6">
      <h2>Open this page as an Extension</h2>
      <p>This settings page must be loaded inside a browser extension context.</p>
      <ol>
        <li>Chrome: chrome://extensions → Developer mode → Load unpacked → select the folder.</li>
        <li>Firefox: about:debugging → This Firefox → Load Temporary Add-on → select manifest.json.</li>
      </ol>
      <p>Then open the Options page from the extension’s details.</p>
    </div>
  `;
})();
