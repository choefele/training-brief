import { openDashboard } from './lib/nav.ts';

// The toolbar icon opens the side panel. Nothing here loads data: Garmin is only called when the user asks.

const MENU_DASHBOARD = 'open-dashboard';
const MENU_SIDE_PANEL = 'open-side-panel';

chrome.runtime.onInstalled.addListener(details => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_DASHBOARD, title: 'Open dashboard', contexts: ['action'] });
    chrome.contextMenus.create({ id: MENU_SIDE_PANEL, title: 'Open side panel', contexts: ['action'] });
  });
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void openDashboard();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_DASHBOARD) void openDashboard();
  // Must run synchronously inside the click to keep the user gesture.
  if (info.menuItemId === MENU_SIDE_PANEL && tab?.windowId != null) void chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener(command => {
  if (command === 'open-dashboard') void openDashboard();
});
