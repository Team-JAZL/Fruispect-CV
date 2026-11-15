# Define the research model architectures and reference image inference.
from pathlib import Path
import torch
from torch import nn
from torchvision import models, transforms as T
from PIL import Image, ImageOps

class MultiTaskFruitCNN(nn.Module):
    # Initialize the component and its required dependencies.
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
    # Compute independent fruit and quality logits from shared backbone features.
    def forward(self,image):
        features=self.backbone(image)
        return self.fruit_head(features),self.quality_head(features)

# Load a reference architecture and its strict checkpoint weights once.
def load_fruispect_model(checkpoint_path,device='cpu'):

    device=torch.device(device)
    checkpoint=torch.load(Path(checkpoint_path),map_location='cpu',weights_only=True)
    assert checkpoint['format_version']==1
    model=MultiTaskFruitCNN(checkpoint['architecture'])
    model.load_state_dict(checkpoint['state_dict'],strict=True)
    return model.to(device).eval(),checkpoint['preprocessing'],device

# Apply the recorded image transform and return reference head probabilities.
def predict_fruispect_image(model,metadata,device,image):

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
