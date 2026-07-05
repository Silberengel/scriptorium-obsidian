/** Append text to a container, turning URLs into clickable links. */
export function appendLinkifiedText(container: HTMLElement, text: string): void {
	const urlPattern = /\b(?:https?|wss?):\/\/[^\s<]+[^\s<.,;:!?'")\]}>]/gi;
	let lastIndex = 0;

	for (const match of text.matchAll(urlPattern)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			container.appendText(text.slice(lastIndex, index));
		}
		const url = match[0];
		const link = container.createEl("a", { href: url, text: url });
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		lastIndex = index + url.length;
	}

	if (lastIndex < text.length) {
		container.appendText(text.slice(lastIndex));
	}
}

export function createLink(parent: HTMLElement, url: string, label?: string): HTMLAnchorElement {
	const link = parent.createEl("a", { href: url, text: label ?? url });
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	return link;
}
