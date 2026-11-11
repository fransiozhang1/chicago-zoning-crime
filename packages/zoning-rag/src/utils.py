"""
Utility functions for loading configuration and resolving paths.
"""

import os
import yaml


def load_config(config_path: str) -> dict:
    """Load configuration from a YAML file."""
    with open(config_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    return config


def resolve_path(base_dir: str, relative_path: str) -> str:
    """Resolve a relative path against the project base directory."""
    if os.path.isabs(relative_path):
        return relative_path
    return os.path.normpath(os.path.join(base_dir, relative_path))
