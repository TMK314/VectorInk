import { Plugin, Notice, WorkspaceLeaf, TFile, Workspace } from 'obsidian';
import { InkView, INK_VIEW_TYPE } from './views/InkView';

export default class VectorInkPlugin extends Plugin {
	private activeLeaf: WorkspaceLeaf | null = null;

	async onload() {
		console.log('🔧 Loading Vector Ink Plugin');

		this.registerView(
			INK_VIEW_TYPE,
			(leaf) => new InkView(leaf, this)
		);

		this.registerExtensions(['ink'], INK_VIEW_TYPE);

		this.addRibbonIcon('pencil', 'Create Ink Note', () => {
			this.createInkNote();
		});

		this.addCommand({
			id: 'create-ink-note',
			name: 'Create Ink Note',
			callback: () => this.createInkNote()
		});

		this.addCommand({
			id: 'create-test-document',
			name: 'Create Test Document',
			callback: () => this.createTestDocument()
		});

		console.log('✅ Vector Ink Plugin loaded');
	}

	async createTestDocument() {
		try {
			const testData = {
				schemaVersion: 1,
				document: {
					id: crypto.randomUUID(),
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					page: {
						width: 800,  // Canvas width in pixels
						height: 600, // Canvas height in pixels
						unit: 'px',
						backgroundColor: '#ffffff'
					}
				},
				strokes: [
					{
						id: 'test-stroke-1',
						points: [
							{ x: 100, y: 100, t: 0, pressure: 0.5 },
							{ x: 200, y: 100, t: 100, pressure: 0.5 },
							{ x: 200, y: 200, t: 200, pressure: 0.5 },
							{ x: 100, y: 200, t: 300, pressure: 0.5 },
							{ x: 100, y: 100, t: 400, pressure: 0.5 }
						],
						style: {
							width: 3,
							color: '#ff0000',
							semantic: 'normal'
						},
						createdAt: new Date().toISOString(),
						device: 'pen'
					},
					{
						id: 'test-stroke-2',
						points: [
							{ x: 300, y: 300, t: 500, pressure: 0.5 },
							{ x: 400, y: 400, t: 600, pressure: 0.7 },
							{ x: 500, y: 300, t: 700, pressure: 0.5 }
						],
						style: {
							width: 2,
							color: '#0000ff',
							semantic: 'normal'
						},
						createdAt: new Date().toISOString(),
						device: 'pen'
					}
				],
				blocks: [],
				settings: {
					defaultPen: {
						width: 2,
						color: '#000000',
						semantic: 'normal'
					},
					pressureSensitivity: true,
					smoothing: 0.3
				},
				metadata: {
					createdWith: 'VectorInk Plugin Test'
				}
			};

			const filename = 'Test Document.ink';
			const content = JSON.stringify(testData, null, 2);

			console.log('📝 Creating test document:', filename);

			const file = await this.app.vault.create(filename, content);
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);

			new Notice(`Created test document: ${filename}`);
			console.log('✅ Test document created');

		} catch (error) {
			console.error('❌ Failed to create test document:', error);
			new Notice('Failed to create test document');
		}
	}

	async createInkNote() {
		try {
			// Create unique filename with milliseconds
			const now = new Date();
			const timestamp = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}${now.getMilliseconds().toString().padStart(3, '0')}`;
			const filename = `Ink Note ${timestamp}.ink`;

			console.log('📝 Creating ink note:', filename);

			// Create empty ink document
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
				strokes: [
					{
						id: 'test-stroke-1',
						points: [
							{ x: 50, y: 50, t: Date.now(), pressure: 0.5 },
							{ x: 100, y: 100, t: Date.now() + 50, pressure: 0.6 },
							{ x: 150, y: 50, t: Date.now() + 100, pressure: 0.5 }
						],
						style: {
							width: 2,
							color: '#000000',
							semantic: 'normal'
						},
						createdAt: new Date().toISOString(),
						device: 'pen'
					}
				],
				blocks: [],
				settings: {
					defaultPen: {
						width: 2,
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

			// Create the file directly - timestamp should be unique enough
			const file = await this.app.vault.create(filename, content);

			// Open the file
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(file);

			console.log('✅ Created ink note:', filename);
			new Notice(`Created ink note: ${filename}`);

		} catch (error) {
			console.error('❌ Failed to create ink note:', error);

			// Type-safe error handling
			if (error instanceof Error) {
				new Notice(`Failed: ${error.message}`);
			} else {
				new Notice('Failed to create ink note');
			}
		}
	}

	onunload() {
		console.log('Unloading Vector Ink Plugin');
	}
}