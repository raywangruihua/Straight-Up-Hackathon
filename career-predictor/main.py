from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
from flask import Flask
from predictor import Predictor


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


@app.route("/predict-trajectory", methods=["POST"])
def predict_trajectory():
    data = request.get_json()
    start_history: list[str] = data.get("history", [])
    steps: int = data.get("steps", 3)

    history = start_history.copy()
    trajectory = start_history.copy()

    for _ in range(steps):
        predictions = predictor.predict(history)

        if not predictions or not predictions[0]:
            break

        next_role = None
        for candidate in predictions[0]:
            candidate = candidate.strip()
            if candidate not in trajectory:
                next_role = candidate
                break

        if next_role is None:
            break

        trajectory.append(next_role)
        history.append(next_role)

    result = [
        {
            "name": role.title(),
            "description": description_lookup.get(role.lower(), ""),
        }
        for role in trajectory
    ]

    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True)
