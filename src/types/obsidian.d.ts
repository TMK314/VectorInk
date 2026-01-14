declare module 'obsidian' {
    import { Component } from 'obsidian/obsidian';
    
    export interface App {
        vault: Vault;
        workspace: Workspace;
    }
    
    export interface Vault {
        getFolderByPath(path: string): TFolder | null;
        createFolder(path: string): Promise<TFolder>;
        create(path: string, data: string): Promise<TFile>;
        read(file: TFile): Promise<string>;
        modify(file: TFile, data: string): Promise<void>;
    }
    
    export interface Workspace {
        getLeaf(split: boolean): WorkspaceLeaf;
    }
    
    export interface WorkspaceLeaf {
        openFile(file: TFile): Promise<void>;
    }
    
    export interface TFile {
        path: string;
        basename: string;
        extension: string;
    }
    
    export interface TFolder {
        path: string;
    }
    
    export abstract class Plugin {
        app: App;
        
        constructor(app: App, manifest: any);
        
        abstract onload(): Promise<void>;
        abstract onunload(): void;
        
        registerView(viewType: string, viewCreator: (leaf: WorkspaceLeaf) => FileView): void;
        registerExtensions(extensions: string[], viewType: string): void;
        addCommand(command: { id: string; name: string; callback: () => void }): void;
        addRibbonIcon(icon: string, title: string, onClick: () => void): void;
        addSettingTab(settingTab: any): void;
        loadData(): Promise<any>;
        saveData(data: any): Promise<void>;
    }
    
    export abstract class FileView {
        contentEl: HTMLElement;
        file: TFile | null;
        app: App;
        
        constructor(leaf: WorkspaceLeaf);
        
        abstract getViewType(): string;
        abstract getDisplayText(): string;
        
        onOpen(): Promise<void>;
        onClose(): Promise<void>;
    }
    
    export class Notice {
        constructor(message: string, duration?: number);
    }
    
    export class Component {
        constructor();
    }
}