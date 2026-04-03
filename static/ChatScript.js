/* ChatScript.js
   Fixes:
   - reliable scrolling inside the chat area
   - proper markdown rendering for DeepSeek responses
   - prompt flow:
     /analyze_prompt -> /submit_answers -> /generate_final
*/

(() => {
	"use strict";

	const chatStage = document.querySelector(".chat-stage");
	const chatHeader = document.querySelector(".chat-stage-header");
	const composerWrap = document.querySelector(".composer-wrap");
	const chatContainer = document.getElementById("chat-container");
	const input = document.getElementById("chat-input");
	const sendBtn = document.getElementById("send-btn");
	const historyList = document.getElementById("history-list");
	const quickPromptButtons = document.querySelectorAll(".prompt-chip");

	if (!chatContainer || !input || !sendBtn || !chatStage) {
		console.error("Required chat elements were not found.");
		return;
	}

	let stage = "initial"; // initial -> waiting_answers
	let isBusy = false;
	let typingEl = null;

	// Keep a permanent anchor at the bottom for reliable scroll targeting.
	const scrollAnchor = document.createElement("div");
	scrollAnchor.id = "scroll-anchor";
	scrollAnchor.style.cssText = "width:1px;height:1px;flex:0 0 auto;";
	chatContainer.appendChild(scrollAnchor);

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function safeUrl(url) {
		const trimmed = String(url || "").trim();
		if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
		return "#";
	}

	function formatInline(text) {
		let out = escapeHtml(text);

		// Inline code
		out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

		// Links
		out = out.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			(_, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
		);

		// Bold
		out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");

		// Italic
		out = out.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
		out = out.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");

		return out;
	}

	function renderMarkdown(md) {
		const text = String(md || "").replace(/\r\n/g, "\n").trim();
		if (!text) return "";

		const lines = text.split("\n");
		const blocks = [];
		let paragraph = [];
		let listItems = [];
		let listType = null;
		let quoteLines = [];
		let inCode = false;
		let codeLang = "";
		let codeLines = [];

		function flushParagraph() {
			if (!paragraph.length) return;
			const joined = paragraph.join("\n").trim();
			if (joined) blocks.push(`<p>${formatInline(joined).replace(/\n/g, "<br>")}</p>`);
			paragraph = [];
		}

		function flushList() {
			if (!listItems.length) return;
			const tag = listType === "ol" ? "ol" : "ul";
			blocks.push(
				`<${tag}>${listItems.map((item) => `<li>${formatInline(item)}</li>`).join("")}</${tag}>`
			);
			listItems = [];
			listType = null;
		}

		function flushQuote() {
			if (!quoteLines.length) return;
			const quoteHtml = quoteLines.map((line) => formatInline(line)).join("<br>");
			blocks.push(`<blockquote>${quoteHtml}</blockquote>`);
			quoteLines = [];
		}

		function flushCode() {
			if (!codeLines.length) return;
			const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
			blocks.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			codeLines = [];
			codeLang = "";
		}

		for (const rawLine of lines) {
			const line = rawLine;

			// Code fence
			if (/^```/.test(line.trim())) {
				if (inCode) {
					flushCode();
					inCode = false;
				} else {
					flushParagraph();
					flushList();
					flushQuote();
					inCode = true;
					codeLang = line.trim().slice(3).trim();
				}
				continue;
			}

			if (inCode) {
				codeLines.push(line);
				continue;
			}

			// Blank line
			if (!line.trim()) {
				flushParagraph();
				flushList();
				flushQuote();
				continue;
			}

			// Horizontal rule
			if (/^(\*\s*){3,}$/.test(line.trim()) || /^(-\s*){3,}$/.test(line.trim()) || /^(_\s*){3,}$/.test(line.trim())) {
				flushParagraph();
				flushList();
				flushQuote();
				blocks.push("<hr>");
				continue;
			}

			// Headings
			const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
			if (headingMatch) {
				flushParagraph();
				flushList();
				flushQuote();
				const level = headingMatch[1].length;
				blocks.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
				continue;
			}

			// Quotes
			const quoteMatch = line.match(/^>\s?(.*)$/);
			if (quoteMatch) {
				flushParagraph();
				flushList();
				quoteLines.push(quoteMatch[1]);
				continue;
			} else {
				flushQuote();
			}

			// Ordered list
			const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
			if (orderedMatch) {
				flushParagraph();
				if (listType && listType !== "ol") flushList();
				listType = "ol";
				listItems.push(orderedMatch[1]);
				continue;
			}

			// Unordered list
			const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
			if (unorderedMatch) {
				flushParagraph();
				if (listType && listType !== "ul") flushList();
				listType = "ul";
				listItems.push(unorderedMatch[1]);
				continue;
			}

			// Normal paragraph
			if (listItems.length) flushList();
			paragraph.push(line);
		}

		flushParagraph();
		flushList();
		flushQuote();
		if (inCode) flushCode();

		return blocks.join("");
	}

	function forceScrollableLayout() {
		// This is the part that fixes the missing scroll region.
		chatContainer.style.overflowY = "auto";
		chatContainer.style.overflowX = "hidden";
		chatContainer.style.minHeight = "0";
		chatContainer.style.maxHeight = "none";
		chatContainer.style.webkitOverflowScrolling = "touch";
		chatContainer.style.scrollBehavior = "smooth";
		chatContainer.style.display = "flex";
		chatContainer.style.flexDirection = "column";
		chatContainer.style.gap = "14px";

		chatStage.style.minHeight = "0";
		chatStage.style.overflow = "hidden";

		if (document.body) {
			document.body.style.overflow = "hidden";
		}
		if (document.documentElement) {
			document.documentElement.style.overflow = "hidden";
		}
	}

	function syncChatHeight() {
		// Make the chat container occupy the exact remaining height inside the stage.
		const stageStyles = getComputedStyle(chatStage);
		const padTop = parseFloat(stageStyles.paddingTop) || 0;
		const padBottom = parseFloat(stageStyles.paddingBottom) || 0;
		const gap = parseFloat(stageStyles.rowGap || stageStyles.gap || "0") || 0;

		const headerHeight = chatHeader ? chatHeader.offsetHeight : 0;
		const composerHeight = composerWrap ? composerWrap.offsetHeight : 0;

		const stageRect = chatStage.getBoundingClientRect();
		const available = Math.floor(
			stageRect.height - padTop - padBottom - headerHeight - composerHeight - (gap * 2) - 8
		);

		const finalHeight = Math.max(220, available);

		chatContainer.style.height = `${finalHeight}px`;
		chatContainer.style.maxHeight = `${finalHeight}px`;
		chatContainer.style.minHeight = `${finalHeight}px`;
	}

	function scrollToBottom(immediate = false) {
		const behavior = immediate ? "auto" : "smooth";

		// 1) Scroll internal chat container
		chatContainer.scrollTo({
			top: chatContainer.scrollHeight,
			left: 0,
			behavior,
		});

		// 2) Anchor-based fallback
		requestAnimationFrame(() => {
			scrollAnchor.scrollIntoView({
				block: "end",
				inline: "nearest",
				behavior,
			});
			chatContainer.scrollTop = chatContainer.scrollHeight;
		});

		// 3) Late layout fallback for wrapped text / markdown blocks
		setTimeout(() => {
			scrollAnchor.scrollIntoView({
				block: "end",
				inline: "nearest",
				behavior: "auto",
			});
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}, 50);
	}

	function setBusy(value) {
		isBusy = value;
		sendBtn.disabled = value;
		sendBtn.style.opacity = value ? "0.75" : "1";
		sendBtn.style.cursor = value ? "wait" : "pointer";
	}

	function clearEmptyStateIfNeeded() {
		const emptyState = chatContainer.querySelector(".empty-state");
		if (emptyState) emptyState.remove();
	}

	function createMessage(content, role = "bot") {
		clearEmptyStateIfNeeded();

		const wrapper = document.createElement("div");
		wrapper.className = `message ${role}`;

		if (role === "bot") {
			wrapper.innerHTML = renderMarkdown(content);
		} else {
			wrapper.innerHTML = escapeHtml(content).replace(/\n/g, "<br>");
		}

		chatContainer.insertBefore(wrapper, scrollAnchor);

		wrapper.style.opacity = "0";
		wrapper.style.transform = "translateY(10px) scale(0.99)";

		requestAnimationFrame(() => {
			wrapper.style.transition = "opacity 220ms ease, transform 220ms ease";
			wrapper.style.opacity = "1";
			wrapper.style.transform = "translateY(0) scale(1)";
			syncChatHeight();
			scrollToBottom(false);
		});

		return wrapper;
	}

	function showTyping() {
		removeTyping();

		typingEl = document.createElement("div");
		typingEl.className = "message bot";
		typingEl.id = "typing-indicator";
		typingEl.innerHTML = "<em>Thinking…</em>";

		chatContainer.insertBefore(typingEl, scrollAnchor);
		syncChatHeight();
		scrollToBottom(false);
	}

	function removeTyping() {
		if (typingEl && typingEl.parentNode) {
			typingEl.parentNode.removeChild(typingEl);
		}
		typingEl = null;
	}

	function autoResizeTextarea() {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 170) + "px";
		syncChatHeight();
		scrollToBottom(true);
	}

	async function apiJson(url, payload) {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload ?? {}),
		});

		let data = {};
		try {
			data = await res.json();
		} catch {
			// ignore parse errors
		}

		if (!res.ok) {
			throw new Error(data?.error || `Request failed (${res.status})`);
		}

		return data;
	}

	async function analyzePrompt(prompt) {
		showTyping();

		try {
			const data = await apiJson("/analyze_prompt", { prompt });

			removeTyping();

			if (!data.questions) {
				createMessage("I could not generate follow-up questions.", "bot");
				return;
			}

			createMessage(`## I need a little more detail\n\n${data.questions}`, "bot");
			stage = "waiting_answers";
		} catch (err) {
			removeTyping();
			createMessage(`**Error:** ${err.message}`, "bot");
		} finally {
			setBusy(false);
			syncChatHeight();
			scrollToBottom(false);
		}
	}

	async function submitAnswers(answers) {
		showTyping();

		try {
			await apiJson("/submit_answers", { answers });
			removeTyping();

			createMessage("Generating your optimized prompt…", "bot");
			await generateFinal();
		} catch (err) {
			removeTyping();
			createMessage(`**Error:** ${err.message}`, "bot");
			setBusy(false);
		}
	}

	async function generateFinal() {
		showTyping();

		try {
			const data = await apiJson("/generate_final", {});
			removeTyping();

			if (!data.final_prompt) {
				createMessage("Final prompt generation returned no content.", "bot");
				return;
			}

			createMessage(`## Final Version\n\n${data.final_prompt}`, "bot");
			stage = "initial";
		} catch (err) {
			removeTyping();
			createMessage(`**Error:** ${err.message}`, "bot");
		} finally {
			setBusy(false);
			syncChatHeight();
			scrollToBottom(false);
		}
	}

	async function handleSend() {
		if (isBusy) return;

		const text = input.value.trim();
		if (!text) return;

		createMessage(text, "user");
		input.value = "";
		autoResizeTextarea();

		setBusy(true);

		if (stage === "initial") {
			await analyzePrompt(text);
		} else if (stage === "waiting_answers") {
			await submitAnswers(text);
		} else {
			setBusy(false);
			stage = "initial";
			createMessage("The conversation has been reset. Please send the prompt again.", "bot");
		}
	}

	function loadHistory() {
		if (!historyList) return;

		fetch("/history")
			.then((res) => res.json())
			.then((items) => {
				historyList.innerHTML = "";

				if (!Array.isArray(items) || items.length === 0) {
					const empty = document.createElement("div");
					empty.className = "history-empty";
					empty.textContent = "No history loaded yet.";
					historyList.appendChild(empty);
					return;
				}

				items.forEach((item) => {
					const card = document.createElement("div");
					card.className = "history-item";

					const title = String(item.original_prompt || "Untitled prompt")
						.replace(/\s+/g, " ")
						.trim();

					card.textContent = title.length > 56 ? `${title.slice(0, 56)}…` : title;

					card.addEventListener("click", () => {
						clearEmptyStateIfNeeded();
						createMessage(`**Previous Prompt**\n\n${item.original_prompt || ""}`, "bot");
						if (item.final_prompt) {
							createMessage(`**Final Version**\n\n${item.final_prompt}`, "bot");
						}
					});

					historyList.appendChild(card);
				});
			})
			.catch((err) => {
				console.error("History load failed:", err);
				historyList.innerHTML = `<div class="history-empty">History could not be loaded.</div>`;
			});
	}

	function wireQuickPrompts() {
		quickPromptButtons.forEach((btn) => {
			btn.addEventListener("click", () => {
				input.value = btn.textContent.trim();
				autoResizeTextarea();
				input.focus();
			});
		});
	}

	// Events
	input.addEventListener("input", autoResizeTextarea);

	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	});

	sendBtn.addEventListener("click", handleSend);

	input.addEventListener("paste", () => {
		requestAnimationFrame(autoResizeTextarea);
	});

	// Strong scroll enforcement on content updates
	const observer = new MutationObserver(() => {
		syncChatHeight();
		scrollToBottom(true);
	});
	observer.observe(chatContainer, {
		childList: true,
		subtree: true,
		characterData: true,
	});

	// Recompute available height on layout changes
	const resizeObserver = new ResizeObserver(() => {
		syncChatHeight();
		scrollToBottom(true);
	});
	resizeObserver.observe(chatStage);
	if (composerWrap) resizeObserver.observe(composerWrap);
	if (chatHeader) resizeObserver.observe(chatHeader);

	window.addEventListener("load", () => {
		forceScrollableLayout();
		syncChatHeight();
		autoResizeTextarea();
		loadHistory();
		wireQuickPrompts();
		scrollToBottom(true);
		input.focus();
	});

	window.addEventListener("resize", () => {
		forceScrollableLayout();
		syncChatHeight();
		scrollToBottom(true);
	});

	// Expose a small debug hook
	window.CyrusChat = {
		get stage() {
			return stage;
		},
		reset() {
			stage = "initial";
			setBusy(false);
		},
		scrollToBottom,
		syncChatHeight,
		renderMarkdown,
	};
})();
