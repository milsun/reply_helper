async function captureVisibleTab() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png'
    });
    return dataUrl;
  } catch (err) {
    console.error('Capture error:', err);
    throw new Error('Could not capture screenshot. Refresh the page and try again.');
  }
}

function optimizeImage(dataUrl, options = {}) {
  const {
    maxWidth = 1920,
    maxHeight = 1080,
    quality = 0.85,
    maxSizeBytes = 5 * 1024 * 1024
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Failed to load screenshot for optimization.'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      const scale = Math.min(
        maxWidth / width,
        maxHeight / height,
        1
      );
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let jpegQuality = quality;
      let result = canvas.toDataURL('image/jpeg', jpegQuality);

      while (result.length > maxSizeBytes && jpegQuality > 0.1) {
        jpegQuality -= 0.1;
        result = canvas.toDataURL('image/jpeg', jpegQuality);
      }

      resolve({
        dataUrl: result,
        width: canvas.width,
        height: canvas.height,
        sizeBytes: result.length,
        quality: jpegQuality
      });
    };
    img.src = dataUrl;
  });
}

function dataUrlToBase64(dataUrl) {
  return dataUrl.split(',')[1];
}
