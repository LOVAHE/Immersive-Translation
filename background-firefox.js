# Please rename to background.js for Firefox

console.log('Background script loaded');

function createContextMenus() {
  console.log('Creating context menu...');
  const api = typeof browser !== 'undefined' ? browser : chrome;
  
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: "translate-selection",
      title: "Translate",
      contexts: ["selection"]
    });
    api.contextMenus.create({
      id: "translate-page",
      title: "Translate Page",
      contexts: ["page"]
    });
  });
  
  console.log('Context menu created');
}

const api = typeof browser !== 'undefined' ? browser : chrome;
api.contextMenus.onClicked.addListener((info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);
  if (info.menuItemId === "translate-selection") {
    console.log('Sending translateSelection message...');
    api.tabs.sendMessage(tab.id, {
      action: "translateSelection",
      text: info.selectionText
    });
  }
  if (info.menuItemId === "translate-page") {
    console.log('Sending translatePage message...');
    api.tabs.sendMessage(tab.id, {
      action: "translatePage"
    });
  }
});

createContextMenus();
