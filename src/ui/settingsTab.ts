import { App, PluginSettingTab, Setting, Notice, TextComponent } from "obsidian";
import ScriptoriumPlugin from "../main";
import { KindTemplate, DEFAULT_RELAY_PRESET } from "../types";
import {
	fetchRelayList,
	getReadRelays,
	getEffectiveRelayList,
	normalizeRelayUrl,
	normalizeRelayList,
} from "../relayManager";
import { getPubkeyFromPrivkey, getNpubFromPrivkey } from "../nostr/eventBuilder";
import { fetchUserProfile } from "../nostr/profileFetcher";
import {
	getSelectableTemplates,
	resetTemplateToDefault,
	resetAllTemplatesToDefaults,
	isDeletableTemplate,
	createCustomTemplateScaffold,
	createPublicationTemplate,
	slugifyTemplateName,
	finalizeCustomTemplateForSave,
	getDocumentMarkup,
} from "../templateRegistry";
import { getNip01KindClass } from "../utils/nip01Kind";
import {
	KindTemplateEditorModal,
	deleteKindTemplate,
	updateKindTemplatesInSettings,
} from "./kindTemplateEditorModal";
import { AddPublicationModal } from "./addPublicationModal";

/**
 * Settings tab for the plugin
 */
export class ScriptoriumSettingTab extends PluginSettingTab {
	plugin: ScriptoriumPlugin;
	private newRelayUrlInput: TextComponent | null = null;

