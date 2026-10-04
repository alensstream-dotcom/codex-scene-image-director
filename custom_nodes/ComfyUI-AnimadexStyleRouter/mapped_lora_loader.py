"""Typed STRING adapter for the existing, audited 2B-to-2.9B loader.

ComfyUI rejects STRING links into a legacy list-valued filename widget. This
adapter declares the actual dynamic input type and keeps the upstream remapping.
"""
from .style_router import PROFILES
from .character_router import NILOU_LORA

ALLOWED_FILES = frozenset([profile.lora_name for profile in PROFILES.values()] + [NILOU_LORA])


class AnimadexMappedLoraLoader:
    def __init__(self):
        self._delegate = None

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "lora_name": ("STRING", {"forceInput": True}),
            "strength_model": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
            "strict_model_check": ("BOOLEAN", {"default": True}),
            "strict_lora_check": ("BOOLEAN", {"default": True}),
        }}

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "report")
    FUNCTION = "load_lora"
    CATEGORY = "Animadex"

    def load_lora(self, model, lora_name, strength_model, strict_model_check=True, strict_lora_check=True):
        if lora_name not in ALLOWED_FILES:
            raise ValueError("LoRA is outside the audited Animadex whitelist")
        if self._delegate is None:
            import nodes
            loader = nodes.NODE_CLASS_MAPPINGS.get("Anima2BTo29BLoraLoaderModelOnly")
            if loader is None:
                raise RuntimeError("The Anima 2B-to-2.9B compatibility node is not installed")
            self._delegate = loader()
        return self._delegate.load_lora_model_only(
            model, lora_name, strength_model, strict_model_check, strict_lora_check
        )
