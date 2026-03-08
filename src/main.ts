import { Plugin, Notice, WorkspaceLeaf, TFile, MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import { InkView, INK_VIEW_TYPE } from './views/InkView';
import { VectorInkSettingTab } from './settings';
import { InkEmbedRenderer } from './views/InkEmbedRenderer';

export default class VectorInkPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.registerView(
			INK_VIEW_TYPE,
			(leaf) => new InkView(leaf, this)
		);

		this.registerExtensions(['ink'], INK_VIEW_TYPE);

		this.registerMarkdownPostProcessor((element, context) => {
			this.processInkEmbeds(element, context.sourcePath);
		});

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement)) continue;

					if (
						node.matches?.('.internal-embed[src$=".ink"]') ||
						node.matches?.('.cm-embed-block[src$=".ink"]')
					) {
						this.processInkEmbeds(node.parentElement ?? node, this.getSourcePath(node));
					}

					const embeds = node.querySelectorAll<HTMLElement>(
						'.internal-embed[src$=".ink"]'
					);
					if (embeds.length > 0) {
						this.processInkEmbeds(node, this.getSourcePath(node));
					}
				}
			}
		});

		observer.observe(document.body, { childList: true, subtree: true });
		this.register(() => observer.disconnect());

		this.addSettingTab(new VectorInkSettingTab(this.app, this));

		this.addRibbonIcon('pencil', 'Create Ink Note', () => {
			this.createInkNote();
		});

		this.addCommand({
			id: 'create-ink-note',
			name: 'Create Ink Note',
			callback: () => this.createInkNote()
		});
	}

	async createInkNote() {
		try {
			const now = new Date();
			const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;

			// Filename: "2024-01-15.ink", then "2024-01-15 1.ink", "2024-01-15 2.ink", ...
			let filename = `${dateStr}.ink`;
			if (this.app.vault.getAbstractFileByPath(filename)) {
				let n = 1;
				do { filename = `${dateStr} ${n}.ink`; n++; }
				while (this.app.vault.getAbstractFileByPath(filename));
			}

			const initialBlock = {
				id: crypto.randomUUID(),
				type: 'paragraph',
				strokeIds: [],
				bbox: { x: 20, y: 20, width: 760, height: 200 },
				order: 0,
				displaySettings: {
					grid: { enabled: false, type: 'grid', size: 20, color: '#e0e0e0', opacity: 0.5, lineWidth: 0.5 },
					useColor: false,
					widthMultiplier: 1.0,
					backgroundColor: '#ffffff',
					showSeparator: false,
					showQuoteBar: false,
				},
			};

			const docData = {
				schemaVersion: 1,
				document: {
					id: crypto.randomUUID(),
					createdAt: now.toISOString(),
					updatedAt: now.toISOString(),
					page: {
						width: 800,
						height: 600,
						unit: 'px',
						backgroundColor: '#ffffff'
					}
				},
				strokes: [],
				blocks: [initialBlock],
				settings: {
					defaultPen: {
						width: 2,
						color: '#000000',
						semantic: 'normal'
					},
					smoothing: 0.5
				},
				metadata: {
					createdWith: 'VectorInk Plugin v1.0'
				}
			};

			const content = JSON.stringify(docData, null, 2);
			const file = await this.app.vault.create(filename, content);
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);

			new Notice(`Created ink note: ${filename}`);

		} catch (error) {
			console.error('❌ Failed to create ink note:', error);
			if (error instanceof Error) {
				new Notice(`Failed: ${error.message}`);
			} else {
				new Notice('Failed to create ink note');
			}
		}
	}

	private processInkEmbeds(container: HTMLElement, sourcePath: string): void {
		const embeds = container.matches?.('.internal-embed[src$=".ink"]')
			? [container]
			: Array.from(container.querySelectorAll<HTMLElement>('.internal-embed[src$=".ink"]'));

		for (const embedEl of embeds) {
			if (embedEl.dataset.inkProcessed === 'true') continue;
			embedEl.dataset.inkProcessed = 'true';

			const src = embedEl.getAttribute('src');
			if (!src) continue;

			const inkFile = this.app.metadataCache.getFirstLinkpathDest(src, sourcePath);
			if (!inkFile || !(inkFile instanceof TFile)) {
				embedEl.createEl('p', { cls: 'ink-embed-error', text: `⚠ Not found: ${src}` });
				continue;
			}

			const renderer = new InkEmbedRenderer(this, embedEl, inkFile);
			renderer.load();
			this.addChild(renderer);
		}
	}

	private getSourcePath(el: HTMLElement): string {
		const view = el.closest<HTMLElement>('[data-path]');
		return view?.dataset.path ?? '';
	}

	async loadSettings() {
	}

	async saveSettings() {
	}

	onunload() {
		(this.app as any).embedRegistry.unregisterEmbedCreator('ink');
	}
}