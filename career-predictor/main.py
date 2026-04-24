import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from predictor import Predictor


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000


def serialize_history(history: list[str]) -> str:
    cleaned = [role.strip() for role in history if role and role.strip()]
    return " -> ".join(cleaned)


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
    data = request.get_json()
    start_history: list[str] = data.get("history", [])
    steps: int = data.get("steps", 3)

    trajectory = [role.strip() for role in start_history if role and role.strip()]
    seen_lower = {role.lower() for role in trajectory}

    for _ in range(steps):
        history_query = serialize_history(trajectory)
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

    return jsonify(result)


if __name__ == "__main__":
    app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, debug=True)
