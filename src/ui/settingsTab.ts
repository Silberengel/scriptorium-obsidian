import { App, PluginSettingTab, Setting } from "obsidian";
import ScriptoriumPlugin from "../main";
import { EventKind } from "../types";
import { fetchRelayList, addTheCitadelIfMissing, includesTheCitadel } from "../relayManager";
import { getPubkeyFromPrivkey } from "../nostr/eventBuilder";

/**
 * Settings tab for the plugin
 */
export class ScriptoriumSettingTab extends PluginSettingTab {
	plugin: ScriptoriumPlugin;

	constructor(app: App, plugin: ScriptoriumPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Scriptorium Nostr Settings" });

		// Private Key
		new Setting(containerEl)
			.setName("Private Key")
			.setDesc("Your Nostr private key (nsec or hex). Loaded from SCRIPTORIUM_OBSIDIAN_KEY environment variable.")
			.addText((text) => {
				const key = this.plugin.settings.privateKey || "";
				text.setValue(key ? "***" + key.slice(-4) : "")
					.setPlaceholder("nsec1... or hex")
					.setDisabled(true);
			})
			.addButton((button) => {
				button.setButtonText("Refresh from Env")
					.setCta()
					.onClick(async () => {
						await this.plugin.loadPrivateKey();
						this.display();
					});
			});

		// Default Event Kind
		new Setting(containerEl)
			.setName("Default Event Kind")
			.setDesc("Default event kind for new documents")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("1", "1 - Normal Note")
					.addOption("11", "11 - Discussion Thread OP")
					.addOption("30023", "30023 - Long-form Article")
					.addOption("30040", "30040 - Publication Index")
					.addOption("30041", "30041 - Publication Content")
					.addOption("30817", "30817 - Wiki Page (Markdown)")
					.addOption("30818", "30818 - Wiki Page (AsciiDoc)")
					.setValue(String(this.plugin.settings.defaultEventKind))
					.onChange(async (value) => {
						this.plugin.settings.defaultEventKind = parseInt(value) as EventKind;
						await this.plugin.saveSettings();
					});
			});

		// Suggest TheCitadel
		new Setting(containerEl)
			.setName("Suggest TheCitadel Relay")
			.setDesc("Automatically suggest adding wss://thecitadel.nostr1.com to relay list")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.suggestTheCitadel)
					.onChange(async (value) => {
						this.plugin.settings.suggestTheCitadel = value;
						await this.plugin.saveSettings();
					});
			});

		// Default Relay
		new Setting(containerEl)
			.setName("Default Relay")
			.setDesc("Fallback relay URL if no relay list is found")
			.addText((text) => {
				text.setValue(this.plugin.settings.defaultRelay)
					.setPlaceholder("wss://relay.example.com")
					.onChange(async (value) => {
						this.plugin.settings.defaultRelay = value;
						await this.plugin.saveSettings();
					});
			});

		// Auto AUTH
		new Setting(containerEl)
			.setName("Auto AUTH")
			.setDesc("Automatically handle relay authentication when required")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoAuth)
					.onChange(async (value) => {
						this.plugin.settings.autoAuth = value;
						await this.plugin.saveSettings();
					});
			});

		// Relay List Management
		containerEl.createEl("h3", { text: "Relay List" });

		new Setting(containerEl)
			.setName("Fetch Relay List")
			.setDesc("Fetch your relay list (kind 10002) from Nostr relays")
			.addButton((button) => {
				button.setButtonText("Fetch")
					.setCta()
					.onClick(async () => {
						if (!this.plugin.settings.privateKey) {
							alert("Please set your private key first");
							return;
						}

						try {
							const pubkey = getPubkeyFromPrivkey(this.plugin.settings.privateKey);
							const relayList = await fetchRelayList(pubkey);

							// Add TheCitadel if suggested
							let finalList = relayList;
							if (this.plugin.settings.suggestTheCitadel && !includesTheCitadel(relayList)) {
								finalList = addTheCitadelIfMissing(relayList);
							}

							this.plugin.settings.relayList = finalList;
							await this.plugin.saveSettings();
							this.display();
						} catch (error: any) {
							alert(`Error fetching relay list: ${error.message}`);
						}
					});
			});

		// Display current relay list
		if (this.plugin.settings.relayList.length > 0) {
			containerEl.createEl("h4", { text: "Current Relays" });
			this.plugin.settings.relayList.forEach((relay, index) => {
				const relayDiv = containerEl.createDiv({ cls: "scriptorium-relay-item" });
				relayDiv.createSpan({ text: relay.url });
				const badges = relayDiv.createSpan({ cls: "scriptorium-relay-badges" });
				if (relay.read) {
					badges.createSpan({ text: "Read", cls: "scriptorium-badge" });
				}
				if (relay.write) {
					badges.createSpan({ text: "Write", cls: "scriptorium-badge" });
				}
				new Setting(relayDiv)
					.addButton((button) => {
						button.setButtonText("Remove")
							.setWarning()
							.onClick(async () => {
								this.plugin.settings.relayList.splice(index, 1);
								await this.plugin.saveSettings();
								this.display();
							});
					});
			});
		}

		// Manual relay addition
		containerEl.createEl("h4", { text: "Add Relay" });
		new Setting(containerEl)
			.setName("Relay URL")
			.addText((text) => {
				text.setPlaceholder("wss://relay.example.com");
			})
			.addButton((button) => {
				button.setButtonText("Add")
					.setCta()
					.onClick(async () => {
						const input = button.buttonEl.previousElementSibling as HTMLInputElement;
						const url = input.value.trim();
						if (url) {
							if (!this.plugin.settings.relayList.some((r) => r.url === url)) {
								this.plugin.settings.relayList.push({
									url,
									read: true,
									write: true,
								});
								await this.plugin.saveSettings();
								this.display();
							}
						}
					});
			});
	}
}
