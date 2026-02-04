import { App, PluginSettingTab, Setting, TextComponent } from "obsidian";
import VectorInkPlugin from "./main";

export interface VectorInkSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: VectorInkSettings = {
	mySetting: "default",
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: VectorInkPlugin;

	constructor(app: App, plugin: VectorInkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Settings #1")
			.setDesc("It's a secret")
			.addText((text: TextComponent) => {
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value: string) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
