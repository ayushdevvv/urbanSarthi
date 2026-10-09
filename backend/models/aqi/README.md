# UrbanSarthi Multimodal AQI Model

These are the trained model artifacts supplied with `UrbanSarthi-AQI-Model-main`:

- `urban_sarthi_best_model.pth` — PyTorch state dict
- `preprocessor.joblib` — fitted StandardScaler + OneHotEncoder pipeline
- `label_encoder.joblib` — six-category label encoder
- `model_config.json` — model input/class configuration

The architecture definition is taken from the uploaded `UKHack.ipynb`. The model consumes two 128 x 128 RGB images (`front`, `rear`) and these six columns: `PM2.5`, `PM10`, `Temperature`, `Humidity`, `Season`, `Day_or_Night`. The fitted preprocessor produces nine features for the tabular branch. Season must be `Monsoon`, `Summer`, or `Winter`; time of day must be `Day` or `Night`.

The class prediction is **not a numerical AQI and not an official station measurement**. It is a model prediction from the provided images and user-entered readings. The supplied notebook reports 82.09% test accuracy and 0.7226 macro F1; these values have not been independently reproduced as part of integration.

`joblib` artifacts are pickle-based. Keep these exact files trusted and do not accept arbitrary model/preprocessor uploads through the public API.
