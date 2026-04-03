from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from authlib.integrations.flask_client import OAuth
from authlib.integrations.base_client.errors import MismatchingStateError, OAuthError

from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import SystemMessage, UserMessage
from azure.core.credentials import AzureKeyCredential


# -----------------------------
# Load environment variables
# -----------------------------
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")


# -----------------------------
# AI Configuration
# -----------------------------
token = os.getenv("GITHUB_TOKEN")

client = ChatCompletionsClient(
    endpoint="https://models.github.ai/inference",
    credential=AzureKeyCredential(token),
)


# -----------------------------
# MongoDB Configuration
# -----------------------------
MONGO_URI = os.getenv("MONGO_URI")
mongo_client = MongoClient(MONGO_URI)

db = mongo_client["lionel_ai"]
users_collection = db["users"]
prompts_collection = db["prompts"]


# -----------------------------
# OAuth Configuration
# -----------------------------
oauth = OAuth(app)

google = oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


# -----------------------------
# Routes (UNCHANGED)
# -----------------------------
@app.route("/")
def home():
    return render_template("index.html")


@app.route("/login")
def login():
    return render_template("login.html")


@app.route("/chat")
def chat():
    if "user" not in session:
        return redirect("/login")
    return render_template("chat.html")


# -----------------------------
# Google Login (UNCHANGED)
# -----------------------------
@app.route("/auth/google")
def google_login():
    redirect_uri = url_for("google_callback", _external=True)
    return google.authorize_redirect(redirect_uri)


@app.route("/auth/callback")
def google_callback():
    try:
        token = google.authorize_access_token()
        user = token["userinfo"]

    except (MismatchingStateError, OAuthError):
        session.clear()
        return redirect(url_for("login"))

    session["user"] = {
        "email": user["email"],
        "name": user["name"],
        "google_id": user["sub"],
    }

    users_collection.update_one(
        {"google_id": user["sub"]},
        {"$set": {"email": user["email"], "name": user["name"]}},
        upsert=True,
    )

    return redirect("/chat")


# -----------------------------
# Logout (UNCHANGED)
# -----------------------------
@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# =========================================================
# NEW PROMPT OPTIMIZATION FLOW (NON-DESTRUCTIVE ADDITION)
# =========================================================


# -----------------------------
# Step 1 → Analyze + Ask Questions
# -----------------------------
@app.route("/analyze_prompt", methods=["POST"])
def analyze_prompt():

    if "user" not in session:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    user_prompt = data.get("prompt", "").strip()

    if not user_prompt:
        return jsonify({"error": "Empty prompt"}), 400

    # Store prompt
    session["original_prompt"] = user_prompt

    response = client.complete(
        messages=[
            SystemMessage("You are an expert prompt engineer."),
            UserMessage(f"""
User Prompt:
{user_prompt}

We structure prompts using:
1. Persona
2. Context
3. Task
4. Example
5. Tone
6. Format

Analyze the prompt and generate 4-6 counter questions
to fill missing information for these components.

Return only questions.
"""),
        ],
        temperature=0.6,
        max_tokens=300,
        model="deepseek/DeepSeek-V3-0324",
    )

    questions = response.choices[0].message.content

    session["questions"] = questions

    return jsonify({"stage": "questions", "questions": questions})


# -----------------------------
# Step 2 → Store Answers
# -----------------------------
@app.route("/submit_answers", methods=["POST"])
def submit_answers():

    if "user" not in session:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    answers = data.get("answers", "").strip()

    if not answers:
        return jsonify({"error": "Answers required"}), 400

    session["answers"] = answers

    return jsonify({"stage": "answers_received"})


# -----------------------------
# Step 3 → Generate Final Prompt
# -----------------------------
@app.route("/generate_final", methods=["POST"])
def generate_final():

    if "user" not in session:
        return jsonify({"error": "Not authenticated"}), 401

    original_prompt = session.get("original_prompt")
    questions = session.get("questions")
    answers = session.get("answers")

    if not original_prompt or not answers:
        return jsonify({"error": "Incomplete flow"}), 400

    response = client.complete(
        messages=[
            SystemMessage("You generate high-quality structured prompts."),
            UserMessage(f"""
Original Prompt:
{original_prompt}

Questions:
{questions}

User Answers:
{answers}

Now generate a final optimized prompt using:

Persona:
Context:
Task:
Example:
Tone:
Format:

Make it clean, structured, and usable.
"""),
        ],
        temperature=0.7,
        max_tokens=500,
        model="deepseek/DeepSeek-V3-0324",
    )

    final_prompt = response.choices[0].message.content

    # Save to DB (compatible with existing history system)
    prompts_collection.insert_one(
        {
            "user_id": session["user"]["google_id"],
            "email": session["user"]["email"],
            "original_prompt": original_prompt,
            "questions": questions,
            "answers": answers,
            "final_prompt": final_prompt,
        }
    )

    # Clear session (one cycle only)
    session.pop("original_prompt", None)
    session.pop("questions", None)
    session.pop("answers", None)

    return jsonify({"stage": "completed", "final_prompt": final_prompt})


# -----------------------------
# History (UNCHANGED)
# -----------------------------
@app.route("/history")
def history():

    if "user" not in session:
        return jsonify([])

    prompts = list(
        prompts_collection.find({"user_id": session["user"]["google_id"]}, {"_id": 0})
        .sort("_id", -1)
        .limit(10)
    )

    return jsonify(prompts)


# -----------------------------
# Run Server
# -----------------------------
if __name__ == "__main__":
    app.run(debug=True)