	constructor(app: App, plugin: ScriptoriumPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();
		this.newRelayUrlInput = null;

		containerEl.createEl("h2", { text: "Scriptorium Nostr Settings" });

		const privkey = this.plugin.getPrivateKey();

		if (privkey) {
			try {
				const npub = getNpubFromPrivkey(privkey);
				const pubkey = getPubkeyFromPrivkey(privkey);

				let profile: { name?: string; display_name?: string; username?: string; nip05?: string } | null = null;
				const readRelays = getReadRelays(getEffectiveRelayList(this.plugin.settings));
				if (readRelays.length > 0) {
					profile = await fetchUserProfile(pubkey, readRelays);
				}

				const displayName = profile?.nip05 ||
					profile?.display_name ||
					profile?.name ||
					profile?.username ||
					"Unknown";

				let identityDesc = "Your Nostr public identity (key loaded from SCRIPTORIUM_OBSIDIAN_KEY)";
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
								await this.display();
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
								await this.display();
							});
					});
			}
		} else {
			new Setting(containerEl)
				.setName("Private Key")
				.setDesc("Set SCRIPTORIUM_OBSIDIAN_KEY in your environment and restart Obsidian. The key is never stored in vault settings. Use ./start-obsidian.sh --generate-key to create a new key.")
				.addButton((button) => {
					button.setButtonText("Refresh")
						.setCta()
						.onClick(async () => {
							if (this.plugin.getPrivateKey()) {
								new Notice("Private key loaded from environment variable");
								await this.display();
							} else {
								new Notice("Could not load private key. Set SCRIPTORIUM_OBSIDIAN_KEY and restart Obsidian.");
							}
						});
				});
		}

		new Setting(containerEl)
			.setName("Default Template")
			.setDesc("Default template for new documents")
			.addDropdown((dropdown) => {
				const templates = getSelectableTemplates(this.plugin.settings);
				for (const t of templates) {
					dropdown.addOption(t.id, `${t.name} (kind ${t.kind})`);
				}
				dropdown
					.setValue(this.plugin.settings.defaultTemplateId)
					.onChange(async (value) => {
						this.plugin.settings.defaultTemplateId = value;
						await this.plugin.saveSettings();
					});
			});

		this.renderKindTemplatesSection(containerEl);

		new Setting(containerEl)
			.setName("Default Relay")
			.setDesc("Always included in your relay list (read + write), normalized and deduplicated with fetched relays")
			.addText((text) => {
				text.setValue(this.plugin.settings.defaultRelay || DEFAULT_RELAY_PRESET)
					.setPlaceholder(DEFAULT_RELAY_PRESET)
					.onChange(async (value) => {
						this.plugin.settings.defaultRelay = value;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createEl("h3", { text: "Relay List" });

		new Setting(containerEl)
			.setName("Fetch Relay List")
			.setDesc("Fetch your relay list (kind 10002) from Nostr relays")
			.addButton((button) => {
				button.setButtonText("Fetch")
					.setCta()
					.onClick(async () => {
						const fetchPrivkey = this.plugin.getPrivateKey();
						if (!fetchPrivkey) {
							new Notice("Set SCRIPTORIUM_OBSIDIAN_KEY and restart Obsidian first");
							return;
						}

						try {
							const pubkey = getPubkeyFromPrivkey(fetchPrivkey);
							const relayList = await fetchRelayList(pubkey);

							this.plugin.settings.relayList = normalizeRelayList(relayList);
							await this.plugin.saveSettings();
							await this.display();
						} catch (error: any) {
							new Notice(`Error fetching relay list: ${error.message}`);
						}
					});
			});

		const effectiveRelays = getEffectiveRelayList(this.plugin.settings);
		if (effectiveRelays.length > 0) {
			containerEl.createEl("h4", { text: "Effective Relays (including default)" });
			effectiveRelays.forEach((relay) => {
				const relayDiv = containerEl.createDiv({ cls: "scriptorium-relay-item" });

				const urlSpan = relayDiv.createSpan({ text: relay.url });
				urlSpan.style.fontFamily = "monospace";
				urlSpan.style.marginRight = "8px";

				const badges = relayDiv.createSpan({ cls: "scriptorium-relay-badges" });
				if (relay.read && relay.write) {
					badges.createSpan({ text: "Read/Write", cls: "scriptorium-badge" });
				} else if (relay.read) {
					badges.createSpan({ text: "Read", cls: "scriptorium-badge" });
				} else if (relay.write) {
					badges.createSpan({ text: "Write", cls: "scriptorium-badge" });
				}
			});
		}

		if (this.plugin.settings.relayList.length > 0) {
			containerEl.createEl("h4", { text: "Saved Relays" });
			this.plugin.settings.relayList.forEach((relay, index) => {
				const relayDiv = containerEl.createDiv({ cls: "scriptorium-relay-item" });

				const urlSpan = relayDiv.createSpan({ text: relay.url });
				urlSpan.style.fontFamily = "monospace";
				urlSpan.style.marginRight = "8px";

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

		containerEl.createEl("h4", { text: "Add Relay" });
		new Setting(containerEl)
			.setName("Relay URL")
			.addText((text) => {
				this.newRelayUrlInput = text;
				text.setPlaceholder("wss://relay.example.com");
			})
			.addButton((button) => {
				button.setButtonText("Add")
					.setCta()
					.onClick(async () => {
						const url = this.newRelayUrlInput?.getValue().trim();
						if (url) {
							const normalizedUrl = normalizeRelayUrl(url);
							if (!this.plugin.settings.relayList.some((r) => normalizeRelayUrl(r.url) === normalizedUrl)) {
								this.plugin.settings.relayList.push({
									url: normalizedUrl,
									read: true,
									write: true,
								});
								this.plugin.settings.relayList = normalizeRelayList(this.plugin.settings.relayList);
								await this.plugin.saveSettings();
								this.newRelayUrlInput?.setValue("");
								await this.display();
							}
						}
					});
			});
	}

	private openNewTemplateEditor(template: KindTemplate): void {
		new KindTemplateEditorModal(
			this.app,
			template,
			this.plugin.settings.kindTemplates,
			async (updated) => {
				const finalized = finalizeCustomTemplateForSave(
					this.plugin.settings,
					updated,
					template.id
				);
				updateKindTemplatesInSettings(this.plugin.settings, finalized, template.id);
				await this.plugin.saveSettings();
				await this.display();
				new Notice(`Template saved: ${finalized.id}`);
			}
		).open();
	}

	private addPublicationTemplates(): void {
		new AddPublicationModal(this.app, async (config) => {
			const publicationId = slugifyTemplateName(config.name);

			const publication = createPublicationTemplate({
				publicationId,
				indexKind: config.indexKind,
				name: config.name,
				sectionKinds: config.sectionKinds,
			});

			updateKindTemplatesInSettings(this.plugin.settings, publication);
			await this.plugin.saveSettings();
			await this.display();

			const sectionSummary = config.sectionKinds
				.map((s) => `${s.kind} (${s.markup})`)
				.join(", ");
			new Notice(`Added publication "${publication.name}" with sections: ${sectionSummary}`);
			this.openNewTemplateEditor(publication);
		}).open();
	}

	private renderKindTemplatesSection(containerEl: HTMLElement) {
		containerEl.createEl("h3", { text: "Event Kind Templates" });
		containerEl.createEl("p", {
			text: "All event kinds are defined as JSON templates. Default templates use ids ending in -default.",
		});

		const table = containerEl.createEl("table");
		table.style.width = "100%";
		table.style.marginBottom = "1em";
		const headerRow = table.createEl("tr");
		["ID", "Name", "Type", "Kind", "Markup", "NIP-01", "Structured", ""].forEach((h) => {
			const th = headerRow.createEl("th");
			th.textContent = h;
			th.style.textAlign = "left";
			th.style.padding = "4px 8px";
		});

		for (const template of this.plugin.settings.kindTemplates) {
			const row = table.createEl("tr");
			const cells = [
				template.id,
				template.name,
				template.type,
				String(template.kind),
				template.markup ?? (template.structured ? getDocumentMarkup(template, this.plugin.settings) : "—"),
				getNip01KindClass(template.kind),
				template.structured ? "yes" : "no",
			];
			cells.forEach((text) => {
				const td = row.createEl("td");
				td.textContent = text;
				td.style.padding = "4px 8px";
			});

			const actionsTd = row.createEl("td");
			actionsTd.style.padding = "4px 8px";

			actionsTd.createEl("button", { text: "Edit" }).addEventListener("click", () => {
				new KindTemplateEditorModal(
					this.app,
					JSON.parse(JSON.stringify(template)),
					this.plugin.settings.kindTemplates,
					async (updated) => {
						const finalized = finalizeCustomTemplateForSave(
							this.plugin.settings,
							updated,
							template.id
						);
						updateKindTemplatesInSettings(this.plugin.settings, finalized, template.id);
						await this.plugin.saveSettings();
						await this.display();
						new Notice(`Template saved: ${finalized.id}`);
					}
				).open();
			});

			if (template.type === "default") {
				actionsTd.createEl("button", { text: "Reset" }).addEventListener("click", async () => {
					resetTemplateToDefault(template.id, this.plugin.settings);
					await this.plugin.saveSettings();
					await this.display();
					new Notice(`Reset ${template.id} to default`);
				});
			}

			if (isDeletableTemplate(template)) {
				const delBtn = actionsTd.createEl("button", { text: "Delete" });
				delBtn.style.marginLeft = "4px";
				delBtn.addEventListener("click", async () => {
					if (deleteKindTemplate(this.plugin.settings, template.id)) {
						await this.plugin.saveSettings();
						await this.display();
						new Notice(`Deleted ${template.id}`);
					}
				});
			}
		}

		new Setting(containerEl)
			.setName("Add Template")
			.setDesc(
				"Simple = one document, one event. Publication = hierarchical source file split into index + section events; configure allowed section kinds and markup."
			)
			.addButton((button) => {
				button.setButtonText("Simple").setCta().onClick(() => {
					this.openNewTemplateEditor(createCustomTemplateScaffold());
				});
			})
			.addButton((button) => {
				button.setButtonText("Publication").onClick(() => {
					this.addPublicationTemplates();
				});
			});

		new Setting(containerEl)
			.setName("Reset All Defaults")
			.setDesc("Restore all default templates from shipped presets; custom templates are kept")
			.addButton((button) => {
				button.setButtonText("Reset All").setWarning().onClick(async () => {
					resetAllTemplatesToDefaults(this.plugin.settings);
					await this.plugin.saveSettings();
					await this.display();
					new Notice("Default templates reset");
				});
			});
	}
}
