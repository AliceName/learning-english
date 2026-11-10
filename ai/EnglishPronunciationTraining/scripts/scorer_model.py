"""Small bounded phoneme score regressor; acoustic model is trained separately."""
import torch
from torch import nn


class ScoreMLP(nn.Module):
    def __init__(self, input_size, hidden_sizes, dropout):
        super().__init__()
        layers = []
        for width in hidden_sizes:
            layers.extend([nn.Linear(input_size, width), nn.ReLU(), nn.Dropout(dropout)])
            input_size = width
        layers.append(nn.Linear(input_size, 1))
        self.layers = nn.Sequential(*layers)

    def forward(self, x):
        return 2 * torch.sigmoid(self.layers(x).squeeze(-1))


def predict_package(package, x):
    """Inference from feature vectors only; no teacher labels are accessed."""
    import numpy as np
    z = (np.asarray(x, dtype=np.float32) - np.asarray(package['scaler_mean'], dtype=np.float32)) / np.asarray(package['scaler_scale'], dtype=np.float32)
    selected = package['selected_model']
    if selected == 'global_mean':
        return np.full(len(z), package['train_global_mean'], dtype=np.float32)
    if selected == 'phone_mean':
        # The last dimensions are the source-phone one-hot, part of the schema.
        phone_ids = np.argmax(x[:, -len(package['base_phones']):], axis=1)
        return np.asarray(package['train_phone_means'], dtype=np.float32)[phone_ids]
    if selected == 'ridge':
        return np.clip(z @ np.asarray(package['ridge_coef']) + package['ridge_intercept'], 0, 2)
    if selected != 'mlp':
        raise ValueError('Unknown selected model')
    model = ScoreMLP(len(package['feature_names']), package['hidden_sizes'], package['dropout'])
    model.load_state_dict(package['mlp_state_dict']); model.eval()
    with torch.inference_mode():
        return model(torch.from_numpy(z)).numpy()
