from .style_router import AnimadexStyleRouter
from .canvas_budget import AnimadexCanvasBudget
from .mapped_lora_loader import AnimadexMappedLoraLoader
from .character_router import AnimadexCharacterRouter

NODE_CLASS_MAPPINGS = {
    "AnimadexMappedLoraLoader": AnimadexMappedLoraLoader,
    "AnimadexStyleRouter": AnimadexStyleRouter,
    "AnimadexCanvasBudget": AnimadexCanvasBudget,
    "AnimadexCharacterRouter": AnimadexCharacterRouter,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimadexMappedLoraLoader": "Animadex 白名单映射 LoRA 加载器",
    "AnimadexStyleRouter": "Animadex 画风白名单路由",
    "AnimadexCanvasBudget": "Animadex 生图尺寸预算",
    "AnimadexCharacterRouter": "Animadex 精确角色白名单路由",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
