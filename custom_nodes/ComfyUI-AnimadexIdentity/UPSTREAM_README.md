---
license: other
license_name: circlestone-labs-non-commercial
license_link: https://huggingface.co/circlestone-labs/Anima
base_model: circlestone-labs/Anima
tags:
- anima
- lora
- in-context
- character-reference
- ip-adapter-alternative
- comfyui
- anime
pipeline_tag: text-to-image
library_name: diffusers
---

# Anima In-Context Character

**Reference-driven character generation for [Anima](https://huggingface.co/circlestone-labs/Anima)** — attach a few images of a character and generate that character in new poses, scenes and expressions. No per-character training. Works on characters the base model has never seen.

This is a LoRA + a small ComfyUI node pack. Unlike CLIP-embedding IP-Adapters, the reference enters the model as its **own VAE latent inside self-attention**, so fine details (hair ornaments, clothing patterns, eye color) are preserved in principle rather than summarized into a single embedding.

|  | |
|---|---|
| Base model | Anima 2B (Cosmos-Predict2 DiT + Qwen3-0.6B text encoder, WanVAE) |
| Type | in-context reference LoRA (DiT, rank 64) + ComfyUI nodes |
| Trained on | ~994k anime images / ~62k (reference≠target) character pairs |
| Use | attach 1–3 reference images → generate in any pose/scene |

## Samples

Original characters, unseen by the base model — generated from reference images alone.

| Yanineko (ヤニネコ) | Nihon / "Japan" flag-girl (国旗娘・日本) |
|:---:|:---:|
| ![yanineko](samples/sample_yanineko.png) | ![nihon](samples/sample_nihon.png) |

*Cat-eared original character with grey hair, tabby tail, casual outfit and yellow crocs (left); an original fox-shrine-maiden "flag-girl" personification of Japan in white-and-pink miko attire (right). Both reproduced in new renders from reference images.*

---

## How it works

Anima's DiT is a **video** architecture: latents flow as `(B, C, T, H, W)` and self-attention runs over the flattened `(t h w)` sequence with 3D RoPE (`max_frames=128`, `patch_temporal=1`).

This adapter exploits that:

1. The reference image's VAE latent is **concatenated as an extra frame on the T axis** — `[generated frame, reference frame(s)]`. It gets a distinct temporal RoPE coordinate, so it never collides spatially with the generated frame.
2. Per-frame timesteps: the reference frame is conditioned at **timestep 0 (a clean image)** while the generated frame follows the sampler. This is the OminiControl-style "clean condition token" recipe.
3. The generated frame attends to the reference tokens via **shared self-attention** — the reference's appearance flows in directly, not through a lossy embedding.
4. Reference frames are sliced off the output before the sampler sees it.

The LoRA teaches the base T2I model to *use* those reference tokens. It was trained on **same-character / different-artist** pairs with character names removed from the captions, so identity must flow through the reference frames (not the text) — the network learns a transferable "copy this character into a new context" skill rather than memorizing specific characters.

## How it was made

- **Data**: ~994k tagged anime images → grouped by character → **same character, different artist** pairs (so the character stream carries identity, not style) → filtered by anime-character identity similarity (deepghs *ccip*) to drop costume/wrong-tag noise → references composited onto white via anime segmentation.
- **Captions**: general tags only ([OppaiOracle](https://huggingface.co/Grio43/OppaiOracle)), with character/artist/copyright tags stripped — so identity can only flow through the reference.
- **Training**: DiT LoRA (rank 64, α 32), reference frames appended at timestep 0, loss on the generated frame only, 10% reference-dropout for CFG. Multi-view pairs (2 references from distinct artists) so "attach a few images" is trained, not just inference-time.
- Full pipeline & node source: [github.com/daraskme/anima-duet](https://github.com/daraskme) *(see project repo)*.

---

## ComfyUI usage

### 1. Install the custom nodes
Clone the node pack into `ComfyUI/custom_nodes/`:
```
comfyui-anima-incontext/   (from this repo's `comfyui-anima-incontext/` folder)
```
Restart ComfyUI. You should see nodes under the **anima/incontext** category.

### 2. Get the models
| File | Put in |
|---|---|
| `anima-incontext-character.safetensors` (this repo) | `ComfyUI/models/loras/` |
| `anima-base-v1.0.safetensors` | `ComfyUI/models/diffusion_models/` |
| `qwen_3_06b_base.safetensors` | `ComfyUI/models/text_encoders/` |
| `qwen_image_vae.safetensors` | `ComfyUI/models/vae/` |

(The three base files come from the [Anima](https://huggingface.co/circlestone-labs/Anima) release.)

### 3. Load the workflow
Drag `workflow_anima_incontext_character.json` onto the ComfyUI canvas. It's wired as:

```
UNETLoader ─► LoraLoaderModelOnly (this LoRA) ─┐
LoadImage ×2 ─► AnimaRefEncode ×2 ─► AnimaRefLatentBatch ─► AnimaInContextApply ─► KSampler ─► VAEDecode ─► SaveImage
```

### 4. Nodes
- **Anima Reference Encode** — IMAGE (+ optional MASK) → LATENT. A mask composites the subject on white (recommended). `target_width/height` resizes onto a white canvas so refs match the generation resolution.
- **Anima Reference Latent Batch** — combine 2+ references (full-body + face works best).
- **Anima In-Context Reference Apply** — attach references to the model.
  - `strength` 1.0 = neutral, >1 stronger reference pull, 0 = off
  - `cond_only` (default on) — reference masked on the CFG-uncond half; matches training
  - `fit_mode` `pad` (aspect-preserving, default) / `stretch` / `crop`
  - `start_percent`/`end_percent` — sampling window

## Tips for best results

- **Attach a full-body shot + a face close-up.** Two references (batched) noticeably improve hair-length and face fidelity over a single one.
- **Also describe the appearance in the prompt** (hair color, outfit, ears, etc.). Reference + matching tags is the strongest combination — the prompt describes the *pose/scene*, the reference carries the *identity*.
- Composite the subject on a **white background** (use the mask input) — reduces background bleed.
- If identity drifts, raise `strength` to 1.2–1.5 or add a third reference.
- Recommended base sampler: `er_sde` / `simple`, 30 steps, CFG 4, `discrete_flow_shift` 3.0.

## Limitations

- Fine ornament/pattern detail can drift; multi-reference + appearance tags mitigate it.
- Strong reference pull can slightly wash out backgrounds — trade off with `strength` and the sampling window.
- Anime domain (the training data is anime illustration).

## License

Base model **Anima** is under the **CircleStone Labs Non-Commercial License** (derives from Cosmos-Predict2 → NVIDIA Open Model License also applies). **This LoRA is a derivative and is released for non-commercial use.** Generated images may be usable commercially per the base license, but **verify the current Anima LICENSE before any commercial use or redistribution.** Training data is derived from public booru sources.

---

## 日本語

**Anima 向けの参照画像キャラ生成 LoRA。** キャラ画像を数枚添付するだけで、そのキャラを別ポーズ・別シーンで生成できます（キャラ毎の学習不要、未知キャラも可）。

CLIP 埋め込み型 IP-Adapter と違い、参照画像を**モデル自身の VAE latent のまま self-attention に入れる**ため、髪飾り・服の柄・瞳の色などの細部が原理的に落ちません。参照を DiT の時間軸に「クリーンフレーム（timestep=0）」として連結する OminiControl 系の方式です。

**使い方**: `comfyui-anima-incontext` ノードを導入 → このLoRAを `models/loras/` へ → `workflow_anima_incontext_character.json` を読み込み → 参照は**全身1枚＋顔アップ1枚**を推奨、プロンプトにも外見タグを併記すると最も安定します。`strength` は 1.0 中立、効きが弱ければ 1.2〜1.5。

**ライセンス**: ベースの Anima は CircleStone Labs 非商用ライセンス。本LoRAは派生物として**非商用**での配布です。商用利用・再配布前に最新 LICENSE を確認してください。
