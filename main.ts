import { App, Editor, Notice, Plugin, PluginSettingTab, Setting, TFile,
         TAbstractFile, MarkdownView, Modal, requestUrl } from 'obsidian';

// A Modal class for the confirmation pop-up
class ConfirmDeleteModal extends Modal {
    constructor(app: App, private imageName: string, private onConfirm: () => void) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Delete from Dropbox?' });
        const text = `The image "${this.imageName}" was removed from the note. Do you want to permanently delete it from your Dropbox as well?`;
        contentEl.createEl('p', { text });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const confirmButton = buttonContainer.createEl('button', { text: 'Yes, Delete It', cls: 'mod-cta' });
        confirmButton.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });

        const cancelButton = buttonContainer.createEl('button', { text: 'No, Keep It' });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

// Settings interface
interface DropboxUploaderSettings {
    dropboxToken: string;
    dropboxFolderPath: string;
    deleteLocalFile: boolean;
}

// Default settings
const DEFAULT_SETTINGS: DropboxUploaderSettings = {
    dropboxToken: '',
    dropboxFolderPath: 'ObsidianUploads',
    deleteLocalFile: true,
}

// Regex to find Dropbox image links in markdown - captures the full URL and the filename
const DROPBOX_LINK_REGEX = /!\[.*?\]\((https:\/\/dl\.dropboxusercontent\.com\/s\/[^/]+\/([^?#&/]+))[?#&_=\w-]*\)/g;

export default class DropboxUploaderPlugin extends Plugin {
    settings: DropboxUploaderSettings;
    private activeNoteImageCache: Map<string, Set<string>> = new Map();
    private currentActiveFile: string | null = null;
    private editorChangeTimeout: NodeJS.Timeout | null = null;
    private pendingDeletions: Set<string> = new Set();
    private isReplacingLink: boolean = false;
    private uploadedImages: Map<string, string> = new Map(); // Maps original filename to timestamped filename

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new DropboxUploaderSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(() => {
            this.registerEvent(
                this.app.vault.on('create', (file: TAbstractFile) => {
                    if (file instanceof TFile) {
                        this.handleFileCreate(file);
                    }
                })
            );

            this.registerEvent(
                this.app.vault.on('delete', (file: TAbstractFile) => {
                    if (file instanceof TFile && file.extension === 'md') {
                        this.handleNoteDelete(file);
                    }
                })
            );

            // Use a longer debounce delay for better stability
            this.registerEvent(
                this.app.workspace.on('editor-change', (editor: Editor, view: MarkdownView) => {
                    this.handleEditorChangeDebounced(editor, view);
                })
            );

            this.registerEvent(
                this.app.workspace.on('active-leaf-change', (leaf) => {
                    this.handleActiveFileChange();
                })
            );

            // Initialize cache for current active file
            this.handleActiveFileChange();
            new Notice('Dropbox Uploader event listeners are now active.');
        });

        new Notice('Dropbox Uploader plugin loaded.');
    }

    onunload() {
        if (this.editorChangeTimeout) {
            clearTimeout(this.editorChangeTimeout);
        }
        this.activeNoteImageCache.clear();
        this.pendingDeletions.clear();
        this.uploadedImages.clear();
        new Notice('Dropbox Uploader plugin unloaded.');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private handleEditorChangeDebounced(editor: Editor, view: MarkdownView) {
        if (this.editorChangeTimeout) {
            clearTimeout(this.editorChangeTimeout);
        }

        this.editorChangeTimeout = setTimeout(() => {
            this.handleEditorChange(editor, view);
        }, 3000);
    }

    private getDropboxLinks(content: string): Set<string> {
        const links = new Set<string>();
        const matches = content.matchAll(DROPBOX_LINK_REGEX);
        for (const match of matches) {
            if (match[2]) {
                const filename = match[2];
                links.add(filename);
            }
        }
        return links;
    }

    private handleActiveFileChange() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
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

    private async handleEditorChange(editor: Editor, view: MarkdownView) {
        if (!view.file || this.isReplacingLink) return;
        
        const filePath = view.file.path;
        const currentImages = this.getDropboxLinks(editor.getValue());
        const cachedImages = this.activeNoteImageCache.get(filePath) || new Set<string>();
        
        const removedImages = Array.from(cachedImages).filter(img => !currentImages.has(img));
        
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

    private async handleNoteDelete(note: TFile) {
        const filePath = note.path;
        const imagesInDeletedNote = this.activeNoteImageCache.get(filePath) || new Set<string>();
        
        if (imagesInDeletedNote.size > 0) {
            const imageList = Array.from(imagesInDeletedNote).join(', ');
            new Notice(
                `Note "${note.basename}" deleted. The following images may need cleanup from Dropbox: ${imageList}`,
                15000
            );
        }
        
        this.activeNoteImageCache.delete(filePath);
    }

    private async deleteFromDropbox(fileName: string) {
        if (!this.settings.dropboxToken) return;

        try {
            const dropboxPath = `/${this.settings.dropboxFolderPath}/${fileName}`;
            const response = await requestUrl({
				url: 'https://api.dropboxapi.com/2/files/delete_v2',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.settings.dropboxToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ path: dropboxPath }),
			});

			if (response.status >= 200 && response.status < 300) {
				new Notice(`Successfully deleted ${fileName} from Dropbox.`, 3000);
			} else {
				const errorData = response.json;
				if (errorData?.error?.['.tag'] === 'path_lookup' &&
					errorData?.error?.path_lookup?.['.tag'] === 'not_found') {
					new Notice(`${fileName} was not found in Dropbox.`, 3000);
				} else {
					throw new Error(JSON.stringify(errorData));
				}
			}
        } catch (error) {
            console.error('Dropbox Delete Error:', error);
            new Notice(`Error deleting ${fileName} from Dropbox: ${error.message}`, 7000);
        }
    }

    async handleFileCreate(file: TFile) {
		if (!this.settings.dropboxToken) return;

		const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
		if (!imageExtensions.includes(file.extension.toLowerCase())) return;

		// Wait for Obsidian to finish writing the file
		await new Promise(resolve => setTimeout(resolve, 500));

		new Notice(`Uploading ${file.name} to Dropbox...`);

		try {
			const fileContent = await this.app.vault.readBinary(file);
			const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
            const newFileName = `${timestamp}-${file.name}`;
            const dropboxPath = `/${this.settings.dropboxFolderPath}/${newFileName}`;

            const uploadResponse = await requestUrl({
				url: 'https://content.dropboxapi.com/2/files/upload',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.settings.dropboxToken}`,
					'Content-Type': 'application/octet-stream',
					'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'add', autorename: true, mute: false })
				},
				body: fileContent,
			});

			if (uploadResponse.status < 200 || uploadResponse.status >= 300)
				throw new Error(uploadResponse.text);
			const uploadData = uploadResponse.json;

            const shareResponse = await requestUrl({
				url: 'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
				method: 'POST',
				headers: { 'Authorization': `Bearer ${this.settings.dropboxToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ path: uploadData.path_display, settings: { requested_visibility: 'public' } }),
			});

			let shareData;
			if (shareResponse.status >= 200 && shareResponse.status < 300) {
				shareData = shareResponse.json;
			} else {
				const errorData = shareResponse.json;
				if (errorData?.error?.['.tag'] === 'shared_link_already_exists') {
					const listResponse = await requestUrl({
						url: 'https://api.dropboxapi.com/2/sharing/list_shared_links',
						method: 'POST',
						headers: { 'Authorization': `Bearer ${this.settings.dropboxToken}`, 'Content-Type': 'application/json' },
						body: JSON.stringify({ path: uploadData.path_display }),
					});
					if (listResponse.status >= 200 && listResponse.status < 300) {
						const listData = listResponse.json;
						if (listData.links && listData.links.length > 0) shareData = listData.links[0];
					}
				}
				if (!shareData) throw new Error(JSON.stringify(errorData));
			}

            // FIX 1: The `directUrl` variable was missing. It's added back here.
            const directUrl = shareData.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '');

            this.replaceLinkInEditor(file.name, newFileName, directUrl);

            if (this.settings.deleteLocalFile) await this.app.vault.delete(file);
            new Notice(`${file.name} successfully uploaded and linked!`, 4000);
        } catch (error) {
            console.error('Dropbox Upload Error:', error);
            new Notice(`Error uploading to Dropbox: ${error.message}`, 10000);
        }
    }
    
    // FIX 2: This function is now clean, with the copy-paste error removed.
    replaceLinkInEditor(originalFileName: string, newFileName: string, newUrl: string) {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) return;

        this.isReplacingLink = true;

        const editor = markdownView.editor;
        const content = editor.getValue();
        
        const escapedFileName = originalFileName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const localLinkRegex = new RegExp(`!\\[\\[${escapedFileName}\\]\\]`, 'g');

        if (localLinkRegex.test(content)) {
            const newContent = content.replace(localLinkRegex, `![${originalFileName}](${newUrl})`);
			if (newContent !== content) {
				editor.setValue(newContent);

				if (markdownView.file) {
					const filePath = markdownView.file.path;
					const currentCache = this.activeNoteImageCache.get(filePath) || new Set<string>();
					currentCache.add(newFileName);
					this.activeNoteImageCache.set(filePath, currentCache);
				}
			}
            
            if (markdownView.file) {
                const filePath = markdownView.file.path;
                const currentCache = this.activeNoteImageCache.get(filePath) || new Set<string>();
                currentCache.add(newFileName);
                this.activeNoteImageCache.set(filePath, currentCache);
            }
        }

        setTimeout(() => { this.isReplacingLink = false; }, 500);
    }
}

