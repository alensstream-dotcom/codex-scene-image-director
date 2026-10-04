"""Opt-in routing for the single tested exact-character LoRA."""

from __future__ import annotations

import json
import re

from .style_router import MARKER_RE, OPAQUE_LORA_RE, _inside_spans


NILOU_LORA = r"CodexAnima\Nilou-V2-E12.safetensors"
NILOU_STRENGTH = 0.4


def route_character_prompt(prompt: str) -> tuple[str, str, float, str]:
    """Enable Nilou only for a supported exact-character control marker.

    The last independent @character: request decides. An unsupported last
    request disables this optional loader; unsupported text is never consumed
    or used as a file path. Appearance prototypes must not request this node.
    """
    if not isinstance(prompt, str):
        raise TypeError("prompt must be a string")

    protected = [(m.start(), m.end()) for m in OPAQUE_LORA_RE.finditer(prompt)]
    requests = []
    supported = []
    unsupported_count = 0
    for match in MARKER_RE.finditer(prompt):
        if _inside_spans(match.start(), match.end(), protected):
            continue
        token = match.group("token").casefold()
        followed_by_space_or_end = match.end() == len(prompt) or prompt[match.end()].isspace()
        if followed_by_space_or_end and token.endswith(".") and not token.endswith(".."):
            token = token[:-1]
        if not token.startswith("character:"):
            continue
        is_nilou = token == "character:nilou"
        requests.append((match, is_nilou))
        if is_nilou:
            supported.append(match)
        else:
            unsupported_count += 1

    enabled = bool(requests and requests[-1][1])
    strength = NILOU_STRENGTH if enabled else 0.0

    if supported:
        pieces = []
        cursor = 0
        for match in supported:
            pieces.append(prompt[cursor:match.start()])
            cursor = match.end()
            terminator = re.match(r"[ \t]*[,，、。][ \t]*", prompt[cursor:])
            if terminator:
                cursor += terminator.end()
        pieces.append(prompt[cursor:])
        clean_prompt = "".join(pieces).strip(" \t\r\n,，、")
    else:
        clean_prompt = prompt

    source = "supported_exact_character" if enabled else (
        "unsupported_character_request" if requests else "default_disabled"
    )
    report = json.dumps({
        "selected_character": "Nilou" if enabled else None,
        "selection_source": source,
        "supported_markers": len(supported),
        "unsupported_markers_preserved": unsupported_count,
        "lora_name": NILOU_LORA,
        "strength": strength,
        "trigger_injected": False,
    }, ensure_ascii=False, sort_keys=True)
    return clean_prompt, NILOU_LORA, strength, report


class AnimadexCharacterRouter:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "prompt": ("STRING", {"multiline": True, "forceInput": True}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "FLOAT", "STRING")
    RETURN_NAMES = ("clean_prompt", "lora_name", "strength", "report")
    FUNCTION = "route"
    CATEGORY = "Animadex"
    DESCRIPTION = (
        "Opt in to the tested Nilou LoRA using @character:Nilou for that exact identity. "
        "Otherwise return the same fixed file with strength 0. Unknown character "
        "requests remain text and are never file paths. Original appearance "
        "prototypes must not use this character LoRA; identity supplies the real trigger."
    )

    def route(self, prompt):
        return route_character_prompt(prompt)
