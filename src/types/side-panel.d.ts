declare namespace chrome.sidePanel {
  function close(options: { windowId: number }): Promise<void>;
}
