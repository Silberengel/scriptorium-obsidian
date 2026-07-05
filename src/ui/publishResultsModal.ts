import { App, Modal } from "obsidian";
import { PublishingResult, SignedEvent } from "../types";
import { appendLinkifiedText, createLink } from "../utils/linkify";

export interface PublishResultsSummary {
	header: string;
	totalEvents: number;
	results: PublishingResult[][];
	events: SignedEvent[];
}

export class PublishResultsModal extends Modal {
	private summary: PublishResultsSummary;

	constructor(app: App, summary: PublishResultsSummary) {
		super(app);
		this.summary = summary;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();

		modalEl.style.maxWidth = "720px";
		modalEl.style.maxHeight = "85vh";
		contentEl.style.maxHeight = "75vh";
		contentEl.style.overflowY = "auto";

		contentEl.createEl("h2", { text: "Publish Results" });
		contentEl.createEl("p", { text: this.summary.header, cls: "scriptorium-publish-summary" });

		const list = contentEl.createDiv({ cls: "scriptorium-publish-relay-list" });

		for (const relayResults of this.summary.results) {
			if (relayResults.length === 0) continue;
			this.renderRelayBlock(list, relayResults);
		}

		const buttonContainer = contentEl.createDiv({ cls: "scriptorium-modal-buttons" });
		buttonContainer.createEl("button", { text: "Close", cls: "mod-cta" }).addEventListener("click", () => {
			this.close();
		});
	}

	private renderRelayBlock(container: HTMLElement, relayResults: PublishingResult[]): void {
		const relay = relayResults[0].relay;
		const total = this.summary.totalEvents;
		const published = relayResults.filter((r) => r.success).length;
		const failures = relayResults.filter((r) => !r.success);

		const block = container.createDiv({ cls: "scriptorium-publish-relay-block" });
		block.style.marginBottom = "1rem";
		block.style.paddingBottom = "0.75rem";
		block.style.borderBottom = "1px solid var(--background-modifier-border)";

		const header = block.createDiv({ cls: "scriptorium-publish-relay-header" });
		header.style.marginBottom = "0.35rem";
		header.style.fontWeight = "600";

		createLink(header, relay);
		header.appendText(` — ${published}/${total} published`);

		if (failures.length === 0) return;

		const errorsHeading = block.createEl("p", {
			text: `${failures.length} failed:`,
			cls: "scriptorium-publish-errors-heading",
		});
		errorsHeading.style.margin = "0.35rem 0 0.25rem";
		errorsHeading.style.fontSize = "var(--font-ui-small)";
		errorsHeading.style.color = "var(--text-muted)";

		const errorList = block.createEl("ul", { cls: "scriptorium-publish-error-list" });
		errorList.style.margin = "0";
		errorList.style.paddingLeft = "1.25rem";

		for (const failure of failures) {
			const item = errorList.createEl("li");
			item.style.marginBottom = "0.35rem";

			const event = this.summary.events.find((e) => e.id === failure.eventId);
			const label = event ? `kind ${event.kind}` : "event";
			const shortId =
				failure.eventId.length > 16
					? `${failure.eventId.slice(0, 8)}…${failure.eventId.slice(-8)}`
					: failure.eventId;

			item.createEl("strong", { text: `${label} (${shortId}): ` });

			const messageEl = item.createSpan({ cls: "scriptorium-publish-error-message" });
			const message = failure.message?.trim() || "Publish failed (no message from relay)";
			appendLinkifiedText(messageEl, message);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

export function buildPublishResultsHeader(
	total: number,
	allRelaysComplete: boolean,
	allEventsPublishedSomewhere: boolean
): string {
	if (allRelaysComplete) {
		return `All relays published ${total}/${total} event(s).`;
	}
	if (allEventsPublishedSomewhere) {
		return `Published ${total}/${total} event(s), but some relays rejected events.`;
	}
	return `${total} event(s) in batch — see per-relay results below.`;
}

export function summarizePublishResults(
	events: SignedEvent[],
	results: PublishingResult[][]
): { allRelaysComplete: boolean; allEventsPublishedSomewhere: boolean } {
	const allRelaysComplete =
		results.length > 0 &&
		results.every(
			(relayResults) => relayResults.length > 0 && relayResults.every((r) => r.success)
		);

	const allEventsPublishedSomewhere = events.every((event) =>
		results.some((relayResults) =>
			relayResults.some((r) => r.eventId === event.id && r.success)
		)
	);

	return { allRelaysComplete, allEventsPublishedSomewhere };
}

export function showPublishResultsModal(app: App, summary: PublishResultsSummary): void {
	new PublishResultsModal(app, summary).open();
}
