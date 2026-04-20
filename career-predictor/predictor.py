from abc import ABC, abstractmethod
import numpy as np
from sentence_transformers import SentenceTransformer
from typing import List
import faiss  

class TransformationModel(ABC):
    @abstractmethod
    def transform(self, vector):
        pass


class LinearTransformationModel(TransformationModel):
    def __init__(self, transformation_matrix_path):
        self.transformation_matrix = np.load(transformation_matrix_path)

    def transform(self, np_2d_array):
        transformed_2d_array = np_2d_array @ self.transformation_matrix
        return transformed_2d_array

class LabelSpace:
    def __init__(self, embedding_model, label_texts):
        self.embedding_model = embedding_model
        self.label_texts = label_texts
        # Precompute label embeddings and build Faiss index
        self.label_embeddings = self.__get_label_embeddings()
        self.__build_faiss_index()

    def __get_label_embeddings(self):
        embeddings = self.embedding_model.encode(self.label_texts)
        # Normalize embeddings to unit length for cosine similarity
        embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
        return embeddings.astype('float32')

    def __build_faiss_index(self):
        d = self.label_embeddings.shape[1]  # dimension
        self.index = faiss.IndexFlatIP(d)  # Inner Product index
        self.index.add(self.label_embeddings)

    def lookup_closest_labels(self, embeddings, top_k=10):
        # Normalize query embeddings
        embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
        embeddings = embeddings.astype('float32')
        distances, indices = self.index.search(embeddings, top_k)
        return indices, distances

class LabelPredictor:
    def __init__(self, embedding_model, label_texts, transformation_model=None):
        self.label_space = LabelSpace(embedding_model, label_texts)
        self.transformation_model = transformation_model
        self.label_texts = label_texts.copy()
        self.embedding_model = embedding_model

    def predict(self, texts: List[str], top_k=10):
        embeddings = self.embedding_model.encode(texts)
        if self.transformation_model is not None:
            embeddings = self.transformation_model.transform(embeddings)
        # Normalize embeddings
        embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
        # Use Faiss index to find closest labels
        most_similar_indices, similarities = self.label_space.lookup_closest_labels(
            embeddings, top_k
        )
        # Build predictions
        predictions = []
        for indices in most_similar_indices:
            predictions.append([self.label_texts[i] for i in indices])
        return predictions

class Predictor:
    def __init__(
        self,
        embedding_model_path,
        label_texts,
        transformation_model_path=None,
        transformation_method=None,
        embedding_type="sentence_transformer", # Can be 'sentence_transformer' or 'llama'
    ):
        assert embedding_type in ['sentence_transformer', 'llama'], f"Invalid embedding_type: {embedding_type}"
        if embedding_type == 'sentence_transformer':
            embedding_model = SentenceTransformer(embedding_model_path)
        else:
            raise ValueError(f"Invalid embedding_type: {embedding_type}")
        transformation_model = None
        if transformation_method is not None:
            if transformation_method == "neural":
                transformation_model = MLPTransformationModel(transformation_model_path)
            elif transformation_method == "linear":
                transformation_model = LinearTransformationModel(transformation_model_path)
            else:
                raise ValueError(f"Invalid transformation_method: {transformation_method}")
        self.label_predictor = LabelPredictor(
            embedding_model, label_texts, transformation_model
        )
        self.transformation_method = transformation_method

    def predict(self, data):
        return self.label_predictor.predict(data)

