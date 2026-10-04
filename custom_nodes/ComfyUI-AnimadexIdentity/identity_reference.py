"""Use the author's trained in-context adapter, not a prompt-only imitation."""
import base64,json,re
from pathlib import Path
import folder_paths
import numpy as np
import torch
from PIL import Image,ImageOps
from .nodes import AnimaRefEncode
from .incontext import apply_incontext_ref
LORA='CodexAnima/anima-incontext-character.safetensors'
MANIFEST=re.compile(r'@adref:([A-Za-z0-9_=-]+)')

def decode_files(prompt):
    matches=list(MANIFEST.finditer(prompt));files=[]
    if len(matches)>1:raise ValueError('Multiple reference manifests')
    if matches:
        encoded=matches[0].group(1);files=json.loads(base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)))
        if not isinstance(files,list) or len(files)>4 or any(not isinstance(f,str) or not re.fullmatch(r'AnimadexIdentity/img_[0-9a-f]{64}\.png',f) for f in files):raise ValueError('Invalid owned reference file')
    return MANIFEST.sub('',prompt),files

class AnimadexReferenceManifest:
    @classmethod
    def INPUT_TYPES(cls):return {'required':{'prompt':('STRING',{'forceInput':True})}}
    RETURN_TYPES=('STRING','STRING');RETURN_NAMES=('prompt','reference_files');FUNCTION='parse';CATEGORY='Animadex'
    def parse(self,prompt):
        clean,files=decode_files(prompt);return clean,json.dumps(files)

class AnimadexIdentityReference:
    def __init__(self):self._mapper=None
    @classmethod
    def INPUT_TYPES(cls):return {'required':{'model':('MODEL',),'vae':('VAE',),'reference_files':('STRING',{'forceInput':True}),'width':('INT',{'default':704,'min':256,'max':1536}),'height':('INT',{'default':1152,'min':256,'max':1536}),'strength':('FLOAT',{'default':1.0,'min':0.1,'max':2.0}),'end_percent':('FLOAT',{'default':0.8,'min':0.1,'max':1.0})}}
    RETURN_TYPES=('MODEL',);FUNCTION='apply';CATEGORY='Animadex'
    def apply(self,model,vae,reference_files,width,height,strength=1.0,end_percent=0.8):
        files=json.loads(reference_files)
        if not files:return (model,)
        # Same validation even for manually edited workflows.
        decode_files('@adref:'+base64.urlsafe_b64encode(json.dumps(files).encode()).decode())
        import nodes
        dm=model.get_model_object('diffusion_model');count=len(dm.blocks)
        if count==40:
            loader=nodes.NODE_CLASS_MAPPINGS.get('Anima2BTo29BLoraLoaderModelOnly')
            if loader is None:raise RuntimeError('Anima 2B-to-2.9B reference LoRA mapper is missing')
            self._mapper=self._mapper or loader()
            model=self._mapper.load_lora_model_only(model,LORA,1.0,True,True)[0]
        elif count==28:model=nodes.LoraLoaderModelOnly().load_lora_model_only(model,LORA,1.0)[0]
        else:raise RuntimeError('The reference adapter requires an Anima model')
        latents=[];root=Path(folder_paths.get_input_directory()).resolve()
        for filename in files:
            path=(root/filename).resolve()
            if not path.is_relative_to(root/'AnimadexIdentity') or not path.is_file():raise ValueError('Reference file unavailable')
            with Image.open(path) as image:array=np.array(ImageOps.exif_transpose(image).convert('RGB'),dtype=np.float32)/255.0
            pixels=torch.from_numpy(array).unsqueeze(0)
            latents.append(AnimaRefEncode().encode(vae,pixels,target_width=width,target_height=height)[0]['samples'])
        refs=torch.cat(latents,dim=0)
        return (apply_incontext_ref(model,refs,strength,0.0,end_percent,cond_only=True,fit_mode='pad'),)

class AnimadexIdentityCanvas:
    @classmethod
    def INPUT_TYPES(cls):return {'required':{'requested_width':('INT',{'default':704,'min':64,'max':8192}),'requested_height':('INT',{'default':1152,'min':64,'max':8192}),'reference_files':('STRING',{'forceInput':True})},'optional':{'main_budget':(['standard','high'],{'default':'standard'}),'output_size':(['original','tablet'],{'default':'original'}),'reference_budget':(['standard','quality'],{'default':'standard'})}}
    RETURN_TYPES=('INT','INT','INT','INT');RETURN_NAMES=('width','height','output_width','output_height');FUNCTION='budget';CATEGORY='Animadex'
    def budget(self,requested_width,requested_height,reference_files,main_budget='standard',output_size='original',reference_budget='standard'):
        portrait=requested_height*100>=requested_width*115;landscape=requested_width*100>=requested_height*115
        output=(704,1152)if portrait else(1152,704)if landscape else(896,896)
        if output_size!='tablet':output=(880,1440)if portrait else(1440,880)if landscape else(1120,1120)
        if json.loads(reference_files):
            if reference_budget=='quality':size=(576,928)if portrait else(928,576)if landscape else(704,704)
            else:size=(512,832)if portrait else(832,512)if landscape else(640,640)
        elif main_budget=='high':size=(832,1344)if portrait else(1344,832)if landscape else(1024,1024)
        else:size=(704,1152)if portrait else(1152,704)if landscape else(896,896)
        return (*size,*output)

