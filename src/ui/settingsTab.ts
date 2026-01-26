import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import ScriptoriumPlugin from "../main";
import { EventKind } from "../types";
import { fetchRelayList, addTheCitadelIfMissing, includesTheCitadel, getReadRelays, normalizeRelayUrl, normalizeRelayList } from "../relayManager";
import { getPubkeyFromPrivkey, getNpubFromPrivkey } from "../nostr/eventBuilder";
import { fetchUserProfile } from "../nostr/profileFetcher";

/**
 * Settings tab for the plugin
 */
export class ScriptoriumSettingTab extends PluginSettingTab {
	plugin: ScriptoriumPlugin;

	constructor(app: App, plugin: ScriptoriumPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Scriptorium Nostr Settings" });

		// User Identity (npub and handle) or Private Key Input
		if (this.plugin.settings.privateKey) {
			try {
				const npub = getNpubFromPrivkey(this.plugin.settings.privateKey);
				const pubkey = getPubkeyFromPrivkey(this.plugin.settings.privateKey);
				
				// Fetch profile to get handle/name
				let profile: { name?: string; display_name?: string; username?: string; nip05?: string } | null = null;
				const readRelays = getReadRelays(this.plugin.settings.relayList);
				if (readRelays.length > 0) {
					profile = await fetchUserProfile(pubkey, readRelays);
				}
				
				// Priority: nip05 (handle) > display_name > name > username > "Unknown"
				const displayName = profile?.nip05 || 
				                    profile?.display_name || 
				                    profile?.name || 
				                    profile?.username || 
				                    "Unknown";
				
				// Build description with what we found
				let identityDesc = "Your Nostr public identity";
				if (profile) {
					const parts: string[] = [];
					if (profile.nip05) parts.push(`NIP-05: ${profile.nip05}`);
					if (profile.display_name) parts.push(`Display: ${profile.display_name}`);
					if (profile.name) parts.push(`Name: ${profile.name}`);
					if (parts.length > 0) {
						identityDesc += `\n${parts.join(" | ")}`;
					}
				} else if (readRelays.length > 0) {
					identityDesc += "\n(Profile not found on relays - may need to publish kind 0 event)";
				} else {
					identityDesc += "\n(No read relays configured - fetch relay list first)";
				}
				
				new Setting(containerEl)
					.setName("Your Identity")
					.setDesc(identityDesc)
					.addText((text) => {
						text.setValue(`${displayName} (${npub})`)
							.setDisabled(true);
					})
					.addButton((button) => {
						button.setButtonText("Refresh")
							.setCta()
							.onClick(async () => {
								const loaded = await this.plugin.loadPrivateKey();
								if (!loaded && !this.plugin.settings.privateKey) {
									new Notice("Could not load private key. Please enter it manually below.");
								}
								await this.display();
							});
					});
				
				// Allow manual update of private key
				new Setting(containerEl)
					.setName("Update Private Key")
					.setDesc("Manually enter or update your private key (nsec1... or 64-char hex). Leave empty to keep current.")
					.addText((text) => {
						text.setPlaceholder("nsec1... or hex key")
							.setValue("")
							.inputEl.type = "password";
					})
					.addButton((button) => {
						button.setButtonText("Update")
							.onClick(async () => {
								const input = containerEl.querySelector("input[type='password']") as HTMLInputElement;
								if (input && input.value.trim()) {
									const key = input.value.trim();
									if (key.startsWith("nsec1") || /^[0-9a-f]{64}$/i.test(key)) {
										this.plugin.settings.privateKey = key;
										await this.plugin.saveSettings();
										input.value = "";
										new Notice("Private key updated successfully");
										await this.display();
									} else {
										new Notice("Invalid key format. Expected nsec1... or 64-char hex string.");
									}
								}
							});
					});
			} catch (error: any) {
				new Setting(containerEl)
					.setName("Private Key Status")
					.setDesc(`Error: ${error.message}`)
					.addButton((button) => {
						button.setButtonText("Refresh")
							.setCta()
							.onClick(async () => {
								await this.plugin.loadPrivateKey();
								await this.display();
							});
					});
			}
		} else {
			new Setting(containerEl)
				.setName("Private Key")
				.setDesc("Enter your private key manually, or set SCRIPTORIUM_OBSIDIAN_KEY environment variable, or create .scriptorium_key file in vault root.")
				.addText((text) => {
					text.setPlaceholder("nsec1... or 64-char hex key")
						.inputEl.type = "password";
				})
				.addButton((button) => {
					button.setButtonText("Set Key")
						.setCta()
						.onClick(async () => {
							const input = containerEl.querySelector("input[type='password']") as HTMLInputElement;
							if (input && input.value.trim()) {
								const key = input.value.trim();
								if (key.startsWith("nsec1") || /^[0-9a-f]{64}$/i.test(key)) {
									this.plugin.settings.privateKey = key;
									await this.plugin.saveSettings();
									input.value = "";
									new Notice("Private key saved successfully");
									await this.display();
								} else {
									new Notice("Invalid key format. Expected nsec1... or 64-char hex string.");
								}
							}
						});
				})
				.addButton((button) => {
					button.setButtonText("Refresh")
						.onClick(async () => {
							const loaded = await this.plugin.loadPrivateKey();
							if (loaded) {
								new Notice("Private key loaded successfully");
								await this.display();
							} else {
								new Notice("Could not load private key. Please enter it manually above.");
							}
						});
				});
		}

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
							
							// Normalize and deduplicate before saving
							this.plugin.settings.relayList = normalizeRelayList(finalList);
							await this.plugin.saveSettings();
							await this.display();
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
				
				// Display URL without ReadWrite suffix
				const urlSpan = relayDiv.createSpan({ text: relay.url });
				urlSpan.style.fontFamily = "monospace";
				urlSpan.style.marginRight = "8px";
				
				// Display permissions as badges
				const badges = relayDiv.createSpan({ cls: "scriptorium-relay-badges" });
				if (relay.read && relay.write) {
					badges.createSpan({ text: "Read/Write", cls: "scriptorium-badge" });
				} else if (relay.read) {
					badges.createSpan({ text: "Read", cls: "scriptorium-badge" });
				} else if (relay.write) {
					badges.createSpan({ text: "Write", cls: "scriptorium-badge" });
				}
				
				new Setting(relayDiv)
					.addButton((button) => {
						button.setButtonText("Remove")
							.setWarning()
							.onClick(async () => {
								this.plugin.settings.relayList.splice(index, 1);
								await this.plugin.saveSettings();
								await this.display();
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
							const normalizedUrl = normalizeRelayUrl(url);
							if (!this.plugin.settings.relayList.some((r) => normalizeRelayUrl(r.url) === normalizedUrl)) {
								this.plugin.settings.relayList.push({
									url: normalizedUrl,
									read: true,
									write: true,
								});
								// Normalize and deduplicate the entire list
								this.plugin.settings.relayList = normalizeRelayList(this.plugin.settings.relayList);
								await this.plugin.saveSettings();
								await this.display();
							}
						}
					});
			});
	}
}
