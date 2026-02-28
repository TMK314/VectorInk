import { App, Plugin } from "obsidian";
import { PluginSettingTab, Setting, TextComponent } from "obsidian";
import VectorInkPlugin from "./main";

export interface VectorInkSettings {
	pythonPath: string;
}

export const DEFAULT_SETTINGS: VectorInkSettings = {
	pythonPath: "python"
};

export class VectorInkSettingTab extends PluginSettingTab {
	plugin: VectorInkPlugin;

	constructor(app: App, plugin: VectorInkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "VectorInk Settings" });

		new Setting(containerEl)
			.setName("Python executable path")
			.setDesc("Absolute path to Python 3.11 (or leave 'python' for PATH lookup)")
			.addText((text) =>
				text
					.setPlaceholder("C:\\Path\\To\\python.exe")
					.setValue(this.plugin.settings.pythonPath)
					.onChange(async (value: string) => {
						this.plugin.settings.pythonPath = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
