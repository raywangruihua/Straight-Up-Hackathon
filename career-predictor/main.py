import logging
import pandas as pd
from predictor import Predictor


if __name__ == "__main__":
    # Initialize logs
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

    # Load ESCO occupation strings
    logger.info("Loading ESCO occupation strings")
    occupations_csv = pd.read_csv("occupations_en.csv")
    labels = occupations_csv["preferredLabel"].dropna().tolist()
    alt_labels = occupations_csv["altLabels"].dropna().tolist()

    for alt in alt_labels:
        for a in alt.split("\n"):
            labels.append(a)

    # Initialize predictor
    logger.info("Initializing predictor")
    predictor = Predictor(
        embedding_model_path="ElenaSenger/career-path-representation-mpnet-karrierewege", # Download locally to reduce start up time
        label_texts=labels,
        transformation_model_path="matrix_T_karrierewege.npy",
        transformation_method="linear"
    )

    history = ["software engineer"]
    logger.info(f"Predicting trajectory for: {history}")
    trajectory = predictor.predict(history)
    print(trajectory)