class AnimadexDrawingModel:
    @classmethod
    def INPUT_TYPES(cls):return {'required':{'reference_files':('STRING',{'forceInput':True}),'main_model':('MODEL',{'lazy':True}),'main_clip':('CLIP',{'lazy':True}),'reference_model':('MODEL',{'lazy':True}),'reference_clip':('CLIP',{'lazy':True})},'optional':{'main_steps':('INT',{'default':20}),'main_cfg':('FLOAT',{'default':2.0}),'main_sampler':('STRING',{'default':'euler'}),'main_scheduler':('STRING',{'default':'sgm_uniform'}),'reference_steps':('INT',{'default':24}),'reference_cfg':('FLOAT',{'default':4.0}),'reference_sampler':('STRING',{'default':'er_sde'}),'reference_scheduler':('STRING',{'default':'simple'})}}
    RETURN_TYPES=('MODEL','CLIP','INT','FLOAT','STRING','STRING');RETURN_NAMES=('model','clip','steps','cfg','sampler','scheduler');FUNCTION='select';CATEGORY='Animadex'
    def check_lazy_status(self,reference_files,main_model=None,main_clip=None,reference_model=None,reference_clip=None,**kwargs):
        names=['reference_model','reference_clip'] if json.loads(reference_files) else ['main_model','main_clip']
        values=locals();return [key for key in names if values[key] is None]
    def select(self,reference_files,main_model=None,main_clip=None,reference_model=None,reference_clip=None,main_steps=20,main_cfg=2.0,main_sampler='euler',main_scheduler='sgm_uniform',reference_steps=24,reference_cfg=4.0,reference_sampler='er_sde',reference_scheduler='simple'):
        if json.loads(reference_files):return reference_model,reference_clip,reference_steps,reference_cfg,reference_sampler,reference_scheduler
        return main_model,main_clip,main_steps,main_cfg,main_sampler,main_scheduler

class AnimadexAdaptiveLoraLoader:
    ALLOWED=frozenset(['CodexAnima/anima-highres-aesthetic-boost.safetensors','CodexAnima/anima-renderstyle-v1.safetensors','CodexAnima/anima-mikkoani-v3.1.safetensors','BlueArchiveStyleB1.safetensors','CodexAnima/rdbt_v2.1_base_anima_b1_lora.safetensors','CodexAnima/pc98gal_style-v0.1.safetensors','CodexAnima/Nilou-V2-E12.safetensors'])
    def __init__(self):self._mapper=None;self._native=None
    @classmethod
    def INPUT_TYPES(cls):return {'required':{'model':('MODEL',),'lora_name':('STRING',{'forceInput':True}),'strength_model':('FLOAT',{'default':0.0}),'strict_model_check':('BOOLEAN',{'default':True}),'strict_lora_check':('BOOLEAN',{'default':True})},'optional':{'reference_files':('STRING',{'forceInput':True}),'skip_on_reference':('BOOLEAN',{'default':False})}}
    RETURN_TYPES=('MODEL',);FUNCTION='load';CATEGORY='Animadex'
    def load(self,model,lora_name,strength_model,strict_model_check=True,strict_lora_check=True,reference_files='[]',skip_on_reference=False):
        if strength_model==0 or skip_on_reference and json.loads(reference_files):return (model,)
        if lora_name.replace('\\','/') not in self.ALLOWED:raise ValueError('LoRA is outside the audited Animadex whitelist')
        import nodes
        count=len(model.get_model_object('diffusion_model').blocks)
        if count==28:
            self._native=self._native or nodes.LoraLoaderModelOnly();return self._native.load_lora_model_only(model,lora_name,strength_model)
        if count!=40:raise ValueError('Anima model required')
        self._mapper=self._mapper or nodes.NODE_CLASS_MAPPINGS['Anima2BTo29BLoraLoaderModelOnly']()
        return (self._mapper.load_lora_model_only(model,lora_name,strength_model,strict_model_check,strict_lora_check)[0],)

class AnimadexDrawingSampler:
    @classmethod
    def INPUT_TYPES(cls):
        import nodes
        required=dict(nodes.KSampler.INPUT_TYPES()['required']);required['sampler_name']=('STRING',{'forceInput':True});required['scheduler']=('STRING',{'forceInput':True});return {'required':required}
    RETURN_TYPES=('LATENT',);FUNCTION='sample';CATEGORY='Animadex'
    def sample(self,model,seed,steps,cfg,sampler_name,scheduler,positive,negative,latent_image,denoise=1.0):
        import nodes,comfy.samplers
        if sampler_name not in comfy.samplers.KSampler.SAMPLERS or scheduler not in comfy.samplers.KSampler.SCHEDULERS:raise ValueError('Invalid sampler selection')
        return nodes.common_ksampler(model,seed,steps,cfg,sampler_name,scheduler,positive,negative,latent_image,denoise=denoise)

