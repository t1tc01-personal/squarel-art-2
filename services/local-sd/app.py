"""
Squarel local Stable Diffusion service (optional).

Runs SD 1.5 (+ an optional pixel-art LoRA) on a local NVIDIA GPU. Tuned for 4 GB cards
(GTX 1650): fp16, attention slicing, model CPU offload. Speaks the small HTTP contract that
src/providers/localsd.ts expects:

  GET  /health                         -> {"ok": true, "model": ...}
  POST /generate  {prompt, width, height, num_images, seed}            -> {"images": [b64png], "seeds": [...]}
  POST /img2img   {prompt, image(b64), mask?(b64), strength, num_images, seed} -> same

Run:  uvicorn app:app --host 127.0.0.1 --port 7861   (from this folder, inside the venv)
Env:  SD_MODEL (default "stable-diffusion-v1-5/stable-diffusion-v1-5"), SD_LORA (path or HF id, optional),
      SD_STEPS (default 20), SD_DEVICE (default "cuda").
Check each model/LoRA license before commercial use.
"""

from __future__ import annotations

import base64
import io
import os
import random
import threading
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("SD_MODEL", "stable-diffusion-v1-5/stable-diffusion-v1-5")
LORA = os.environ.get("SD_LORA")
STEPS = int(os.environ.get("SD_STEPS", "20"))
DEVICE = os.environ.get("SD_DEVICE", "cuda")
NEGATIVE = "blurry, anti-aliasing, gradient, photo, realistic, text, watermark, jpeg artifacts"

app = FastAPI(title="squarel-local-sd")
_lock = threading.Lock()  # one GPU job at a time
_pipes: dict[str, object] = {}


def _load(kind: str):
    """Lazy-load pipelines so /health answers instantly."""
    if kind in _pipes:
        return _pipes[kind]
    import torch
    from diffusers import (
        StableDiffusionImg2ImgPipeline,
        StableDiffusionInpaintPipeline,
        StableDiffusionPipeline,
    )

    dtype = torch.float16 if DEVICE == "cuda" else torch.float32
    cls = {
        "txt2img": StableDiffusionPipeline,
        "img2img": StableDiffusionImg2ImgPipeline,
        "inpaint": StableDiffusionInpaintPipeline,
    }[kind]
    base = _pipes.get("txt2img")
    if base is not None and kind != "txt2img":
        pipe = cls(**base.components)  # share weights, no extra VRAM
    else:
        pipe = cls.from_pretrained(MODEL_ID, torch_dtype=dtype, safety_checker=None)
        if LORA:
            pipe.load_lora_weights(LORA)
        pipe.enable_attention_slicing()
        if DEVICE == "cuda":
            pipe.enable_model_cpu_offload()  # keeps a 4 GB card from running out of memory
        else:
            pipe.to(DEVICE)
    _pipes[kind] = pipe
    return pipe


def _b64png(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _decode(b64: str):
    from PIL import Image

    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    width: int = Field(512, ge=256, le=768)
    height: int = Field(512, ge=256, le=768)
    num_images: int = Field(1, ge=1, le=4)
    seed: Optional[int] = None


class Img2ImgRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    image: str
    mask: Optional[str] = None
    strength: float = Field(0.6, ge=0.05, le=1.0)
    num_images: int = Field(1, ge=1, le=4)
    seed: Optional[int] = None


def _seeds(seed: Optional[int], n: int) -> list[int]:
    base = seed if seed is not None else random.randint(0, 2**31 - 1)
    return [base + i * 101 for i in range(n)]


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "lora": LORA, "loaded": list(_pipes)}


@app.post("/generate")
def generate(req: GenerateRequest):
    import torch

    seeds = _seeds(req.seed, req.num_images)
    with _lock:
        pipe = _load("txt2img")
        images = []
        for s in seeds:
            g = torch.Generator(device="cpu").manual_seed(s)
            out = pipe(
                req.prompt,
                negative_prompt=NEGATIVE,
                width=req.width - req.width % 8,
                height=req.height - req.height % 8,
                num_inference_steps=STEPS,
                generator=g,
            )
            images.append(_b64png(out.images[0]))
    return {"images": images, "seeds": seeds}


@app.post("/img2img")
def img2img(req: Img2ImgRequest):
    import torch

    try:
        init = _decode(req.image)
        mask = _decode(req.mask) if req.mask else None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"bad image: {e}") from e
    seeds = _seeds(req.seed, req.num_images)
    with _lock:
        pipe = _load("inpaint" if mask is not None else "img2img")
        images = []
        for s in seeds:
            g = torch.Generator(device="cpu").manual_seed(s)
            kwargs = dict(prompt=req.prompt, negative_prompt=NEGATIVE, image=init, strength=req.strength,
                          num_inference_steps=STEPS, generator=g)
            if mask is not None:
                kwargs["mask_image"] = mask
            images.append(_b64png(pipe(**kwargs).images[0]))
    return {"images": images, "seeds": seeds}
