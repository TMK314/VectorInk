import { Plugin, Notice, WorkspaceLeaf, TFile } from 'obsidian';
import { InkView, INK_VIEW_TYPE } from './views/InkView';

export default class VectorInkPlugin extends Plugin {
	async onload() {
		console.log('Loading Vector Ink Plugin');

		// Register the view
		this.registerView(
			INK_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new InkView(leaf, this)
		);

		// Register file extension
		this.registerExtensions(['ink'], INK_VIEW_TYPE);

		// Add ribbon icon
		this.addRibbonIcon('pencil', 'Create Ink Note', async () => {
			await this.createInkNote();
		});

		// Add command
		this.addCommand({
			id: 'create-ink-note',
			name: 'Create Ink Note',
			callback: async () => {
				await this.createInkNote();
			}
		});

		console.log('✅ Vector Ink Plugin loaded');
	}

	async createInkNote() {
		try {
			const now = new Date();
			const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
			const filename = `Ink Note ${timestamp}.ink`;

			// Create empty ink document
			const docData = {
				schemaVersion: 1,
				document: {
					id: crypto.randomUUID(),
					createdAt: now.toISOString(),
					updatedAt: now.toISOString(),
					page: {
						width: 210,
						height: 297,
						unit: 'mm',
						backgroundColor: '#ffffff'
					}
				},
				strokes: [],
				blocks: [],
				settings: {
					defaultPen: {
						width: 2.0,
						color: '#000000',
						semantic: 'normal'
					},
					pressureSensitivity: true,
					smoothing: 0.3
				},
				metadata: {
					createdWith: 'VectorInk Plugin v1.0'
				}
			};

			const content = JSON.stringify(docData, null, 2);

			// Create the file
			const file = await this.app.vault.create(filename, content);

			// Open the file - Obsidian will use the registered view automatically
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);

			new Notice(`Created ink note: ${filename}`);

		} catch (error) {
			console.error('❌ Failed to create ink note:', error);
			new Notice('Failed to create ink note');
		}
	}

	onunload() {
		console.log('Unloading Vector Ink Plugin');
	}
}