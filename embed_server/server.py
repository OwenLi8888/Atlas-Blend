# pip install fastapi uvicorn torch transformers pillow python-multipart
import io, torch
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from transformers import AutoModel, AutoProcessor

MODEL = "google/siglip2-so400m-patch14-384"
dev = "mps" if torch.backends.mps.is_available() else "cpu"
model = AutoModel.from_pretrained(MODEL).to(dev).eval()
proc = AutoProcessor.from_pretrained(MODEL)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/embed")
async def embed(file: UploadFile):
    img = Image.open(io.BytesIO(await file.read())).convert("RGB")
    inputs = proc(images=img, return_tensors="pt").to(dev)
    with torch.no_grad():
        v = model.get_image_features(**inputs)
    v = torch.nn.functional.normalize(v, dim=-1)
    return {"vector": v[0].cpu().tolist()}

# run: uvicorn server:app --port 8731  (from the embed_server/ folder)
