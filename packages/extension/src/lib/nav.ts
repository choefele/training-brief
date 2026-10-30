/** Opening the extension's own pages. Works from the service worker and from extension pages. */

const pageUrl = (page: string): string => chrome.runtime.getURL(page);

/** Focuses an open tab of the page, or opens a new one. */
export async function openPage(page: 'dashboard.html' | 'options.html', hash = ''): Promise<void> {
  const url = pageUrl(page);
  const [existing] = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url, `${url}#dashboard`, `${url}#activities`, `${url}#export`] });
  if (existing && existing.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true, ...(hash ? { url: `${url}#${hash}` } : {}) });
    if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: hash ? `${url}#${hash}` : url });
}

export const openDashboard = (view = ''): Promise<void> => openPage('dashboard.html', view);
export const openSettings = (): Promise<void> => openPage('options.html');
