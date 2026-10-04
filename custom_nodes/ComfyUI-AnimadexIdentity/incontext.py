"""
Anima In-Context Reference — core logic.

Strategy
--------
Anima's DiT (Cosmos-Predict2 MiniTrainDIT) is a *video* architecture:
latents flow through the blocks as (B, T, H, W, D) and self-attention is
computed over the flattened (t h w) sequence with 3D RoPE
(max_frames=128, patch_temporal=1).

We exploit this: the reference image latent is concatenated as an extra
*frame* along the T axis. This gives us, for free:

  * a distinct temporal RoPE coordinate for reference tokens
    (no spatial position collision with the generated frame),
  * per-frame timestep conditioning — MiniTrainDIT accepts
    timesteps of shape (B, T), so the reference frame can be
    conditioned at t=0 (clean image) while the generated frame
    follows the sampler's sigma. This matches the
    OminiControl-style "clean condition token" recipe.

The generated frame's self-attention can then attend to reference
tokens (shared attention / in-context conditioning). Reference frames
are sliced off the output before returning to the sampler.

Strength control is implemented by patching each block's
`self_attn.attn_op` (a plain attribute, cleanly replaceable via
ModelPatcher.add_object_patch) with a version that adds a per-sample
additive bias on reference-token key columns:

  * log(strength) amplifies/attenuates reference attention,
  * cond_only masks reference keys for the uncond half of the CFG
    batch (equivalent to not concatenating the reference at all for
    the uncond forward — this matches the training contract, where
    the reference is dropped ~10% of the time to form the ref-free
    distribution).

NOTE: the base model was finetuned as a T2I model (single frame), so
zero-shot behaviour without a trained in-context LoRA is expected to be
weak. This module defines the exact inference-time contract that the
LoRA training code must replicate:
  - reference frames appended after generated frames on the T axis
  - reference frames receive timestep 0
  - reference latents are latent_format-normalized (process_latent_in)
  - text conditioning unchanged
"""

import math

import torch
import torch.nn.functional as F

import comfy.patcher_extension
from comfy.patcher_extension import WrappersMP

WRAPPER_KEY = "anima_incontext_ref"

NEG_BIAS = -1e9  # finite mask value; softmax subtracts the row max so this is NaN-safe


class RefState:
    """Mutable state shared between the diffusion-model wrapper and the
    patched attention ops. The wrapper fills in per-forward token counts
    and the per-sample reference bias (they depend on resolution and on
    the CFG batch layout), the attention ops read them."""

    def __init__(self):
        self.active = False
        self.total_tokens = -1
        self.gen_tokens = -1
        # per-sample additive bias on reference key columns, shape (B,).
        # None means "all zero" (neutral -> attn ops fall back).
        self.bias_B = None
        # lazily-built full bias tensor (B, 1, 1, S), cached across the
        # 28 blocks of one forward pass
        self._bias_cache = None

    def bias_for(self, device, dtype):
        if self._bias_cache is None or self._bias_cache.device != device or self._bias_cache.dtype != dtype:
            b = torch.zeros((self.bias_B.shape[0], 1, 1, self.total_tokens), device=device, dtype=dtype)
            b[:, 0, 0, self.gen_tokens:] = self.bias_B.to(device=device, dtype=dtype).unsqueeze(1)
            self._bias_cache = b
        return self._bias_cache


def _tokens_per_frame(h, w, patch_spatial):
    # pad_to_patch_size pads H and W up to a multiple of patch_spatial
    hp = math.ceil(h / patch_spatial)
    wp = math.ceil(w / patch_spatial)
    return hp * wp


def _fit_latent(r, H, W, mode):
    """Fit reference latent frames (N, C, h, w) to the generation
    latent size (H, W).

    stretch: plain bilinear resize (aspect distortion)
    pad:     aspect-preserving resize + edge-replicate center pad.
             Replicate keeps a white-background reference white at the
             borders instead of introducing a mean-gray frame.
    crop:    aspect-filling resize + center crop
    """
    h, w = r.shape[-2:]
    if (h, w) == (H, W):
        return r
    if mode == "stretch":
        return F.interpolate(r, size=(H, W), mode="bilinear", align_corners=False)
    if mode == "pad":
        scale = min(H / h, W / w)
        nh = max(1, min(H, round(h * scale)))
        nw = max(1, min(W, round(w * scale)))
        r = F.interpolate(r, size=(nh, nw), mode="bilinear", align_corners=False)
        pt = (H - nh) // 2
        pl = (W - nw) // 2
        return F.pad(r, (pl, W - nw - pl, pt, H - nh - pt), mode="replicate")
    if mode == "crop":
        scale = max(H / h, W / w)
        nh = max(H, round(h * scale))
        nw = max(W, round(w * scale))
        r = F.interpolate(r, size=(nh, nw), mode="bilinear", align_corners=False)
        ot = (nh - H) // 2
        ol = (nw - W) // 2
        return r[:, :, ot:ot + H, ol:ol + W]
    raise ValueError(f"unknown fit mode: {mode}")


