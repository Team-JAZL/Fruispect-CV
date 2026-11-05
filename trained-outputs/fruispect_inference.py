# Fruispect inference-only helper. No Flask or frontend dependency.
from pathlib import Path
import torch
from torch import nn
from torchvision import models, transforms as T
from PIL import Image, ImageOps

class MultiTaskFruitCNN(nn.Module):
    def __init__(self,architecture):
        super().__init__()
        if architecture=='resnet18':
            self.backbone=models.resnet18(weights=None)
            nf=self.backbone.fc.in_features
            self.backbone.fc=nn.Identity()
        elif architecture=='mobilenet_v3_small':
            self.backbone=models.mobilenet_v3_small(weights=None)
            nf=self.backbone.classifier[0].in_features
            self.backbone.classifier=nn.Identity()
        elif architecture=='efficientnet_b0':
            self.backbone=models.efficientnet_b0(weights=None)
            nf=self.backbone.classifier[-1].in_features
            self.backbone.classifier=nn.Identity()
        else:
            raise ValueError(f'Unsupported architecture: {architecture}')
        self.fruit_head=nn.Linear(nf,6)
        self.quality_head=nn.Linear(nf,2)
    def forward(self,image):
        features=self.backbone(image)
        return self.fruit_head(features),self.quality_head(features)

def load_fruispect_model(checkpoint_path,device='cpu'):
    # Call once at server startup; do not reload the checkpoint for every request.
    device=torch.device(device)
    checkpoint=torch.load(Path(checkpoint_path),map_location='cpu',weights_only=True)
    assert checkpoint['format_version']==1
    model=MultiTaskFruitCNN(checkpoint['architecture'])
    model.load_state_dict(checkpoint['state_dict'],strict=True)
    return model.to(device).eval(),checkpoint['preprocessing'],device

def predict_fruispect_image(model,metadata,device,image):
    # image may be a PIL.Image.Image or an image path.
    if not isinstance(image,Image.Image):
        with Image.open(image) as file_image:
            image=file_image.copy()
    image=ImageOps.exif_transpose(image).convert('RGB')
    side=int(metadata['size'])
    image.thumbnail((side,side),Image.Resampling.BILINEAR)
    canvas=Image.new('RGB',(side,side),(128,128,128))
    canvas.paste(image,((side-image.width)//2,(side-image.height)//2))
    transform=T.Compose([T.ToTensor(),T.Normalize(metadata['mean'],metadata['std'])])
    batch=transform(canvas).unsqueeze(0).to(device)
    with torch.inference_mode():
        fruit_logits,quality_logits=model(batch)
        fruit=fruit_logits.softmax(dim=1)[0].cpu().tolist()
        quality=quality_logits.softmax(dim=1)[0].cpu().tolist()
    fruits=metadata['fruit_classes'];qualities=metadata['quality_classes']
    return {
        'fruit_prediction':fruits[max(range(6),key=fruit.__getitem__)],
        'quality_prediction':qualities[max(range(2),key=quality.__getitem__)],
        'fruit_confidences':dict(zip(fruits,fruit)),
        'quality_confidences':dict(zip(qualities,quality)),
    }
