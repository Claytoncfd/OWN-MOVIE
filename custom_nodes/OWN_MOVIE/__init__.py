"""OWN MOVIE — nodes do ComfyUI: roteiro → agentes (OmniRoute) → voz (OmniVoice) → vídeo (Wan 2.2) → filme."""
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .routes import register as _register_routes

_register_routes()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
