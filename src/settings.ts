import { App, Plugin } from "obsidian";
import { PluginSettingTab, Setting, TextComponent } from "obsidian";
import VectorInkPlugin from "./main";


export class VectorInkSettingTab extends PluginSettingTab {
	plugin: VectorInkPlugin;

	constructor(app: App, plugin: VectorInkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
	}
}