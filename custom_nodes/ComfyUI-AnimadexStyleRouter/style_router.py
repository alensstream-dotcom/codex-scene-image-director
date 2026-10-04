"""Route a per-image style marker to one audited LoRA filename.

This module intentionally does not import ComfyUI, torch, or any file-loading API.
It only produces inputs for an existing LoRA loader.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class StyleProfile:
    name: str
    lora_name: str
    strength: float
    trigger: str = ""


PROFILES = MappingProxyType({
    # Existing loader returns its inputs unchanged when both strengths are zero.
    "ModelDefault": StyleProfile(
        "ModelDefault", r"CodexAnima\anima-renderstyle-v1.safetensors", 0.0
    ),
    "Painterly": StyleProfile(
        "Painterly", r"CodexAnima\anima-renderstyle-v1.safetensors", 0.55
    ),
    "Mikko": StyleProfile(
        "Mikko", r"CodexAnima\anima-mikkoani-v3.1.safetensors", 0.55, "@mikkoani"
    ),
    "BlueArchive": StyleProfile(
        "BlueArchive", "BlueArchiveStyleB1.safetensors", 0.75, "@BlueArchStyle"
    ),
    "RDBT": StyleProfile(
        "RDBT", r"CodexAnima\rdbt_v2.1_base_anima_b1_lora.safetensors", 0.85
    ),
    "PC98": StyleProfile(
        "PC98", r"CodexAnima\pc98gal_style-v0.1.safetensors", 0.35, "pc98gal_style"
    ),
})

ALIASES = MappingProxyType({
    "model_default": "ModelDefault",
    "painterly": "Painterly",
    "fine": "Painterly",
    "mikko": "Mikko",
    "mikkoani": "Mikko",
    "bluearchive": "BlueArchive",
    "bluearchstyle": "BlueArchive",
    "rdbt": "RDBT",
    "pc98": "PC98",
})

# Read a complete marker rather than a known prefix. Thus @PC98/../../file,
# @Mikko-other and @style:../../file cannot resolve to a partial known alias.
# Email addresses, URL/path components and doubled @ signs are not controls.
MARKER_RE = re.compile(
    r"(?<![\w@/\\:.])@(?P<token>[^\s,;!?()\[\]{}<>\"'，。；！？（）【】、]+)"
)

# WeiLin/other extension tokens remain opaque, including paired tag contents.
OPAQUE_LORA_RE = re.compile(
    r"<(lora|wlr)\b[^>]*>.*?</\1\s*>|</?(?:lora|wlr)\b[^>]*>",
    re.IGNORECASE | re.DOTALL,
)


def _inside_spans(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(start < protected_end and end > protected_start
               for protected_start, protected_end in spans)


def _marker_style(token: str, followed_by_space_or_end: bool = False) -> str | None:
    lowered = token.casefold()
    # A single sentence-ending period is punctuation only when followed by
    # whitespace/end. Never trim dots inside a path or accept an alias prefix.
    if followed_by_space_or_end and lowered.endswith(".") and not lowered.endswith(".."):
        lowered = lowered[:-1]
    if lowered.startswith("style:"):
        lowered = lowered[len("style:"):]
    return ALIASES.get(lowered)


def route_prompt(prompt: str, default_style: str = "ModelDefault") -> tuple[str, str, float, str]:
    """Return cleaned conditioning text and a fixed whitelist LoRA selection.

    The last recognized standalone marker wins. Unknown markers are preserved.
    Only recognized controls and their adjacent following tag terminator are removed;
    the remaining prompt's words, LoRA syntax and newlines are not normalized.
    """
    if not isinstance(prompt, str):
        raise TypeError("prompt must be a string")
    if default_style not in PROFILES:
        raise ValueError("default_style must be one of the fixed style profiles")

    protected = [(m.start(), m.end()) for m in OPAQUE_LORA_RE.finditer(prompt)]
    recognized: list[tuple[re.Match[str], str]] = []
    unknown_count = 0
    for match in MARKER_RE.finditer(prompt):
        if _inside_spans(match.start(), match.end(), protected):
            continue
        followed_by_space_or_end = match.end() == len(prompt) or prompt[match.end()].isspace()
        style = _marker_style(match.group("token"), followed_by_space_or_end)
        if style is None:
            unknown_count += 1
        else:
            recognized.append((match, style))

    selected = recognized[-1][1] if recognized else default_style
    profile = PROFILES[selected]
    if selected == "ModelDefault":
        # Native @artist names can overlap old shorthand style selectors. The
        # explicit native profile removes only @style controls and keeps artists.
        native_artists = [(match, style) for match, style in recognized
                          if not match.group("token").casefold().startswith("style:")]
        recognized = [(match, style) for match, style in recognized
                      if match.group("token").casefold().startswith("style:")]
        unknown_count += len(native_artists)

    # All recognized controls are replaced by the selected real training trigger
    # once. Leaving obsolete training triggers would condition two styles at once.
    pieces: list[str] = []
    cursor = 0
    for match, _style in recognized:
        pieces.append(prompt[cursor:match.start()])
        cursor = match.end()
        terminator = re.match(r"[ \t]*[,，、。][ \t]*", prompt[cursor:])
        if terminator:
            cursor += terminator.end()
    pieces.append(prompt[cursor:])
    clean_prompt = "".join(pieces).strip(" \t\r\n,，、")

    if profile.trigger:
        # The PC98 real trigger is a regular tag, not an @ control. Preserve an
        # existing spelling and avoid duplication; otherwise prepend the trigger.
        trigger_pattern = re.compile(
            r"(?<![\w@])" + re.escape(profile.trigger) + r"(?![\w])",
            re.IGNORECASE,
        )
        clean_protected = [(m.start(), m.end()) for m in OPAQUE_LORA_RE.finditer(clean_prompt)]
        has_trigger = any(
            not _inside_spans(match.start(), match.end(), clean_protected)
            for match in trigger_pattern.finditer(clean_prompt)
        )
        if not has_trigger:
            clean_prompt = (profile.trigger + ", " + clean_prompt) if clean_prompt else profile.trigger

    report = json.dumps({
        "selected_style": selected,
        "selection_source": "last_marker" if recognized else "default",
        "recognized_markers": len(recognized),
        "unknown_markers_preserved": unknown_count,
        "training_trigger": profile.trigger,
        "lora_name": profile.lora_name,
        "strength": profile.strength,
    }, ensure_ascii=False, sort_keys=True)
    return clean_prompt, profile.lora_name, profile.strength, report


class AnimadexStyleRouter:
    """A pure per-prompt router; it never mutates another LoRA or model input."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "prompt": ("STRING", {"multiline": True, "forceInput": True}),
            "default_style": (list(PROFILES), {"default": "ModelDefault"}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "FLOAT", "STRING")
    RETURN_NAMES = ("clean_prompt", "lora_name", "strength", "report")
    FUNCTION = "route"
    CATEGORY = "Animadex"
    DESCRIPTION = (
        "Select one audited style LoRA from per-image @ markers; the last recognized "
        "marker wins. Unknown markers and <lora>/<wlr> tokens are preserved. "
        "Connect lora_name and strength only to your style LoRA loader."
    )

    def route(self, prompt, default_style="ModelDefault"):
        return route_prompt(prompt, default_style)
