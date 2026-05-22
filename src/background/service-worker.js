chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-suggest') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      try {
        const tab = tabs[0];
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png'
        });

        await chrome.storage.local.set({
          pendingCapture: {
            dataUrl,
            timestamp: Date.now(),
            tabId: tab.id
          }
        });

        chrome.action.openPopup();
      } catch (err) {
        console.error('Background capture error:', err);
      }
    }
  }
});
