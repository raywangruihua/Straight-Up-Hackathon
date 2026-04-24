import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from predictor import Predictor


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000
DEFAULT_STEPS = 3
VALID_FAMILY_INTENTS = {"soon", "later", "unsure", "no"}


def serialize_history(history: list[str]) -> str:
    cleaned = [role.strip() for role in history if role and role.strip()]
    return " -> ".join(cleaned)


def normalize_profile(raw_profile: object) -> dict[str, object]:
    if not isinstance(raw_profile, dict):
        return {"age": None, "current_job": "", "family_intent": None}

    age = raw_profile.get("age")
    current_job = raw_profile.get("currentJob")
    family_intent = raw_profile.get("familyIntent")

    return {
        "age": age if isinstance(age, int) and age >= 0 else None,
        "current_job": current_job.strip() if isinstance(current_job, str) else "",
        "family_intent": family_intent if family_intent in VALID_FAMILY_INTENTS else None,
    }


def merge_history_with_profile(history: list[str], profile: dict[str, object]) -> list[str]:
    cleaned_history = [role.strip() for role in history if role and role.strip()]
    current_job = str(profile.get("current_job") or "").strip()

    if current_job and all(current_job.lower() != role.lower() for role in cleaned_history):
        cleaned_history.append(current_job)

    return cleaned_history


def derive_prediction_steps(requested_steps: object, profile: dict[str, object]) -> int:
    steps = requested_steps if isinstance(requested_steps, int) else DEFAULT_STEPS
    steps = max(2, min(steps, 5))

    family_intent = profile.get("family_intent")
    age = profile.get("age")

    if family_intent == "soon":
        return min(steps, 2 if isinstance(age, int) and age >= 30 else 3)
    if family_intent == "no":
        return min(5, steps + 1)
    if family_intent == "later" and isinstance(age, int) and age < 30:
        return min(5, steps + 1)

    return steps


def build_prediction_query(history: list[str], profile: dict[str, object]) -> str:
    query = serialize_history(history)
    age = profile.get("age")
    family_intent = profile.get("family_intent")

    stage_hint = ""
    if isinstance(age, int):
        if age < 28:
            stage_hint = "early career"
        elif age < 35:
            stage_hint = "mid career"
        else:
            stage_hint = "experienced career"

    context_parts = []
    if stage_hint:
        context_parts.append(stage_hint)
    if family_intent == "soon":
        context_parts.append("family planning soon")
    elif family_intent == "later":
        context_parts.append("family planning later")
    elif family_intent == "no":
        context_parts.append("career growth focus")

    if not context_parts:
        return query

    return f"{query}. Context: {', '.join(context_parts)}."


def build_profile_milestone(profile: dict[str, object]) -> dict[str, str] | None:
    family_intent = profile.get("family_intent")
    current_job = str(profile.get("current_job") or "your current role").strip() or "your current role"

    if family_intent == "soon":
        return {
            "name": "Family Planning & Re-entry",
            "description": (
                f"You indicated that starting a family may happen soon, so this waypoint highlights the "
                f"need to plan leave coverage, skill continuity, and a confident re-entry path from {current_job}."
            ),
        }
    if family_intent == "later":
        return {
            "name": "Career Runway Before Family",
            "description": (
                f"This scenario assumes some runway to build momentum from {current_job} before a later family-planning pivot."
            ),
        }
    if family_intent == "unsure":
        return {
            "name": "Flexibility Checkpoint",
            "description": (
                f"This waypoint keeps optionality open by balancing growth from {current_job} with roles that may be easier to pause and re-enter."
            ),
        }
    if family_intent == "no":
        return {
            "name": "Career Acceleration Window",
            "description": (
                f"This scenario emphasizes uninterrupted progression from {current_job}, with fewer pauses and a longer promotion runway."
            ),
        }

    return None


def inject_profile_milestone(
    trajectory: list[dict[str, str]], profile: dict[str, object]
) -> list[dict[str, str]]:
    milestone = build_profile_milestone(profile)
    if milestone is None:
        return trajectory

    insert_at = 1 if profile.get("family_intent") in {"soon", "unsure"} else min(2, len(trajectory))
    return trajectory[:insert_at] + [milestone] + trajectory[insert_at:]


def clean_labels(df: pd.DataFrame) -> list[str]:
    labels = df["preferredLabel"].dropna().tolist()
    alt_labels = df["altLabels"].dropna().tolist()

    for alt in alt_labels:
        for a in alt.split("\n"):
            labels.append(a)

    cleaned = []
    seen = set()
    for label in labels:
        label = label.strip()
        if label and label not in seen:
            seen.add(label)
            cleaned.append(label)

    return cleaned


def build_description_lookup(df: pd.DataFrame) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for _, row in df.iterrows():
        description = str(row["description"]).strip() if pd.notna(row["description"]) else ""
        preferred = str(row["preferredLabel"]).strip()
        if preferred:
            lookup[preferred.lower()] = description
        if pd.notna(row["altLabels"]):
            for alt in str(row["altLabels"]).split("\n"):
                alt = alt.strip()
                if alt and alt.lower() not in lookup:
                    lookup[alt.lower()] = description
    return lookup


app = Flask(__name__)
CORS(app)

# Load and clean labels
occupations_csv = pd.read_csv("occupations_en.csv")
labels = clean_labels(occupations_csv)
description_lookup = build_description_lookup(occupations_csv)

# Load predictor
predictor = Predictor(
    embedding_model_path="ElenaSenger/career-path-representation-mpnet-karrierewege",
    label_texts=labels,
    transformation_model_path="matrix_T_karrierewege.npy",
    transformation_method="linear",
)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/predict-trajectory", methods=["POST"])
def predict_trajectory():
    data = request.get_json() or {}
    profile = normalize_profile(data.get("profile", {}))
    start_history = merge_history_with_profile(data.get("history", []), profile)
    steps = derive_prediction_steps(data.get("steps", DEFAULT_STEPS), profile)

    trajectory = [role.strip() for role in start_history if role and role.strip()]
    seen_lower = {role.lower() for role in trajectory}

    for _ in range(steps):
        history_query = build_prediction_query(trajectory, profile)
        if not history_query:
            break

        predictions = predictor.predict([history_query])

        if not predictions or not predictions[0]:
            break

        next_role = None
        for candidate in predictions[0]:
            candidate = candidate.strip()
            if candidate.lower() not in seen_lower:
                next_role = candidate
                break

        if next_role is None:
            break

        trajectory.append(next_role)
        seen_lower.add(next_role.lower())

    result = [
        {
            "name": role.title(),
            "description": description_lookup.get(role.lower(), ""),
        }
        for role in trajectory
    ]

    return jsonify(inject_profile_milestone(result, profile))


if __name__ == "__main__":
    app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, debug=True)
