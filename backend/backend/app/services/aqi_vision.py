"""Lazy inference for the supplied UrbanSarthi multimodal AQI category model.

The model was trained with two 128x128 RGB images plus six tabular fields. Its
output is an AQI category, not a numeric AQI measurement or an official station reading.
"""
from __future__ import annotations

import io
import json
import os
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "aqi"
MAX_IMAGE_SIDE = 4096
ALLOWED_SEASONS = {"Monsoon", "Summer", "Winter"}
ALLOWED_DAY_PARTS = {"Day", "Night"}
TABULAR_COLUMNS = ["PM2.5", "PM10", "Temperature", "Humidity", "Season", "Day_or_Night"]


def model_dir() -> Path:
    return Path(os.getenv("AQI_MODEL_DIR", str(DEFAULT_MODEL_DIR))).expanduser()


def _read_config(directory: Path) -> dict[str, Any]:
    config_path = directory / "model_config.json"
    if not config_path.is_file():
        raise FileNotFoundError("AQI model configuration is missing.")
    with config_path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)
    if config.get("architecture") != "MultimodalAQIModel":
        raise RuntimeError("The configured AQI model architecture is not supported.")
    if config.get("num_classes") != 6 or config.get("num_tabular_features") != 9:
        raise RuntimeError("AQI model configuration does not match the supplied checkpoint.")
    if config.get("tabular_columns") != TABULAR_COLUMNS:
        raise RuntimeError("AQI tabular input schema does not match the supplied model.")
    return config


def _create_model(config: dict[str, Any]):
    # Import deep-learning dependencies only when inference is requested. This keeps
    # regular API startup and the existing traffic/AQI observation endpoints lighter.
    import torch
    import torch.nn as nn
    from torchvision import models

    class MultimodalAQIModel(nn.Module):
        """Architecture copied from the supplied UKHack.ipynb model definition."""

        def __init__(self):
            super().__init__()
            self.front_cnn = models.resnet18(weights=None)
            self.front_cnn.fc = nn.Identity()
            self.rear_cnn = models.resnet18(weights=None)
            self.rear_cnn.fc = nn.Identity()
            self.tabular_network = nn.Sequential(
                nn.Linear(config["num_tabular_features"], 32),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.Linear(32, 16),
                nn.ReLU(),
            )
            self.classifier = nn.Sequential(
                nn.Linear(1040, 128),
                nn.ReLU(),
                nn.Dropout(0.3),
                nn.Linear(128, config["num_classes"]),
            )

        def forward(self, front, rear, tabular):
            front_features = self.front_cnn(front)
            rear_features = self.rear_cnn(rear)
            tabular_features = self.tabular_network(tabular)
            combined = torch.cat([front_features, rear_features, tabular_features], dim=1)
            return self.classifier(combined)

    return MultimodalAQIModel()


