/* ChatScript.js
   Frontend-only behavior for the prompt improvement flow:
   /analyze_prompt -> /submit_answers -> /generate_final
*/

(() => {
	"use strict";

	const chatContainer = document.getElementById("chat-container");
	const input = document.getElementById("chat-input");
	const sendBtn = document.getElementById("send-btn");
	const historyList = document.getElementById("history-list");
	const quickPromptButtons = document.querySelectorAll(".prompt-chip");

	if (!chatContainer || !input || !sendBtn) {
		console.error("Chat UI elements not found.");
		return;
	}

	let stage = "initial"; // initial -> waiting_answers -> final_ready
	let isBusy = false;
	let typingEl = null;

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function scrollToBottom(smooth = true) {
		chatContainer.scrollTo({
			top: chatContainer.scrollHeight,
			behavior: smooth ? "smooth" : "auto",
		});
	}

	function setBusy(value) {
		isBusy = value;
		sendBtn.disabled = value;
		input.disabled = false; // keep textarea usable for edits
		sendBtn.style.opacity = value ? "0.75" : "1";
		sendBtn.style.cursor = value ? "wait" : "pointer";
	}

	function createMessage(content, role = "bot") {
		const wrapper = document.createElement("div");
		wrapper.className = `message ${role}`;
		wrapper.innerHTML = escapeHtml(content).replace(/\n/g, "<br>");

		// Force a nicer entrance animation
		wrapper.style.opacity = "0";
		wrapper.style.transform = "translateY(10px) scale(0.99)";
		chatContainer.appendChild(wrapper);

		requestAnimationFrame(() => {
			wrapper.style.transition = "opacity 220ms ease, transform 220ms ease";
			wrapper.style.opacity = "1";
			wrapper.style.transform = "translateY(0) scale(1)";
		});

		scrollToBottom(true);
		return wrapper;
	}

	function showTyping() {
		removeTyping();

		typingEl = document.createElement("div");
		typingEl.className = "message bot";
		typingEl.id = "typing-indicator";
		typingEl.textContent = "Thinking";

		chatContainer.appendChild(typingEl);
		scrollToBottom(true);
	}

	function removeTyping() {
		if (typingEl && typingEl.parentNode) {
			typingEl.parentNode.removeChild(typingEl);
		}
		typingEl = null;
	}

	function clearEmptyStateIfNeeded() {
		const emptyState = chatContainer.querySelector(".empty-state");
		if (emptyState) emptyState.remove();
	}

	function autoResizeTextarea() {
		input.style.height = "auto";
		input.style.height = Math.min(input.scrollHeight, 170) + "px";
	}

	function setInputValue(text) {
		input.value = text;
		autoResizeTextarea();
		input.focus();
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
			// ignore parse errors and fall through
		}

		if (!res.ok) {
			const message = data?.error || `Request failed (${res.status})`;
			throw new Error(message);
		}

		return data;
	}

	async function analyzePrompt(prompt) {
		showTyping();

		try {
			const data = await apiJson("/analyze_prompt", { prompt });

			removeTyping();
			clearEmptyStateIfNeeded();

			if (!data.questions) {
				createMessage("I could not generate follow-up questions.", "bot");
				return;
			}

			createMessage(
				`I need a little more detail to improve the prompt:\n\n${data.questions}`,
				"bot"
			);

			stage = "waiting_answers";
		} catch (err) {
			removeTyping();
			createMessage(`Error: ${err.message}`, "bot");
		} finally {
			setBusy(false);
		}
	}

	async function submitAnswers(answers) {
		showTyping();

		try {
			await apiJson("/submit_answers", { answers });
			removeTyping();

			createMessage("Generating your optimized prompt...", "bot");
			await generateFinal();
		} catch (err) {
			removeTyping();
			createMessage(`Error: ${err.message}`, "bot");
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

			createMessage(`Here is your optimized prompt:\n\n${data.final_prompt}`, "bot");
			stage = "initial";
		} catch (err) {
			removeTyping();
			createMessage(`Error: ${err.message}`, "bot");
		} finally {
			setBusy(false);
		}
	}

	async function handleSend() {
		if (isBusy) return;

		const text = input.value.trim();
		if (!text) return;

		clearEmptyStateIfNeeded();
		createMessage(text, "user");

		input.value = "";
		autoResizeTextarea();

		setBusy(true);

		if (stage === "initial") {
			await analyzePrompt(text);
		} else if (stage === "waiting_answers") {
			await submitAnswers(text);
		} else {
			// fallback, should not usually happen
			setBusy(false);
			createMessage("The conversation is resetting. Please send the prompt again.", "bot");
			stage = "initial";
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

					const title = (item.original_prompt || "Untitled prompt")
						.replace(/\s+/g, " ")
						.trim();

					card.textContent = title.length > 48 ? title.slice(0, 48) + "…" : title;

					card.addEventListener("click", () => {
						clearEmptyStateIfNeeded();
						createMessage(`Previous Prompt:\n${item.original_prompt || ""}`, "user");
						if (item.final_prompt) {
							createMessage(`Final Version:\n${item.final_prompt}`, "bot");
						}
					});

					historyList.appendChild(card);
				});
			})
			.catch((err) => {
				console.error("History load failed:", err);
				historyList.innerHTML = `
					<div class="history-empty">
						History could not be loaded.
					</div>
				`;
			});
	}

	function wireQuickPrompts() {
		quickPromptButtons.forEach((btn) => {
			btn.addEventListener("click", () => {
				const text = btn.textContent.trim();
				setInputValue(text);
			});
		});
	}

	function initEmptyStateInteractions() {
		const emptyState = chatContainer.querySelector(".empty-state");
		if (!emptyState) return;

		emptyState.addEventListener("click", () => {
			input.focus();
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

	// Small quality-of-life improvement for paste and focus
	input.addEventListener("paste", () => {
		requestAnimationFrame(autoResizeTextarea);
	});

	// Init
	window.addEventListener("load", () => {
		autoResizeTextarea();
		loadHistory();
		wireQuickPrompts();
		initEmptyStateInteractions();
		scrollToBottom(false);
	});

	// Keep layout stable when viewport changes on mobile
	window.addEventListener("resize", () => {
		autoResizeTextarea();
	});

	// Expose a tiny debug hook if needed in browser console
	window.CyrusChat = {
		get stage() {
			return stage;
		},
		reset() {
			stage = "initial";
			setBusy(false);
		},
	};
})();
