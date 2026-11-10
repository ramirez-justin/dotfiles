import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const template = readFileSync(
	join(import.meta.dir, "../skills/gametime-presentations/assets/template.html"),
	"utf8",
);
const script = template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Presentation script not found");

// Execute the actual inline script, not a copy of its routing logic. This
// minimal fixture models only the DOM APIs used here, plus uncancelled anchor
// navigation. It does not verify browser focus, keyboard activation, or layout.
function loadDeck(hash = "#1") {
	let activeElement: Element | null = null;
	class Element extends EventTarget {
		attributes: Record<string, string>;
		dataset: { title: string | undefined };
		hidden: boolean;
		disabled = false;
		textContent = "";
		tabIndex = 0;
		constructor(readonly tag: string, attributes: string) {
			super();
			this.attributes = Object.fromEntries(
				[...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
			);
			this.dataset = { title: this.attributes["data-title"] };
			this.hidden = /\bhidden\b/.test(attributes);
		}
		get id() { return this.attributes.id; }
		set id(value: string) { this.attributes.id = value; }
		setAttribute(name: string, value: string) { this.attributes[name] = value; }
		focus() { if (!this.disabled) activeElement = this; }
		closest() { return null; }
		querySelector(selector: string) {
			if (this.id === "controls" && selector === "button:not(:disabled)") {
				return elements.find((element) => element.tag === "button" && !element.disabled);
			}
			throw new Error(`Unsupported fixture selector: ${selector}`);
		}
	}
	const elements = [...template.matchAll(/<(section|a|nav|button|span)\b([^>]*)>/g)]
		.map((match) => new Element(match[1], match[2]));
	const slides = elements.filter((element) => element.attributes.class === "slide");
	const skip = elements.find((element) => element.attributes.class === "skip")!;
	const byId = (id: string) => elements.find((element) => element.id === id)!;
	const location = { hash };
	const windowEvents = new EventTarget();
	const document = Object.assign(new EventTarget(), {
		title: "",
		body: {
			classList: {
				values: new Set<string>(),
				toggle(name: string) {
					if (this.values.delete(name)) return false;
					this.values.add(name);
					return true;
				},
			},
		},
		querySelectorAll: (selector: string) => {
			if (selector === ".slide") return slides;
			throw new Error(`Unsupported fixture selector: ${selector}`);
		},
		querySelector: (selector: string) => {
			if (selector === ".skip") return skip;
			if (selector === "#controls button:not(:disabled)") {
				return byId("controls").querySelector("button:not(:disabled)");
			}
			throw new Error(`Unsupported fixture selector: ${selector}`);
		},
		getElementById: byId,
	});
	runInNewContext(script!, {
		document, location,
		history: { replaceState: (_state: unknown, _title: string, url: string) => { location.hash = url; } },
		addEventListener: windowEvents.addEventListener.bind(windowEvents),
	});
	function changeHash(value: string) {
		if (location.hash === value) return;
		location.hash = value;
		windowEvents.dispatchEvent(new Event("hashchange"));
	}
	function click(element: Element) {
		if (element.disabled) return;
		const event = new Event("click", { cancelable: true });
		element.dispatchEvent(event);
		if (element.tag === "a" && !event.defaultPrevented) {
			changeHash(element.attributes.href);
		}
	}
	return {
		document, location, slides, skip, byId, changeHash, click,
		get activeElement() { return activeElement; },
	};
}

describe("Gametime presentation controls", () => {
	for (const [hash, control] of [["#1", "next"], ["#2", "prev"], ["#3", "prev"]]) {
		test(`skip from ${hash} focuses an enabled control without changing slides, repeatedly`, () => {
			const deck = loadDeck(hash);
			const visibility = deck.slides.map((slide) => slide.hidden);
			for (let activation = 0; activation < 2; activation++) {
				deck.skip.focus();
				deck.click(deck.skip);
				expect(deck.activeElement?.id).toBe(control);
				expect(deck.activeElement?.disabled).toBe(false);
				expect(deck.location.hash).toBe(hash);
				expect(deck.slides.map((slide) => slide.hidden)).toEqual(visibility);
			}
		});
	}

	test("positive numeric fragments route, focus, and clamp to the slide bounds", () => {
		const deck = loadDeck();
		for (const [hash, normalized, counter, visible] of [
			["#2", "#2", "2 / 3", [true, false, true]],
			["#99", "#3", "3 / 3", [true, true, false]],
			["#1", "#1", "1 / 3", [false, true, true]],
		] as const) {
			deck.changeHash(hash);
			expect(deck.location.hash).toBe(normalized);
			expect(deck.byId("counter").textContent).toBe(counter);
			expect(deck.slides.map((slide) => slide.hidden)).toEqual([...visible]);
			expect(deck.activeElement).toBe(deck.slides.find((slide) => !slide.hidden)!);
		}
	});

	for (const hash of ["#controls", "#appendix", "", "#0", "#-1", "#2.0", "#2e0", "#0x2"]) {
		test(`non-slide fragment ${JSON.stringify(hash)} leaves slide and focus alone`, () => {
			const deck = loadDeck("#2");
			deck.byId("notes").focus();
			deck.changeHash(hash);
			expect(deck.location.hash).toBe(hash);
			expect(deck.byId("counter").textContent).toBe("2 / 3");
			expect(deck.slides.map((slide) => slide.hidden)).toEqual([true, false, true]);
			expect(deck.activeElement?.id).toBe("notes");
		});
	}

	test("button navigation keeps bounds and notes toggle intact", () => {
		const deck = loadDeck();
		expect(deck.byId("prev").disabled).toBe(true);
		deck.click(deck.byId("prev"));
		expect(deck.location.hash).toBe("#1");
		deck.click(deck.byId("next"));
		expect(deck.location.hash).toBe("#2");
		deck.click(deck.byId("notes"));
		expect(deck.byId("notes").attributes["aria-pressed"]).toBe("true");
		deck.click(deck.byId("next"));
		expect(deck.location.hash).toBe("#3");
		expect(deck.byId("next").disabled).toBe(true);
		deck.click(deck.byId("next"));
		expect(deck.location.hash).toBe("#3");
		deck.click(deck.byId("notes"));
		expect(deck.byId("notes").attributes["aria-pressed"]).toBe("false");
		deck.click(deck.byId("prev"));
		expect(deck.location.hash).toBe("#2");
	});
});
