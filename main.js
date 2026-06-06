var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DropboxUploaderPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var ConfirmDeleteModal = class extends import_obsidian.Modal {
  constructor(app, imageName, onConfirm) {
    super(app);
    this.imageName = imageName;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Delete from Dropbox?" });
    const text = `The image "${this.imageName}" was removed from the note. Do you want to permanently delete it from your Dropbox as well?`;
    contentEl.createEl("p", { text });
    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const confirmButton = buttonContainer.createEl("button", { text: "Yes, Delete It", cls: "mod-cta" });
    confirmButton.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
    const cancelButton = buttonContainer.createEl("button", { text: "No, Keep It" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DEFAULT_SETTINGS = {
  dropboxToken: "",
  dropboxFolderPath: "ObsidianUploads",
  deleteLocalFile: true
};
var DROPBOX_LINK_REGEX = /!\[.*?\]\((https:\/\/dl\.dropboxusercontent\.com\/s\/[^/]+\/([^?#&/]+))[?#&_=\w-]*\)/g;
var DropboxUploaderPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.activeNoteImageCache = /* @__PURE__ */ new Map();
    this.currentActiveFile = null;
    this.editorChangeTimeout = null;
    this.pendingDeletions = /* @__PURE__ */ new Set();
    this.isReplacingLink = false;
    this.uploadedImages = /* @__PURE__ */ new Map();
  }
  // Maps original filename to timestamped filename
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new DropboxUploaderSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof import_obsidian.TFile) {
            this.handleFileCreate(file);
          }
        })
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (file instanceof import_obsidian.TFile && file.extension === "md") {
            this.handleNoteDelete(file);
          }
        })
      );
      this.registerEvent(
        this.app.workspace.on("editor-change", (editor, view) => {
          this.handleEditorChangeDebounced(editor, view);
        })
      );
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", (leaf) => {
          this.handleActiveFileChange();
        })
      );
      this.handleActiveFileChange();
      new import_obsidian.Notice("Dropbox Uploader event listeners are now active.");
    });
    new import_obsidian.Notice("Dropbox Uploader plugin loaded.");
  }
  onunload() {
    if (this.editorChangeTimeout) {
      clearTimeout(this.editorChangeTimeout);
    }
    this.activeNoteImageCache.clear();
    this.pendingDeletions.clear();
    this.uploadedImages.clear();
    new import_obsidian.Notice("Dropbox Uploader plugin unloaded.");
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  handleEditorChangeDebounced(editor, view) {
    if (this.editorChangeTimeout) {
      clearTimeout(this.editorChangeTimeout);
    }
    this.editorChangeTimeout = setTimeout(() => {
      this.handleEditorChange(editor, view);
    }, 3e3);
  }
  getDropboxLinks(content) {
    const links = /* @__PURE__ */ new Set();
    const matches = content.matchAll(DROPBOX_LINK_REGEX);
    for (const match of matches) {
      if (match[2]) {
        const filename = match[2];
        links.add(filename);
      }
    }
    return links;
  }
  handleActiveFileChange() {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!activeView || !activeView.file) {
      this.currentActiveFile = null;
      return;
    }
    const filePath = activeView.file.path;
    if (this.currentActiveFile !== filePath) {
      this.currentActiveFile = filePath;
      const content = activeView.editor.getValue();
      const images = this.getDropboxLinks(content);
      this.activeNoteImageCache.set(filePath, images);
    }
  }
  async handleEditorChange(editor, view) {
    if (!view.file || this.isReplacingLink)
      return;
    const filePath = view.file.path;
    const currentImages = this.getDropboxLinks(editor.getValue());
    const cachedImages = this.activeNoteImageCache.get(filePath) || /* @__PURE__ */ new Set();
    const removedImages = Array.from(cachedImages).filter((img) => !currentImages.has(img));
    for (const removedImage of removedImages) {
      if (!this.pendingDeletions.has(removedImage)) {
        this.pendingDeletions.add(removedImage);
        new ConfirmDeleteModal(this.app, removedImage, () => {
          this.deleteFromDropbox(removedImage);
          this.pendingDeletions.delete(removedImage);
        }).open();
      }
    }
    this.activeNoteImageCache.set(filePath, currentImages);
  }
  async handleNoteDelete(note) {
    const filePath = note.path;
    const imagesInDeletedNote = this.activeNoteImageCache.get(filePath) || /* @__PURE__ */ new Set();
    if (imagesInDeletedNote.size > 0) {
      const imageList = Array.from(imagesInDeletedNote).join(", ");
      new import_obsidian.Notice(
        `Note "${note.basename}" deleted. The following images may need cleanup from Dropbox: ${imageList}`,
        15e3
      );
    }
    this.activeNoteImageCache.delete(filePath);
  }
  async deleteFromDropbox(fileName) {
    var _a, _b, _c;
    if (!this.settings.dropboxToken)
      return;
    try {
      const dropboxPath = `/${this.settings.dropboxFolderPath}/${fileName}`;
      const response = await (0, import_obsidian.requestUrl)({
        url: "https://api.dropboxapi.com/2/files/delete_v2",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.settings.dropboxToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path: dropboxPath })
      });
      if (response.status >= 200 && response.status < 300) {
        new import_obsidian.Notice(`Successfully deleted ${fileName} from Dropbox.`, 3e3);
      } else {
        const errorData = response.json;
        if (((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a[".tag"]) === "path_lookup" && ((_c = (_b = errorData == null ? void 0 : errorData.error) == null ? void 0 : _b.path_lookup) == null ? void 0 : _c[".tag"]) === "not_found") {
          new import_obsidian.Notice(`${fileName} was not found in Dropbox.`, 3e3);
        } else {
          throw new Error(JSON.stringify(errorData));
        }
      }
    } catch (error) {
      console.error("Dropbox Delete Error:", error);
      new import_obsidian.Notice(`Error deleting ${fileName} from Dropbox: ${error.message}`, 7e3);
    }
  }
  async handleFileCreate(file) {
    var _a;
    if (!this.settings.dropboxToken)
      return;
    const imageExtensions = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];
    if (!imageExtensions.includes(file.extension.toLowerCase()))
      return;
    await new Promise((resolve) => setTimeout(resolve, 500));
    new import_obsidian.Notice(`Uploading ${file.name} to Dropbox...`);
    try {
      const fileContent = await this.app.vault.readBinary(file);
      const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      const newFileName = `${timestamp}-${file.name}`;
      const dropboxPath = `/${this.settings.dropboxFolderPath}/${newFileName}`;
      const uploadResponse = await (0, import_obsidian.requestUrl)({
        url: "https://content.dropboxapi.com/2/files/upload",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.settings.dropboxToken}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath, mode: "add", autorename: true, mute: false })
        },
        body: fileContent
      });
      if (uploadResponse.status < 200 || uploadResponse.status >= 300)
        throw new Error(uploadResponse.text);
      const uploadData = uploadResponse.json;
      const shareResponse = await (0, import_obsidian.requestUrl)({
        url: "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
        method: "POST",
        headers: { "Authorization": `Bearer ${this.settings.dropboxToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path: uploadData.path_display, settings: { requested_visibility: "public" } })
      });
      let shareData;
      if (shareResponse.status >= 200 && shareResponse.status < 300) {
        shareData = shareResponse.json;
      } else {
        const errorData = shareResponse.json;
        if (((_a = errorData == null ? void 0 : errorData.error) == null ? void 0 : _a[".tag"]) === "shared_link_already_exists") {
          const listResponse = await (0, import_obsidian.requestUrl)({
            url: "https://api.dropboxapi.com/2/sharing/list_shared_links",
            method: "POST",
            headers: { "Authorization": `Bearer ${this.settings.dropboxToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ path: uploadData.path_display })
          });
          if (listResponse.status >= 200 && listResponse.status < 300) {
            const listData = listResponse.json;
            if (listData.links && listData.links.length > 0)
              shareData = listData.links[0];
          }
        }
        if (!shareData)
          throw new Error(JSON.stringify(errorData));
      }
      const directUrl = shareData.url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace("?dl=0", "");
      this.replaceLinkInEditor(file.name, newFileName, directUrl);
      if (this.settings.deleteLocalFile)
        await this.app.vault.delete(file);
      new import_obsidian.Notice(`${file.name} successfully uploaded and linked!`, 4e3);
    } catch (error) {
      console.error("Dropbox Upload Error:", error);
      new import_obsidian.Notice(`Error uploading to Dropbox: ${error.message}`, 1e4);
    }
  }
  // FIX 2: This function is now clean, with the copy-paste error removed.
  replaceLinkInEditor(originalFileName, newFileName, newUrl) {
    const markdownView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!markdownView)
      return;
    this.isReplacingLink = true;
    const editor = markdownView.editor;
    const content = editor.getValue();
    const escapedFileName = originalFileName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const localLinkRegex = new RegExp(`!\\[\\[${escapedFileName}\\]\\]`, "g");
    if (localLinkRegex.test(content)) {
      const newContent = content.replace(localLinkRegex, `![${originalFileName}](${newUrl})`);
      if (newContent !== content) {
        editor.setValue(newContent);
        if (markdownView.file) {
          const filePath = markdownView.file.path;
          const currentCache = this.activeNoteImageCache.get(filePath) || /* @__PURE__ */ new Set();
          currentCache.add(newFileName);
          this.activeNoteImageCache.set(filePath, currentCache);
        }
      }
      if (markdownView.file) {
        const filePath = markdownView.file.path;
        const currentCache = this.activeNoteImageCache.get(filePath) || /* @__PURE__ */ new Set();
        currentCache.add(newFileName);
        this.activeNoteImageCache.set(filePath, currentCache);
      }
    }
    setTimeout(() => {
      this.isReplacingLink = false;
    }, 500);
  }
};
var DropboxUploaderSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Dropbox Uploader Settings" });
    containerEl.createEl("p", {
      text: "This plugin automatically uploads images to Dropbox and replaces local links with Dropbox URLs. When you remove images from notes, you'll be prompted to delete them from Dropbox as well."
    });
    new import_obsidian.Setting(containerEl).setName("Dropbox Access Token").setDesc("Generate this from the Dropbox App Console. Keep this secret.").addText((text) => text.setPlaceholder("Enter your token").setValue(this.plugin.settings.dropboxToken).onChange(async (value) => {
      this.plugin.settings.dropboxToken = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Dropbox Folder Path").setDesc("The folder inside your Dropbox app folder where images will be stored.").addText((text) => text.setPlaceholder("e.g., ObsidianUploads").setValue(this.plugin.settings.dropboxFolderPath).onChange(async (value) => {
      this.plugin.settings.dropboxFolderPath = value.trim() || "ObsidianUploads";
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Delete local file after upload").setDesc("If enabled, the original image file will be deleted from your vault after a successful upload.").addToggle((toggle) => toggle.setValue(this.plugin.settings.deleteLocalFile).onChange(async (value) => {
      this.plugin.settings.deleteLocalFile = value;
      await this.plugin.saveSettings();
    }));
  }
};
