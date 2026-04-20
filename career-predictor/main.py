import logging
import pandas as pd
from predictor import Predictor


def clean_labels(df: pd.DataFrame) -> list[str]:
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


def predict_trajectory(
    predictor,
    start_history,
    steps=3,
):
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
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    logger.info("Loading ESCO occupation strings")
    occupations_csv = pd.read_csv("occupations_en.csv")
    labels = clean_labels(occupations_csv)

    logger.info("Initializing predictor")
    predictor = Predictor(
        embedding_model_path="ElenaSenger/career-path-representation-mpnet-karrierewege",
        label_texts=labels,
        transformation_model_path="matrix_T_karrierewege.npy",
        transformation_method="linear",
    )

    start_history = ["software engineer"]
    logger.info(f"Predicting 3-step trajectory for: {start_history}")

    trajectory = predict_trajectory(
        predictor=predictor,
        start_history=start_history,
        steps=3,
        top_k=1,
    )

    print("Predicted trajectory:")
    for i, role in enumerate(trajectory, start=1):
        print(f"{i}. {role}")