def make_ref_attn_op(state, fallback_op):
    """Replacement for Attention.attn_op on self-attention modules.

    Adds the per-sample reference bias to attention logits for
    reference-token key columns. Falls back to the original op whenever
    the reference is not active, the bias is neutral, or the sequence
    length does not match the full (gen + ref) self-attention sequence
    (which excludes cross-attention and the LLMAdapter, whose K length
    differs).
    """

    def ref_attn_op(q_B_S_H_D, k_B_S_H_D, v_B_S_H_D, transformer_options={}):
        if (
            not state.active
            or state.bias_B is None
            or k_B_S_H_D.shape[1] != state.total_tokens
            or q_B_S_H_D.shape[1] != state.total_tokens
        ):
            return fallback_op(q_B_S_H_D, k_B_S_H_D, v_B_S_H_D, transformer_options=transformer_options)

        # (B, S, H, D) -> (B, H, S, D)
        q = q_B_S_H_D.transpose(1, 2)
        k = k_B_S_H_D.transpose(1, 2)
        v = v_B_S_H_D.transpose(1, 2)

        bias = state.bias_for(q.device, q.dtype)

        out = F.scaled_dot_product_attention(q, k, v, attn_mask=bias)
        # (B, H, S, D) -> (B, S, H*D)
        out = out.transpose(1, 2).reshape(q_B_S_H_D.shape[0], q_B_S_H_D.shape[1], -1)
        return out

    return ref_attn_op


def _per_sample_bias(B, strength, cond_only, cond_or_uncond, device):
    """Build the per-sample reference-key bias, shape (B,).

    cond samples get log(strength) (0 at strength=1); uncond samples get
    the same unless cond_only, in which case their reference keys are
    masked out entirely. strength <= 0 masks the reference everywhere.

    Returns None when every entry is zero (neutral -> no attn patch).
    """
    if strength <= 0.0:
        base = NEG_BIAS
    else:
        base = math.log(strength)

    bias = torch.full((B,), base, device=device, dtype=torch.float32)

    if cond_only and cond_or_uncond is not None and len(cond_or_uncond) > 0 and B % len(cond_or_uncond) == 0:
        # calc_cond_batch concatenates equal-sized chunks along B, one
        # per entry of cond_or_uncond (0 = cond, 1 = uncond).
        chunk = B // len(cond_or_uncond)
        for i, kind in enumerate(cond_or_uncond):
            if kind == 1:
                bias[i * chunk:(i + 1) * chunk] = NEG_BIAS

    if torch.count_nonzero(bias) == 0:
        return None
    return bias