class DropboxUploaderSettingTab extends PluginSettingTab {
    plugin: DropboxUploaderPlugin;

    constructor(app: App, plugin: DropboxUploaderPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Dropbox Uploader Settings' });

        containerEl.createEl('p', {
            text: 'This plugin automatically uploads images to Dropbox and replaces local links with Dropbox URLs. When you remove images from notes, you\'ll be prompted to delete them from Dropbox as well.'
        });

        new Setting(containerEl)
            .setName('Dropbox Access Token')
            .setDesc('Generate this from the Dropbox App Console. Keep this secret.')
            .addText(text => text
                .setPlaceholder('Enter your token')
                .setValue(this.plugin.settings.dropboxToken)
                .onChange(async (value) => {
                    this.plugin.settings.dropboxToken = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Dropbox Folder Path')
            .setDesc('The folder inside your Dropbox app folder where images will be stored.')
            .addText(text => text
                .setPlaceholder('e.g., ObsidianUploads')
                .setValue(this.plugin.settings.dropboxFolderPath)
                .onChange(async (value) => {
                    this.plugin.settings.dropboxFolderPath = value.trim() || 'ObsidianUploads';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Delete local file after upload')
            .setDesc('If enabled, the original image file will be deleted from your vault after a successful upload.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.deleteLocalFile)
                .onChange(async (value) => {
                    this.plugin.settings.deleteLocalFile = value;
                    await this.plugin.saveSettings();
                }));
    }
}