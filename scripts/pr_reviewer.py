import os
import sys
import json
import re
import time
import requests
from openai import OpenAI

# ---------------------------------------------------------------------------
# API Setup
# ---------------------------------------------------------------------------
nvidia_client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.getenv("NVIDIA_API_KEY", "")
)

opencode_client = OpenAI(
    base_url=os.getenv("OPENCODE_BASE_URL", "https://api.opencode.zen/v1"),
    api_key=os.getenv("OPENCODE_API_KEY", "")
)

SCANNER_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"
HEAVY_MODELS = [
    (opencode_client, "deepseek-v4-flash-free", "OpenCode Zen (DeepSeek)"),
    (nvidia_client, "nvidia/nemotron-3-ultra-550b-a55b", "NVIDIA Nemotron 3 Ultra"),
    (nvidia_client, "minimaxai/minimax-m3", "NVIDIA MiniMax M3")
]

BOT_SIGNATURE = "<!-- automated-pr-reviewer-comment -->"

# ---------------------------------------------------------------------------
# Resilient LLM Helpers
# ---------------------------------------------------------------------------
def extract_clean_json(text: str) -> dict:
    """Extracts JSON even if enclosed in markdown code fences or conversational text."""
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    clean_text = match.group(1).strip() if match else text.strip()
    return json.loads(clean_text)

def call_with_retry(client, model, messages, max_retries=2, timeout=45):
    for attempt in range(max_retries + 1):
        try:
            res = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                timeout=timeout
            )
            return res.choices[0].message.content
        except Exception as e:
            if attempt == max_retries:
                raise e
            time.sleep(2 ** attempt)

# ---------------------------------------------------------------------------
# Tier 1: Triage & Filter
# ---------------------------------------------------------------------------
def triage_diff(diff_text: str) -> dict:
    prompt = (
        "You are an automated senior code reviewer. Analyze the patch.\n"
        "Return STRICT JSON only. Format:\n"
        "{\n"
        '  "quick_comments": ["comment 1", "comment 2"],\n'
        '  "needs_escalation": false,\n'
        '  "escalation_reason": "string or null",\n'
        '  "critical_files": ["path/to/file.ext"]\n'
        "}"
    )

    try:
        raw = call_with_retry(
            nvidia_client,
            SCANNER_MODEL,
            [
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"Patch:\n\n{diff_text[:60000]}"}
            ]
        )
        return extract_clean_json(raw)
    except Exception as err:
        print(f"[Tier 1 Scanner Failed]: {err}")
        return {
            "quick_comments": ["Automated fast scan failed. Escalating diff for complete review."],
            "needs_escalation": True,
            "escalation_reason": "Scanner timeout or schema error.",
            "critical_files": []
        }

# ---------------------------------------------------------------------------
# Tier 2: Deep Review Waterfall
# ---------------------------------------------------------------------------
def deep_review_cascade(diff_text: str, reason: str) -> str:
    messages = [
        {"role": "system", "content": "You are a Principal Engineer. Review this code for edge cases, memory safety, and concurrency bugs."},
        {"role": "user", "content": f"Reason for escalation: {reason}\n\nDiff:\n{diff_text[:35000]}"}
    ]

    for client, model_id, model_name in HEAVY_MODELS:
        try:
            print(f"-> Routing to {model_name}...")
            return call_with_retry(client, model_id, messages)
        except Exception as err:
            print(f"[Provider Failure] {model_name} failed: {err}")
            continue

    return "⚠️ Deep analysis could not run: all fallback providers were rate-limited or unavailable."

# ---------------------------------------------------------------------------
# GitHub Interaction (Upsert comment to avoid spam)
# ---------------------------------------------------------------------------
def upsert_github_comment(repo: str, pr_num: str, token: str, content: str):
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json"
    }
    body_with_sig = f"{content}\n\n{BOT_SIGNATURE}"
    
    # 1. Look for existing comment
    comments_url = f"https://api.github.com/repos/{repo}/issues/{pr_num}/comments"
    res = requests.get(comments_url, headers=headers)
    
    if res.ok:
        for comment in res.json():
            if BOT_SIGNATURE in comment.get("body", ""):
                # Update existing comment
                comment_id = comment["id"]
                patch_url = f"https://api.github.com/repos/{repo}/issues/comments/{comment_id}"
                requests.patch(patch_url, headers=headers, json={"body": body_with_sig})
                print(f"Updated existing review comment #{comment_id}")
                return

    # Create new comment if none exists
    requests.post(comments_url, headers=headers, json={"body": body_with_sig})
    print("Posted new review comment.")

# ---------------------------------------------------------------------------
# Main Execution
# ---------------------------------------------------------------------------
def main():
    repo = os.getenv("TRAVIS_REPO_SLUG")
    pr_num = os.getenv("TRAVIS_PULL_REQUEST")
    gh_token = os.getenv("GITHUB_TOKEN")

    if not pr_num or pr_num == "false":
        sys.exit(0)

    # Fetch diff
    headers = {"Authorization": f"token {gh_token}", "Accept": "application/vnd.github.v3.diff"}
    diff_res = requests.get(f"https://api.github.com/repos/{repo}/pulls/{pr_num}", headers=headers)
    diff = diff_res.text

    if not diff.strip():
        sys.exit(0)

    # 1. Run Fast Triage
    triage = triage_diff(diff)

    # 2. Run Escalated Review if required
    deep_analysis = ""
    if triage.get("needs_escalation"):
        deep_analysis = deep_review_cascade(diff, triage.get("escalation_reason", "Complex logic"))

    # 3. Format Comment Body
    comment = "## 🤖 Automated PR Review\n\n"
    if triage.get("quick_comments"):
        comment += "### ⚡ Fast Triage (Nemotron 3.5 Lightning)\n"
        for qc in triage["quick_comments"]:
            comment += f"- {qc}\n"
        comment += "\n"

    if deep_analysis:
        comment += f"### 🧠 Deep Reasoning\n{deep_analysis}\n"

    upsert_github_comment(repo, pr_num, gh_token, comment)

if __name__ == "__main__":
    main()