def make_diffusion_wrapper(opts):
    """DIFFUSION_MODEL wrapper around MiniTrainDIT._forward.

    opts is a dict with:
      ref_latent:   (N, C, 1, H, W) latent tensor, already
                    latent_format-normalized (process_latent_in)
      state:        RefState instance shared with the attn ops
      strength:     attention bias multiplier for reference tokens
      cond_only:    mask reference keys for the uncond CFG half
      fit_mode:     stretch | pad | crop (reference latent resize)
      sigma_start:  apply when current sigma <= sigma_start
      sigma_end:    ... and sigma >= sigma_end
      patch_spatial: DiT spatial patch size (2 for Anima)
      ref_timestep: timestep value for reference frames (default 0.0)
    """

    def wrapper(executor, x, timesteps, context, fps=None, padding_mask=None, **kwargs):
        state = opts["state"]
        ref = opts["ref_latent"]
        to = kwargs.get("transformer_options", {})

        # strength <= 0 fully masks the reference for every sample, which
        # is mathematically identical to not attaching it — skip the
        # concat so the output is bit-exact with the reference-free
        # forward (and faster). Verified on-device: with the concat, the
        # masked-attention kernel差 compounds over sampling steps.
        if opts["strength"] <= 0.0:
            return executor(x, timesteps, context, fps, padding_mask, **kwargs)

        # ---- sigma window gating ----
        sigmas = to.get("sigmas", None)
        if sigmas is not None:
            s = float(sigmas.max())
            if s > opts["sigma_start"] or s < opts["sigma_end"]:
                return executor(x, timesteps, context, fps, padding_mask, **kwargs)

        squeeze_t = False
        if x.ndim == 4:  # (B, C, H, W) -> (B, C, 1, H, W)
            x = x.unsqueeze(2)
            squeeze_t = True

        B, C, T, H, W = x.shape
        n_ref = ref.shape[0]

        # ---- prepare reference frames ----
        r = ref.to(device=x.device, dtype=x.dtype)  # (N, C, 1, H', W')
        r = r.squeeze(2)  # (N, C, H', W')
        r = _fit_latent(r, H, W, opts.get("fit_mode", "pad"))
        # (N, C, H, W) -> (1, C, N, H, W) -> (B, C, N, H, W)
        r = r.permute(1, 0, 2, 3).unsqueeze(0).expand(B, -1, -1, -1, -1)

        x_cat = torch.cat([x, r], dim=2)  # (B, C, T + N, H, W)

        # ---- per-frame timesteps: generated frames keep the sampler's t,
        #      reference frames get ref_timestep (0 = clean) ----
        t = timesteps
        if t.ndim == 1:
            t = t.unsqueeze(1)  # (B, 1)
        t = t.expand(B, T)
        t_ref = torch.full((B, n_ref), opts.get("ref_timestep", 0.0), device=t.device, dtype=t.dtype)
        t_cat = torch.cat([t, t_ref], dim=1)  # (B, T + N)

        # ---- arm the attention-op state ----
        tpf = _tokens_per_frame(H, W, opts["patch_spatial"])
        state.gen_tokens = T * tpf
        state.total_tokens = (T + n_ref) * tpf
        state.bias_B = _per_sample_bias(
            B, opts["strength"], opts.get("cond_only", False), to.get("cond_or_uncond", None), x.device
        )
        state._bias_cache = None
        state.active = True
        try:
            out = executor(x_cat, t_cat, context, fps, padding_mask, **kwargs)
        finally:
            state.active = False
            state.bias_B = None
            state._bias_cache = None

        out = out[:, :, :T]  # drop reference frames
        if squeeze_t:
            out = out.squeeze(2)
        return out

    return wrapper


def apply_incontext_ref(
    model_patcher,
    ref_latent,
    strength,
    start_percent,
    end_percent,
    cond_only=True,
    fit_mode="pad",
    ref_timestep=0.0,
):
    """Clone the ModelPatcher and install the in-context reference patches.

    ref_latent: raw LATENT samples tensor from a VAE encode,
                (N, C, H, W) or (N, C, 1, H, W).
    """
    m = model_patcher.clone()

    lat = ref_latent
    if lat.ndim == 4:
        lat = lat.unsqueeze(2)  # (N, C, 1, H, W)
    # Normalize into the model's latent space (Wan21 per-channel
    # mean/std). The sampler does this for the generated latent via
    # process_latent_in; we must match it for reference frames.
    lat = m.model.process_latent_in(lat.clone())

    ms = m.get_model_object("model_sampling")
    sigma_start = ms.percent_to_sigma(start_percent)
    sigma_end = ms.percent_to_sigma(end_percent)

    dm = m.get_model_object("diffusion_model")
    patch_spatial = getattr(dm, "patch_spatial", 2)

    state = RefState()
    opts = {
        "ref_latent": lat,
        "state": state,
        "strength": strength,
        "cond_only": cond_only,
        "fit_mode": fit_mode,
        "sigma_start": sigma_start,
        "sigma_end": sigma_end,
        "patch_spatial": patch_spatial,
        "ref_timestep": ref_timestep,
    }

    wrapper = make_diffusion_wrapper(opts)
    if hasattr(m, "add_wrapper_with_key"):
        m.add_wrapper_with_key(WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, wrapper)
    else:
        comfy.patcher_extension.add_wrapper_with_key(
            WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, wrapper, m.model_options, is_model_options=True
        )

    # Patch every block's self-attention op for strength control.
    # TODO: reference-side K/V is constant across steps and could be
    # cached; skipped for now (2B model, minor win).
    for i, block in enumerate(dm.blocks):
        orig_op = block.self_attn.attn_op
        m.add_object_patch(
            "diffusion_model.blocks.{}.self_attn.attn_op".format(i),
            make_ref_attn_op(state, orig_op),
        )

    return m