@lru_cache(maxsize=1)
def _load_bundle():
    import joblib
    import torch
    from torchvision import transforms

    directory = model_dir().resolve()
    config = _read_config(directory)
    required = [
        directory / "urban_sarthi_best_model.pth",
        directory / "preprocessor.joblib",
        directory / "label_encoder.joblib",
    ]
    missing = [path.name for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError("AQI model artifact(s) missing: " + ", ".join(missing))

    # Keep the original transform exactly aligned to the notebook.
    image_transform = transforms.Compose([
        transforms.Resize((int(config["image_size"]), int(config["image_size"]))),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    # Checkpoints contain a state_dict; weights_only avoids unpickling arbitrary checkpoint objects.
    state_dict = torch.load(required[0], map_location="cpu", weights_only=True)
    model = _create_model(config)
    model.load_state_dict(state_dict, strict=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu":
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    model.to(device)
    model.eval()

    # joblib uses pickle internally; these artifacts are the matching supplied project files.
    # The deployed copy should be kept trusted and not replaced by an unverified upload.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        preprocessor = joblib.load(required[1])
        label_encoder = joblib.load(required[2])

    if int(getattr(preprocessor, "n_features_in_", 0)) != len(TABULAR_COLUMNS):
        raise RuntimeError("AQI preprocessor expects a different set of tabular inputs.")
    if len(getattr(label_encoder, "classes_", [])) != int(config["num_classes"]):
        raise RuntimeError("AQI label encoder does not match the configured classes.")
    return model, preprocessor, label_encoder, config, device, image_transform


def status() -> dict[str, Any]:
    directory = model_dir()
    names = ["urban_sarthi_best_model.pth", "preprocessor.joblib", "label_encoder.joblib", "model_config.json"]
    files = {name: (directory / name).is_file() for name in names}
    try:
        import importlib.util
        dependencies = all(importlib.util.find_spec(name) is not None for name in ("torch", "torchvision", "sklearn", "joblib"))
    except (ImportError, ValueError):
        dependencies = False
    return {
        "model": "UrbanSarthi Multimodal AQI Model",
        "architecture": "MultimodalAQIModel (two ResNet18 encoders + tabular network)",
        "ready": all(files.values()) and dependencies,
        "artifacts_present": files,
        "inference_dependencies_available": dependencies,
        "input_images": ["front", "rear"],
        "tabular_columns": TABULAR_COLUMNS,
        "classes": ["Good", "Moderate", "Poor", "Satisfactory", "Severe", "Very Poor"],
        "output_type": "predicted category and model confidence; not a numeric AQI reading",
        "reported_test_metrics": {"accuracy": 0.8209, "macro_f1": 0.7226, "source": "supplied UKHack.ipynb; not independently reproduced"},
        "note": "Requires two road images and user-supplied PM2.5, PM10, temperature, humidity, season, and day/night. Not an official station measurement.",
    }


def _decode_image(raw: bytes, label: str) -> Image.Image:
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.width < 32 or source.height < 32:
                raise ValueError(f"The {label} image is too small. Use an image at least 32 × 32 pixels.")
            # Limit decompressed pixels before forcing decode to reduce image-bomb risk.
            if source.width * source.height > 16_000_000:
                raise ValueError(f"The {label} image has too many pixels. Use an image no larger than 16 megapixels.")
            oriented = ImageOps.exif_transpose(source)
            oriented.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
            image = oriented.convert("RGB")
            image.load()
    except ValueError:
        raise
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError(f"The {label} image could not be decoded. Use a JPG, PNG, or WebP image.") from exc
    return image


def analyze(
    front_raw: bytes,
    rear_raw: bytes,
    *,
    pm25: float,
    pm10: float,
    temperature: float,
    humidity: float,
    season: str,
    day_or_night: str,
) -> dict[str, Any]:
    import numpy as np
    import pandas as pd
    import torch

    if not front_raw or not rear_raw:
        raise ValueError("Capture or upload both a front and rear road image.")
    values = {"PM2.5": pm25, "PM10": pm10, "Temperature": temperature, "Humidity": humidity}
    for field, number in values.items():
        if not np.isfinite(number):
            raise ValueError(f"{field} must be a valid number.")
    if not 0 <= pm25 <= 2000:
        raise ValueError("PM2.5 must be between 0 and 2000 µg/m³.")
    if not 0 <= pm10 <= 2000:
        raise ValueError("PM10 must be between 0 and 2000 µg/m³.")
    if not -50 <= temperature <= 70:
        raise ValueError("Temperature must be between -50 and 70 °C.")
    if not 0 <= humidity <= 100:
        raise ValueError("Humidity must be between 0 and 100%.")
    if season not in ALLOWED_SEASONS:
        raise ValueError("Season must be Monsoon, Summer, or Winter.")
    if day_or_night not in ALLOWED_DAY_PARTS:
        raise ValueError("Time of day must be Day or Night.")

    model, preprocessor, label_encoder, config, device, image_transform = _load_bundle()
    front_image = _decode_image(front_raw, "front")
    rear_image = _decode_image(rear_raw, "rear")
    front_tensor = image_transform(front_image).unsqueeze(0).to(device)
    rear_tensor = image_transform(rear_image).unsqueeze(0).to(device)

    tabular_frame = pd.DataFrame([{
        "PM2.5": pm25,
        "PM10": pm10,
        "Temperature": temperature,
        "Humidity": humidity,
        "Season": season,
        "Day_or_Night": day_or_night,
    }], columns=config["tabular_columns"])
    processed = preprocessor.transform(tabular_frame)
    if hasattr(processed, "toarray"):
        processed = processed.toarray()
    tabular_tensor = torch.tensor(np.asarray(processed, dtype=np.float32), dtype=torch.float32, device=device)
    if tabular_tensor.shape[1] != int(config["num_tabular_features"]):
        raise RuntimeError("Preprocessed sensor inputs do not match the trained model's expected feature count.")

    with torch.inference_mode():
        logits = model(front_tensor, rear_tensor, tabular_tensor)
        probabilities = torch.softmax(logits, dim=1)[0].detach().cpu().numpy()

    predicted_index = int(np.argmax(probabilities))
    predicted_category = str(label_encoder.inverse_transform([predicted_index])[0])
    return {
        "mode": "model",
        "model": config.get("model_name", "UrbanSarthi Multimodal AQI Model"),
        "predicted_category": predicted_category,
        "confidence": round(float(probabilities[predicted_index]) * 100, 2),
        "probabilities": [
            {"category": str(label_encoder.inverse_transform([i])[0]), "probability": round(float(probabilities[i]) * 100, 2)}
            for i in range(len(probabilities))
        ],
        "inputs": {
            "PM2.5": round(float(pm25), 3), "PM10": round(float(pm10), 3),
            "Temperature": round(float(temperature), 2), "Humidity": round(float(humidity), 2),
            "Season": season, "Day_or_Night": day_or_night,
        },
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "data_quality": "model_prediction_from_user_supplied_images_and_readings",
        "note": "This is a model-predicted category from two images and the supplied readings. It is not an official AQI measurement or a substitute for an authorized monitoring station.",
    }
