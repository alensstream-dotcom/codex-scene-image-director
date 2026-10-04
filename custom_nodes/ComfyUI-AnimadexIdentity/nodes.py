"""ComfyUI nodes for Anima in-context character reference."""

import torch
import torch.nn.functional as F

from .incontext import apply_incontext_ref, _fit_latent


def _fit_pixels_white_pad(pixels, target_h, target_w):
    """Aspect-preserving resize of (B, H, W, C) pixels to the target
    size, centered on a white canvas. White matches the background that
    AnimaRefEncode composites masked subjects onto."""
    b, h, w, c = pixels.shape
    if (h, w) == (target_h, target_w):
        return pixels
    scale = min(target_h / h, target_w / w)
    nh = max(1, min(target_h, round(h * scale)))
    nw = max(1, min(target_w, round(w * scale)))
    resized = F.interpolate(
        pixels.permute(0, 3, 1, 2), size=(nh, nw), mode="bilinear", align_corners=False
    ).permute(0, 2, 3, 1)
    canvas = torch.ones((b, target_h, target_w, c), device=pixels.device, dtype=pixels.dtype)
    top = (target_h - nh) // 2
    left = (target_w - nw) // 2
    canvas[:, top:top + nh, left:left + nw] = resized
    return canvas


class AnimaRefEncode:
    """Prepare a reference image for in-context conditioning.

    Optionally composites the subject onto a white background using a
    mask (recommended: character segmentation mask). Background removal
    measurably improves appearance fidelity for anime subjects.

    target_width / target_height (0 = keep): aspect-preserving resize
    onto a white canvas before encoding. Set these to the generation
    resolution to avoid any latent-space resampling at sampling time.

    Multiple reference images can be batched; each becomes its own
    reference frame.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "vae": ("VAE",),
                "image": ("IMAGE",),
            },
            "optional": {
                "mask": ("MASK",),
                "target_width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
                "target_height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 8}),
            },
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "encode"
    CATEGORY = "anima/incontext"

    def encode(self, vae, image, mask=None, target_width=0, target_height=0):
        pixels = image
        if mask is not None:
            m = mask
            if m.ndim == 2:
                m = m.unsqueeze(0)
            m = m.unsqueeze(-1)  # (B, H, W, 1)
            if m.shape[1:3] != pixels.shape[1:3]:
                m = F.interpolate(
                    m.permute(0, 3, 1, 2), size=pixels.shape[1:3], mode="bilinear", align_corners=False
                ).permute(0, 2, 3, 1)
            pixels = pixels * m + (1.0 - m)  # subject on white

        if target_width > 0 and target_height > 0:
            pixels = _fit_pixels_white_pad(pixels, target_height, target_width)

        latent = vae.encode(pixels[:, :, :, :3])
        return ({"samples": latent},)


class AnimaRefLatentBatch:
    """Batch two reference latents into one multi-frame reference.

    Reference latents of different resolutions are combined by fitting
    the second latent to the first one's size (aspect-preserving pad by
    default). Chain several of these to stack many references."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ref_latent_1": ("LATENT",),
                "ref_latent_2": ("LATENT",),
                "fit_mode": (["pad", "stretch", "crop"], {"default": "pad"}),
            },
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "batch"
    CATEGORY = "anima/incontext"

    def batch(self, ref_latent_1, ref_latent_2, fit_mode):
        s1 = ref_latent_1["samples"]
        s2 = ref_latent_2["samples"]
        if s1.ndim == 5:
            s1 = s1.squeeze(2)
        if s2.ndim == 5:
            s2 = s2.squeeze(2)
        if s2.shape[-2:] != s1.shape[-2:]:
            s2 = _fit_latent(s2, s1.shape[-2], s1.shape[-1], fit_mode)
        return ({"samples": torch.cat([s1, s2], dim=0)},)


class AnimaInContextApply:
    """Attach in-context reference frames to an Anima model.

    The reference latent is concatenated on the DiT's temporal axis as
    clean (t=0) frames; the generated frame attends to it via shared
    self-attention. Combine with an in-context reference LoRA trained
    with the same contract for full effect.

    strength: attention bias toward reference tokens.
              1.0 = neutral, >1 stronger, 0 = off.
    start_percent / end_percent: sampling step window where the
              reference is attached.
    cond_only: mask the reference for the uncond half of CFG. Matches
              the training contract (reference dropped for the
              unconditional distribution) — recommended on.
    fit_mode: how a reference latent that does not match the generation
              resolution is fitted (pad = aspect-preserving, default).
    ref_timestep: timestep for reference frames. 0 = clean image
              (the training contract). Small values (~0.05–0.1 of the
              schedule) act as noise augmentation if a future LoRA is
              trained that way.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "ref_latent": ("LATENT",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.05}),
                "start_percent": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.001}),
                "end_percent": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.001}),
            },
            "optional": {
                "cond_only": ("BOOLEAN", {"default": True}),
                "fit_mode": (["pad", "stretch", "crop"], {"default": "pad"}),
                "ref_timestep": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1000.0, "step": 0.5}),
            },
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply"
    CATEGORY = "anima/incontext"

    def apply(self, model, ref_latent, strength, start_percent, end_percent,
              cond_only=True, fit_mode="pad", ref_timestep=0.0):
        samples = ref_latent["samples"]
        m = apply_incontext_ref(
            model, samples, strength, start_percent, end_percent,
            cond_only=cond_only, fit_mode=fit_mode, ref_timestep=ref_timestep,
        )
        return (m,)


NODE_CLASS_MAPPINGS = {
    "AnimaRefEncode": AnimaRefEncode,
    "AnimaRefLatentBatch": AnimaRefLatentBatch,
    "AnimaInContextApply": AnimaInContextApply,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimaRefEncode": "Anima Reference Encode (in-context)",
    "AnimaRefLatentBatch": "Anima Reference Latent Batch",
    "AnimaInContextApply": "Anima In-Context Reference Apply",
}
