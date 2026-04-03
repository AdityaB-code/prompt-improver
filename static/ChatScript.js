/* =========================
   ELEMENTS
========================= */
const chatContainer = document.getElementById("chat-container");
const input = document.getElementById("chat-input");
const sendBtn = document.getElementById("send-btn");
const historyList = document.getElementById("history-list");

/* =========================
   STATE
========================= */
let currentStage = "initial"; 
// initial → questions → waiting_answers → final

let storedQuestions = "";

/* =========================
   UTILITIES
========================= */
function scrollToBottom() {
	chatContainer.scrollTop = chatContainer.scrollHeight;
}

function createMessage(content, type = "bot") {
	const msg = document.createElement("div");
	msg.classList.add("message", type);
	msg.innerText = content;
	chatContainer.appendChild(msg);
	scrollToBottom();
}

function showTyping() {
	const typing = document.createElement("div");
	typing.classList.add("message", "bot");
	typing.id = "typing-indicator";
	typing.innerText = "Typing...";
	chatContainer.appendChild(typing);
	scrollToBottom();
}

function removeTyping() {
	const typing = document.getElementById("typing-indicator");
	if (typing) typing.remove();
}

/* =========================
   AUTO RESIZE TEXTAREA
========================= */
input.addEventListener("input", () => {
	input.style.height = "auto";
	input.style.height = input.scrollHeight + "px";
});

/* =========================
   SEND HANDLER
========================= */
async function handleSend() {
	const text = input.value.trim();
	if (!text) return;

	createMessage(text, "user");
	input.value = "";
	input.style.height = "auto";

	if (currentStage === "initial") {
		await analyzePrompt(text);
	} else if (currentStage === "waiting_answers") {
		await submitAnswers(text);
	}
}

/* =========================
   ENTER KEY SUPPORT
========================= */
input.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		handleSend();
	}
});

sendBtn.addEventListener("click", handleSend);

/* =========================
   API CALLS
========================= */

async function analyzePrompt(prompt) {
	showTyping();

	try {
		const res = await fetch("/analyze_prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt })
		});

		const data = await res.json();
		removeTyping();

		if (data.error) {
			createMessage("Error: " + data.error);
			return;
		}

		storedQuestions = data.questions;

		createMessage("I need a bit more information to improve your prompt:\n\n" + data.questions);

		currentStage = "waiting_answers";

	} catch (err) {
		removeTyping();
		createMessage("Something went wrong.");
		console.error(err);
	}
}

async function submitAnswers(answers) {
	showTyping();

	try {
		await fetch("/submit_answers", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ answers })
		});

		removeTyping();

		createMessage("Generating your optimized prompt...");

		await generateFinal();

	} catch (err) {
		removeTyping();
		createMessage("Error submitting answers.");
		console.error(err);
	}
}

async function generateFinal() {
	showTyping();

	try {
		const res = await fetch("/generate_final", {
			method: "POST"
		});

		const data = await res.json();
		removeTyping();

		if (data.error) {
			createMessage("Error: " + data.error);
			return;
		}

		createMessage("Here is your optimized prompt:\n\n" + data.final_prompt);

		currentStage = "initial";

	} catch (err) {
		removeTyping();
		createMessage("Failed to generate final prompt.");
		console.error(err);
	}
}

/* =========================
   LOAD HISTORY
========================= */
async function loadHistory() {
	try {
		const res = await fetch("/history");
		const data = await res.json();

		historyList.innerHTML = "";

		if (!data.length) {
			historyList.innerHTML = `<div class="history-empty">No history yet</div>`;
			return;
		}

		data.forEach((item) => {
			const div = document.createElement("div");
			div.classList.add("history-item");

			div.innerText = item.original_prompt.slice(0, 40) + "...";

			div.onclick = () => {
				createMessage("Previous Prompt:\n" + item.original_prompt, "user");
				createMessage("Final Version:\n" + item.final_prompt, "bot");
			};

			historyList.appendChild(div);
		});

	} catch (err) {
		console.error("History load failed", err);
	}
}

/* =========================
   INIT
========================= */
window.onload = () => {
	loadHistory();
};
