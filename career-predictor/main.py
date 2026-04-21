import pandas as pd
from flask import Flask
from predictor import Predictor


def clean_labels(df: pd.DataFrame) -> list[str]:
    """
    Remove duplicates and clean labels.
    """
    labels = df["preferredLabel"].dropna().tolist()
    alt_labels = df["altLabels"].dropna().tolist()

    for alt in alt_labels:
        for a in alt.split("\n"):
            labels.append(a)

    # strip whitespace / \r and deduplicate while preserving order
    cleaned = []
    seen = set()
    for label in labels:
        label = label.strip()
        if label and label not in seen:
            seen.add(label)
            cleaned.append(label)

    return cleaned


app = Flask(__name__)

# Load and clean labels
occupations_csv = pd.read_csv("occupations_en.csv")
labels = clean_labels(occupations_csv)

# Initialize models
predictor = Predictor(
    embedding_model_path="ElenaSenger/career-path-representation-mpnet-karrierewege",
    label_texts=labels,
    transformation_model_path="matrix_T_karrierewege.npy",
    transformation_method="linear",
)


@app.route("/predict-trajectory")
def predict_trajectory(
    start_history: list[str],
    steps: int = 3,
) -> list[str]:
    """
    Iteratively predict the next role based on closest neighbours search.
    Appends the highest probability non-repeat next role to trajectory, returns trajectory once there are no more new roles to add.

    Args:
        start_history (list[str]): Career history
        steps (int): Maximum number of predictions to make

    Returns:
        trajectory (list[str]): Career trajectory
    """
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

    return trajectory


if __name__ == "__main__":
    app.run(debug=True)
