# Please rename to background.js for Chrome

console.log('Background script loaded');

function createContextMenus() {
  console.log('Creating context menu...');
  
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "translate-selection",
      title: "Translate",
      contexts: ["selection"]
    });
    
    chrome.contextMenus.create({
      id: "translate-page",
      title: "Translate Page",
      contexts: ["page"]
    });
  });
  
  console.log('Context menu created');
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('Context menu clicked:', info.menuItemId);
  if (info.menuItemId === "translate-selection") {
    console.log('Sending translateSelection message...');
    chrome.tabs.sendMessage(tab.id, {
      action: "translateSelection",
      text: info.selectionText
    });
  }
  if (info.menuItemId === "translate-page") {
    console.log('Sending translatePage message...');
    chrome.tabs.sendMessage(tab.id, {
      action: "translatePage"
    });
  }
});

createContextMenus();
