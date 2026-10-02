# OWN MOVIE — Plataforma Local de Produção de Vídeo e Áudio com IA

> Base: `WAN2.2.json` (ComfyUI, Wan 2.2 14B GGUF) + agentes **Hermes Agent**, **OmniRoute** e **OmniVoice**.
> Execução 100% em **localhost**. Tarefas distribuídas entre **GPU, CPU, RAM e SSD**.

---

## 1. Visão geral

O OWN MOVIE é uma plataforma local em que o usuário descreve uma ideia ou roteiro e uma equipe de agentes de IA o transforma em vídeo com áudio sincronizado.

| Camada | Componente | Papel |
|---|---|---|
| Interface | **OWN MOVIE UI** (porta 3000) | Dashboard, projetos, canvas do workflow, preview, logs |
| Orquestração | **OWN MOVIE API** (porta 8000) | Fila de jobs, scheduler de hardware, ponte entre agentes e ComfyUI |
| Agentes | **Hermes Agent** | Planeja, divide em cenas, chama ferramentas, cria *skills* reutilizáveis |
| Roteamento de LLM | **OmniRoute** (porta 20128) | Endpoint único compatível com OpenAI; fallback entre modelos locais (Ollama/llama.cpp) e provedores |
| Voz | **OmniVoice** (TTS, porta 8001) | Narração/dublagem com clonagem de voz zero-shot, 600+ idiomas |
| Vídeo | **ComfyUI** (porta 8188) + `WAN2.2.json` | Geração t2v / i2v |
| Pós | **FFmpeg** | Mux de áudio, concatenação de clipes, legendas |

---

## 2. Análise real do `WAN2.2.json`

Dados lidos diretamente do arquivo (frontend ComfyUI 1.37.11, formato de workflow 0.4):

- **55 nodes · 37 links · 11 grupos · 3 subgraphs**
- Pacotes de nodes: rgthree-comfy, cg-use-everywhere, ComfyUI-Easy-Use, VideoHelperSuite, KJNodes, ComfyUI-GGUF, Memory_Cleanup, Custom-Scripts, efficiency-nodes, Impact (switches).

### 2.1 Grupos (como estão no canvas)

| # | Grupo | Nodes principais | Função |
|---|---|---|---|
| 1 | **Loaders** | `UnetLoaderGGUF` (id 2), `CLIPLoaderGGUF` (4, type `wan`), `VAELoader` (6), `ModelSamplingSD3` (5, shift **8.0**) | Carrega modelo, encoder de texto e VAE |
| 2 | **Image** | `LoadImage` (23), `ImageResizeKJv2` (85, lanczos, crop, device `cpu`) | Imagem de entrada para i2v |
| 3 | **Prompt** | `CLIPTextEncode` positivo (12), negativo (127) | Condicionamento de texto |
| 4 | **Lora Loader** | `easy loraStackApply` (91) | Aplica a pilha de LoRAs a modelo e CLIP |
| 5 | **Lora Stack** | `easy loraStack` (92) | Define até 10 LoRAs (1 ativa no arquivo) |
| 6 | **Height, Width & Length** | Subgraph **t2v, i2v** (74) | Largura, altura, FPS, segundos → frames |
| 7 | **KSampler** | `KSampler (Efficient)` (7) | Amostragem + decodificação VAE em tiles |
| 8 | **Last Frame** | `VHS_SelectEveryNthImage` (83), `SaveImage` (82), subgraph **Gate** (138) | Salva o último frame para encadear clipes |
| 9 | **Video Combine** | `VHS_VideoCombine` (115) | Gera o MP4 H.264 |
| 10 | **Memory Management** | `VRAMCleanup` (106), `RAMCleanup` (107), `EmptyLatentImage` (109) | Limpeza de memória (**mutados por padrão**) |
| 11 | **See all the Frames** | `PreviewImage` (139) | Visualiza os frames |

Fora dos grupos: `Fast Groups Muter (rgthree)` (140), `Context (rgthree)` ×4 (40, 50, 60, 67), `Anything Everywhere` ×19 (fios invisíveis), `PrimitiveString Filename_Prefix` (104), `SetNode/GetNode LENGTH` (130/131) e 6 `MarkdownNote` (MODELS, Memory Mangemant Info, Last Frame, IMPORTANT (OLD), IMPORTANT, Choose).

### 2.2 Valores reais configurados

| Parâmetro | Valor no arquivo |
|---|---|
| Modelo (UNet GGUF) | `wan2.2-rapid-mega-aio-nsfw-v12.1-Q4_K.gguf` |
| Text encoder | `umt5-xxl-encoder-Q3_K_S.gguf` (type `wan`) |
| VAE | `wan_2.1_vae.safetensors` |
| ModelSamplingSD3 shift | 8.0 |
| **Sampler** | `euler_ancestral`, scheduler `beta` |
| **Steps / CFG / Denoise** | **4 / 1.5 / 1.0** |
| VAE decode | `true (tiled)` |
| Resolução padrão | **512 × 512** |
| FPS / Segundos | **16 / 1** → length = 16 × 1 + 1 = **17 frames** |
| Saída | `video/h264-mp4`, `yuv420p`, CRF 19, prefixo `Wan/Video` |
| Last frame | `skip_first_images = length − 1`, `select_every_nth = 1` → `Wan/VideoLastFrame` |
| LoRA | 1 slot ativo, força 0.6 (arquivo local do autor) |

### 2.3 Lógica interna importante

1. **Subgraph `t2v, i2v`** contém `WanImageToVideo` + `CLIPVisionEncode` (i2v) e `EmptyHunyuanVideo15Latent` (t2v). Fórmula de frames: `MathExpression: a * b + 1` (FPS × Segundos + 1).
2. **Subgraph `1=t2v,2=i2v`** (id 59) usa 3 `ImpactSwitch` para trocar positivo, negativo e latente com **um único seletor** (`PrimitiveInt`, 1 = t2v, 2 = i2v).
3. **Subgraph `Gate`** calcula `length − 1` para o skip do last frame.
4. Dados trafegam por **Context (rgthree)** e **Anything Everywhere**, por isso o canvas tem poucos fios visíveis (37 links reais).
5. **Estado padrão = t2v:** `LoadImage`, `ImageResizeKJv2`, `ConditioningZeroOut`, `EmptyLatentImage`, `VRAMCleanup` e `RAMCleanup` estão em mode 2 (mutados).

### 2.4 Fluxo de dados

```
UnetLoaderGGUF ─► ModelSamplingSD3 ─► loraStackApply ─┐
CLIPLoaderGGUF ──────────────────────► loraStackApply ─┤
VAELoader ─────────────────────────────────────────────┤
                                                       ▼
 (LoadImage ► ImageResizeKJv2) ─► subgraph t2v/i2v ─► Context ─► KSampler (Efficient)
 CLIPTextEncode (+) / (−) ────────────────────────────┘             │
                                                                    ├─► VHS_VideoCombine ─► MP4
                                                                    ├─► SelectEveryNth ─► SaveImage (last frame)
                                                                    └─► PreviewImage
```

### 2.5 Divergências entre o mockup `ComfYUI.png` e o arquivo real

O mockup enviado é ilustrativo. Para a plataforma funcionar, o layout usa **os valores do JSON**:

| Item | Mockup | Arquivo real |
|---|---|---|
| Steps / CFG | 20 / 7.0 | **4 / 1.5** |
| Sampler / Scheduler | dpmpp_2m / karras | **euler_ancestral / beta** |
| Resolução | 1024 × 1024 | **512 × 512** |
| Length | 81 | **17** (FPS 16 × 1 s + 1) |
| Modelo | `load_wan2.2.gguf` | **`wan2.2-rapid-mega-aio-nsfw-v12.1-Q4_K.gguf`** |
| Frame rate | 16 | 16 ✔ |
| Nodes / Links / Grupos | 55 / 37 / 11 | 55 / 37 / 11 ✔ |

---

## 3. Arquitetura

```
┌──────────────────────── OWN MOVIE UI (localhost:3000) ────────────────────────┐
│ Dashboard · Projetos · Agentes IA · ComfyUI · OmniVoice · Modelos · Arquivos  │
└───────────────┬───────────────────────────────────────────────────────────────┘
                │ REST + WebSocket
┌───────────────▼──────────────── OWN MOVIE API (localhost:8000) ───────────────┐
│ Job Queue · Hardware Scheduler · Project Store · Workflow Patcher             │
└──┬─────────────┬───────────────┬──────────────────┬───────────────────┬───────┘
   │             │               │                  │                   │
┌──▼──────┐ ┌────▼─────┐   ┌─────▼──────┐   ┌───────▼──────┐    ┌───────▼──────┐
│ Hermes  │►│ OmniRoute│   │ OmniVoice  │   │   ComfyUI    │    │   FFmpeg     │
│ Agent   │ │ :20128   │   │ TTS :8001  │   │ :8188 + WAN  │    │ mux / concat │
└─────────┘ └──────────┘   └────────────┘   └──────────────┘    └──────────────┘
```

**Fluxo de produção**

1. Usuário envia ideia/roteiro.
2. **Hermes (Planner)** divide em cenas (cada uma com prompt, duração, FPS e fala).
3. **OmniRoute** serve o LLM escolhido (local primeiro, fallback depois).
4. **Workflow Patcher** injeta prompt, tamanho, segundos e modo (t2v/i2v) no `WAN2.2.json` e envia a `POST /prompt` do ComfyUI.
5. **Chaining:** o *last frame* da cena N vira a imagem de entrada (i2v) da cena N+1.
6. **OmniVoice** gera a narração de cada cena em paralelo (CPU).
7. **FFmpeg** concatena clipes, mixa áudio, aplica legendas → `output/renders/`.

---

## 4. Agentes de IA

| Agente | Base | Responsabilidade | Ferramentas |
|---|---|---|---|
| **Hermes (Planner)** | Hermes Agent (Nous Research, MIT) | Roteiro → cenas → prompts, decide t2v/i2v, cria skills | Skills, memória, MCP, gateway (Telegram/Discord) |
| **OmniRoute (Roteador)** | OmniRoute (MIT) | Endpoint único `http://localhost:20128/v1`, fallback e quotas | Combos de modelos, MCP server |
| **OmniVoice (Voz)** | OmniVoice (k2-fsa) | TTS e clonagem de voz, multilíngue | `omnivoice-infer`, API Python, demo Gradio |
| **Vision Agent** | Skill do Hermes + LLM multimodal | Avalia frames, checa consistência, sugere correção de prompt | Leitura de frames do last frame |
| **Project Agent** | Skill do Hermes | Cria pastas, versiona prompts, mantém `project.json` | Sistema de arquivos |
| **File Agent** | Skill do Hermes | Organiza `output/`, limpa temporários, valida hashes de modelos | Sistema de arquivos, FFmpeg |

> Vision, Project e File são **papéis** implementados como *skills* do Hermes, não produtos separados.

**Configuração mínima do Hermes apontando para o OmniRoute**

```bash
hermes setup model        # endpoint custom: http://localhost:20128/v1
hermes skills install <skill>   # skills do projeto em agents/skills/
```

---

## 5. Distribuição de hardware

Um passo de difusão **não** pode ser dividido entre GPU e CPU sem perder desempenho. A distribuição real é **por estágio do pipeline**, mais o *offload* nativo do ComfyUI/GGUF.

| Componente | Tarefas | Uso esperado |
|---|---|---|
| **GPU (VRAM)** | UNet Wan 2.2 (amostragem), VAE decode em tiles | 70–100 % durante geração |
| **CPU** | Hermes, OmniRoute, API, `ImageResizeKJv2` (device `cpu`), FFmpeg, OmniVoice (se VRAM ≤ 8 GB) | 30–60 % |
| **RAM** | Pesos GGUF descarregados (~9 GB segundo o README), cache de CLIP, buffers de frames | 50–80 % |
| **SSD** | Biblioteca de modelos (mmap), `output/`, frames temporários, banco de projetos | 20–50 % I/O |

### Perfis (do README do workflow)

| VRAM | UNet | Text encoder | RAM sugerida | Observação |
|---|---|---|---|---|
| 6 GB | Q3_K | Q3_K_M | 16 GB | ~4,6 min por 1 s (RTX 3050 6 GB) |
| 8 GB | **Q4_K** | Q3_K_M | 32 GB | Balanceado |
| 10 GB+ | Q5_K | Q4_K_M | 32 GB+ | Mais qualidade |

### Política do Scheduler

1. **Fila única na GPU:** um job de vídeo por vez.
2. **Em paralelo fora da GPU:** TTS (CPU), planejamento (LLM via OmniRoute), FFmpeg, organização de arquivos.
3. **Memória:** ativar o grupo *Memory Management* (`VRAMCleanup` + `RAMCleanup`) entre cenas quando a VRAM ≤ 8 GB; o arquivo vem com ele mutado.
4. **SSD:** modelos em NVMe; `output/` e temporários em disco separado quando possível.
5. **Multi-GPU (opcional):** GPU 1 = vídeo, GPU 2 = TTS/LLM. O `omnivoice-infer-batch` já distribui lotes entre GPUs.

---

## 6. Layout / Design System

Identidade extraída do logo (câmera preta com contorno azul-elétrico e texto prata).

| Token | Valor |
|---|---|
| `--bg` | `#070B14` |
| `--panel` | `#0E1626` |
| `--line` | `#1B2A45` |
| `--blue` | `#1E6BFF` |
| `--cyan` | `#22C7FF` |
| `--silver` | `#E6ECF5` |
| `--ok` | `#34D399` |
| Tipografia | Títulos: **Sora**; interface: **IBM Plex Sans**; código/valores: **IBM Plex Mono** |

### Telas

1. **Dashboard** — métricas GPU/RAM/CPU/SSD, jobs ativos, últimos renders.
2. **Projetos** — lista de cenas, linha do tempo, status por cena.
3. **Agentes IA** — estado do Hermes, OmniRoute, OmniVoice, Vision, Project, File.
4. **ComfyUI** — canvas do `WAN2.2.json` com abas *Workflow · Modelo · Configurações · Logs*.
5. **OmniVoice** — vozes, clonagem, geração por cena.
6. **Modelos** — UNet/CLIP/VAE/LoRA instalados, tamanho, perfil por VRAM.
7. **Arquivos** — `output/videos`, `audio`, `images`.
8. **Configurações** — portas, caminhos, perfil de hardware, provedores.

Grid da tela principal: barra superior (logo + navegação + status) · coluna esquerda (agentes, ferramentas, projetos) · centro (canvas ComfyUI) · coluna direita (preview + info do workflow) · faixa inferior (arquitetura, instalação, estrutura, hardware, roadmap).

O mockup está no canvas **OWN MOVIE — Layout da Plataforma**. O grafo central é **gerado a partir do `WAN2.2.json`**: os 55 nodes nas coordenadas originais, os 11 grupos com as cores originais e os 37 links. Os mesmos dados estão nos Apêndices A e B. Arquivos de apoio: `WAN2.2_workflow_real.svg` e `.png`.

---

## 7. Estrutura do projeto

```
OWN_MOVIE/
├─ workflows/
│  └─ WAN2.2.json              # arquivo base (UI)
│  └─ WAN2.2.api.json          # exportado via "Save (API Format)"
├─ models/
│  ├─ unet/    wan2.2-rapid-mega-aio-nsfw-v12.1-Q4_K.gguf
│  ├─ clip/    umt5-xxl-encoder-Q3_K_S.gguf
│  ├─ vae/     wan_2.1_vae.safetensors
│  └─ loras/
├─ agents/
│  ├─ hermes/  config + skills/
│  ├─ omniroute/ combos.json
│  └─ omnivoice/ voices/
├─ api/                        # OWN MOVIE API (porta 8000)
├─ ui/                         # OWN MOVIE UI (porta 3000)
├─ projects/<nome>/
│  ├─ project.json   scenes.json   prompts/
├─ output/
│  ├─ videos/  audio/  images/  renders/
├─ data/   config/
```

---

## 8. Instalação

```bash
# 1. Pré-requisitos: Python 3.10+, Git, Node.js 18–22 LTS, FFmpeg
# 2. ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI && cd ComfyUI
pip install -r requirements.txt
# 3. Custom nodes (via ComfyUI Manager ou clone manual)
#    rgthree-comfy, cg-use-everywhere, ComfyUI-Easy-Use, ComfyUI-VideoHelperSuite,
#    ComfyUI-KJNodes, ComfyUI-GGUF, Comfyui-Memory_Cleanup,
#    ComfyUI-Custom-Scripts, efficiency-nodes-comfyui  (+ Impact Pack para os switches)
# 4. Modelos nas pastas unet/, clip/, vae/ (links no README do workflow)
# 5. OmniRoute
npm install -g omniroute && omniroute            # http://localhost:20128
# 6. Hermes Agent
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
hermes setup
# 7. OmniVoice
pip install omnivoice
omnivoice-demo --ip 127.0.0.1 --port 8001
# 8. Iniciar o ComfyUI e carregar workflows/WAN2.2.json
python main.py --listen 127.0.0.1 --port 8188
```

> Hermes no Windows roda via WSL2. OmniRoute exige Node 18–22.

---

## 9. Contrato entre API e ComfyUI

O `WAN2.2.json` é formato de **interface**. Para automação, exporte **Save (API Format)** e use o patcher abaixo. Os IDs correspondem ao arquivo atual (devem ser reconferidos no JSON API exportado, pois os subgraphs recebem IDs compostos).

| Parâmetro do usuário | Node / widget |
|---|---|
| Prompt positivo | `CLIPTextEncode` id 12 → `text` |
| Prompt negativo | `CLIPTextEncode` id 127 → `text` |
| Largura / Altura | Subgraph 74: `PrimitiveString Width/Height` |
| FPS / Segundos | Subgraph 74: `FPS` / `Seconds` |
| Modo t2v / i2v | Subgraph 59: `PrimitiveInt` (1 / 2) + des-mutar `LoadImage` (23) e `ImageResizeKJv2` (85) |
| Imagem de entrada | `LoadImage` (23) → `image` |
| Seed | `KSampler (Efficient)` (7) → `seed` |
| Steps / CFG | `KSampler (Efficient)` (7) |
| Prefixo de saída | `PrimitiveString Filename_Prefix` (104) |
| FPS do MP4 | `VHS_VideoCombine` (115) → `frame_rate` (**igual ao FPS**) |

```python
import json, requests
wf = json.load(open("workflows/WAN2.2.api.json"))
wf["12"]["inputs"]["text"] = "A cat sunbathing in a french style window"
wf["7"]["inputs"]["seed"] = 123456
requests.post("http://127.0.0.1:8188/prompt", json={"prompt": wf})
```

---

## 10. Pipeline de áudio + vídeo

| Etapa | Ferramenta | Hardware |
|---|---|---|
| Roteiro → cenas | Hermes + OmniRoute | CPU |
| Clipes | ComfyUI / WAN 2.2 | GPU + RAM |
| Última imagem → próxima cena | `Wan/VideoLastFrame` | SSD |
| Narração | OmniVoice | CPU (ou 2ª GPU) |
| Mux e concat | `ffmpeg -i video.mp4 -i voz.wav -c:v copy -c:a aac out.mp4` | CPU |

---

## 11. Riscos e pontos de atenção

- **Conteúdo do modelo e do LoRA:** o arquivo usa um merge e um LoRA de terceiros com perfil adulto/NSFW. Para uso comercial ou público, troque por pesos neutros e confirme as licenças.
- **Licença do OmniVoice:** fontes divergem (Apache-2.0 em umas, não especificada em outras). Confirme no repositório `k2-fsa/OmniVoice` antes de uso comercial.
- **Duração:** o Wan funciona melhor em clipes curtos; vídeos longos dependem de encadeamento por last frame, com risco de deriva visual.
- **Desempenho:** os tempos do README (≈4,6 min/s em RTX 3050 6 GB) são referência, não garantia.
- **Segurança:** manter todas as portas em `127.0.0.1`.

## 12. Roadmap

1. Integração OmniVoice com sincronia de áudio por cena.
2. Pós-produção automática (legendas, cortes, transições).
3. Presets de projeto e templates.
4. Scheduler dinâmico de hardware (prioridade de fila).
5. Novos modelos (Flux, SDXL) e LoRAs próprios.

---

## Apêndice A — Inventário completo dos 55 nodes (extraído do JSON)

Contagem: 55 nodes · Anything Everywhere ×19 · MarkdownNote ×6 · Context (rgthree) ×4 · CLIPTextEncode ×2 · LoadImage ×1 · ImageResizeKJv2 ×1.

| ID | Tipo | Título | Grupo (pela posição) | Estado | Posição x,y | Valores principais |
|---|---|---|---|---|---|---|
| 2 | `UnetLoaderGGUF` | UnetLoaderGGUF | Loaders | ativo | 7127, 2061 | unet_name=wan2.2-rapid-mega-aio-nsfw-v12.1-Q4_K… |
| 3 | `ConditioningZeroOut` | ConditioningZeroOut | Prompt | mutado | 8330, 2298 | — |
| 4 | `CLIPLoaderGGUF` | CLIPLoaderGGUF | Loaders | ativo | 7127, 2166 | clip_name=D\wan\umt5-xxl-encoder-Q3_K_S.gguf, type=wan |
| 5 | `ModelSamplingSD3` | ModelSamplingSD3 | Loaders | ativo | 7132, 1957 | shift=8 |
| 6 | `VAELoader` | VAELoader | Loaders | ativo | 7135, 2292 | vae_name=D\wan_2.1_vae.safetensors |
| 7 | `KSampler (Efficient)` | KSampler (Efficient) | KSampler | ativo | 8802, 2125 | seed=664027206338740, steps=4, cfg=1.5, sampler_name=euler_ancestral |
| 12 | `CLIPTextEncode` | CLIPTextEncode | Prompt | ativo | 7908, 2106 | text=A cat sunbathing in a french style wi… |
| 23 | `LoadImage` | LoadImage | Image | mutado | 7120, 2445 | image=00020-1950169994.png |
| 39 | `Anything Everywhere` | VAE | Loaders | ativo | 7445, 2306 | — |
| 40 | `Context (rgthree)` | Context (rgthree) | KSampler | ativo | 8594, 2143 | — |
| 45 | `Anything Everywhere` | Latent | Height, Width & Length | ativo | 8187, 1653 | — |
| 48 | `Anything Everywhere` | POS | Prompt | ativo | 8131, 2141 | — |
| 49 | `Anything Everywhere` | NEG | Prompt | ativo | 8342, 2348 | — |
| 50 | `Context (rgthree)` | Context (rgthree) | KSampler | ativo | 8594, 2180 | — |
| 51 | `Anything Everywhere` | NEG | Height, Width & Length | ativo | 8194, 1744 | — |
| 52 | `Anything Everywhere` | POS | Height, Width & Length | ativo | 8193, 1698 | — |
| 53 | `Anything Everywhere` | Latent | Height, Width & Length | ativo | 8191, 1789 | — |
| 54 | `Anything Everywhere` | POS | Prompt | ativo | 8128, 2194 | — |
| 55 | `Anything Everywhere` | NEG | Prompt | ativo | 8345, 2406 | — |
| 56 | `Anything Everywhere` | MODEL | Loaders | ativo | 7442, 1989 | — |
| 59 | `subgraph` | 1=t2v,2=i2v | KSampler | ativo | 8568, 2121 | 1=t2v, 2=i2v=1 |
| 60 | `Context (rgthree)` | Context (rgthree) | KSampler | ativo | 8821, 2152 | — |
| 61 | `Anything Everywhere` | Clip | Loaders | ativo | 7447, 2217 | — |
| 62 | `Anything Everywhere` | MODEL | Loaders | ativo | 7441, 2089 | — |
| 67 | `Context (rgthree)` | Context (rgthree) | Height, Width & Length | ativo | 7929, 1611 | — |
| 74 | `subgraph` | t2v, i2v | Height, Width & Length | ativo | 7935, 1645 | Width=512, Height=512, FPS=16, Seconds=1 |
| 75 | `Anything Everywhere` | Image | Image | mutado | 7768, 2504 | — |
| 76 | `Anything Everywhere` | ZERO | Prompt | ativo | 8349, 2268 | — |
| 82 | `SaveImage` | SaveImage | — | ativo | 8858, 2567 | filename_prefix=Wan/VideoLastFrame |
| 83 | `VHS_SelectEveryNthImage` | VHS_SelectEveryNthImage | Last Frame | ativo | 8557, 2562 | select_every_nth=1, skip_first_images=80 |
| 85 | `ImageResizeKJv2` | ImageResizeKJv2 | Image | mutado | 7460, 2476 | width=512, height=512, upscale_method=lanczos, keep_proportion=crop |
| 91 | `easy loraStackApply` | easy loraStackApply | Lora Loader | ativo | 7571, 1976 | — |
| 92 | `easy loraStack` | easy loraStack | Lora Stack | ativo | 7578, 2192 | toggle=true, mode=simple, num_loras=1, lora_name_1=WAN\14B\DR34ML4Y_I2V_14B_LOW_V2.safet… |
| 93 | `Anything Everywhere` | MODEL | Lora Loader | ativo | 7779, 1969 | — |
| 94 | `Anything Everywhere` | Clip | Lora Stack | ativo | 7784, 2027 | — |
| 95 | `Anything Everywhere` | Lora Stack | Lora Stack | ativo | 7633, 2141 | — |
| 96 | `MarkdownNote` | IMPORTANT (OLD) | — | ativo | 8340, 1480 | nota |
| 97 | `Anything Everywhere` | Select Every Nth | KSampler | ativo | 8910, 2198 | — |
| 104 | `PrimitiveString` | Filename_Prefix | Prompt | ativo | 8317, 2449 | value=Wan/Video |
| 106 | `VRAMCleanup` | VRAMCleanup | Memory Management | mutado | 7331, 1720 | offload_model=true, offload_cache=true |
| 107 | `RAMCleanup` | RAMCleanup | Memory Management | mutado | 7609, 1719 | clean_file_cache=true, clean_processes=true, clean_dlls=true, retry_times=3 |
| 109 | `EmptyLatentImage` | EmptyLatentImage | Memory Management | mutado | 7404, 1743 | width=512, height=512, batch_size=1 |
| 110 | `MarkdownNote` | Choose | KSampler | ativo | 8569, 2243 | nota |
| 111 | `MarkdownNote` | MODELS | — | ativo | 6577, 1824 | nota |
| 112 | `MarkdownNote` | Last Frame | — | ativo | 8325, 2556 | nota |
| 113 | `MarkdownNote` | Memory Mangemant Info | — | ativo | 7102, 1669 | nota |
| 115 | `VHS_VideoCombine` | VHS_VideoCombine | Video Combine | ativo | 7927, 2626 | frame_rate=16, loop_count=0, filename_prefix=Wan/Video, format=video/h264-mp4 |
| 120 | `Anything Everywhere` | Video Combine | KSampler | ativo | 8893, 2147 | — |
| 127 | `CLIPTextEncode` | CLIPTextEncode | Prompt | ativo | 7911, 2378 | text= |
| 130 | `SetNode` | Set_LENGTH | Height, Width & Length | ativo | 8186, 1827 | name=LENGTH |
| 131 | `GetNode` | Get_LENGTH | Last Frame | ativo | 8565, 2570 | name=LENGTH |
| 138 | `subgraph` | Gate | Last Frame | ativo | 8571, 2572 | — |
| 139 | `PreviewImage` | PreviewImage | See all the Frames | ativo | 9184, 2089 | — |
| 140 | `Fast Groups Muter (rgthree)` | Fast Groups Muter (rgthree) | Prompt | ativo | 8315, 2100 | — |
| 141 | `MarkdownNote` | IMPORTANT | — | ativo | 8354, 1704 | nota |

## Apêndice B — Os 37 links do arquivo

| Link | Origem (nó:slot) | Destino (nó:slot) | Tipo |
|---|---|---|---|
| 84 | 6 VAELoader : VAE | 39 VAE : anything | VAE |
| 89 | 12 CLIPTextEncode : CONDITIONING | 48 POS : anything11 | CONDITIONING |
| 95 | 12 CLIPTextEncode : CONDITIONING | 54 POS : anything13 | CONDITIONING |
| 97 | 5 ModelSamplingSD3 : MODEL | 56 MODEL : anything | MODEL |
| 111 | 40 Context (rgthree) : CONTEXT | 59 1=t2v,2=i2v : base_ctx | RGTHREE_CONTEXT |
| 112 | 50 Context (rgthree) : CONTEXT | 59 1=t2v,2=i2v : base_ctx_1 | RGTHREE_CONTEXT |
| 113 | 59 1=t2v,2=i2v : CONTEXT | 60 Context (rgthree) : base_ctx | RGTHREE_CONTEXT |
| 114 | 60 Context (rgthree) : POSITIVE | 7 KSampler (Efficient) : positive | CONDITIONING |
| 115 | 60 Context (rgthree) : NEGATIVE | 7 KSampler (Efficient) : negative | CONDITIONING |
| 116 | 60 Context (rgthree) : LATENT | 7 KSampler (Efficient) : latent_image | LATENT |
| 117 | 4 CLIPLoaderGGUF : CLIP | 61 Clip : anything | CLIP |
| 118 | 2 UnetLoaderGGUF : MODEL | 62 MODEL : anything | MODEL |
| 195 | 74 t2v, i2v : LATENT | 45 Latent : anything | LATENT |
| 197 | 74 t2v, i2v : positive | 52 POS : anything12 | CONDITIONING |
| 199 | 74 t2v, i2v : negative | 51 NEG : anything13 | CONDITIONING |
| 201 | 74 t2v, i2v : latent | 53 Latent : anything11 | LATENT |
| 203 | 67 Context (rgthree) : CONTEXT | 74 t2v, i2v : base_ctx | RGTHREE_CONTEXT |
| 205 | 12 CLIPTextEncode : CONDITIONING | 76 ZERO : anything | CONDITIONING |
| 214 | 83 VHS_SelectEveryNthImage : IMAGE | 82 SaveImage : images | IMAGE |
| 262 | 85 ImageResizeKJv2 : IMAGE | 75 Image : anything | IMAGE |
| 263 | 23 LoadImage : IMAGE | 85 ImageResizeKJv2 : image | IMAGE |
| 384 | 91 easy loraStackApply : model | 93 MODEL : anything11 | MODEL |
| 385 | 91 easy loraStackApply : clip | 94 Clip : anything11 | CLIP |
| 386 | 92 easy loraStack : lora_stack | 95 Lora Stack : anything | LORA_STACK |
| 387 | 7 KSampler (Efficient) : IMAGE | 97 Select Every Nth : anything | IMAGE |
| 425 | 109 EmptyLatentImage : LATENT | 106 VRAMCleanup : anything | LATENT |
| 426 | 109 EmptyLatentImage : LATENT | 107 RAMCleanup : anything | LATENT |
| 508 | 104 Filename_Prefix : STRING | 115 VHS_VideoCombine : filename_prefix | STRING |
| 510 | 7 KSampler (Efficient) : IMAGE | 120 Video Combine : anything | IMAGE |
| 652 | 104 Filename_Prefix : STRING | 82 SaveImage : filename_prefix | STRING |
| 821 | 12 CLIPTextEncode : CONDITIONING | 3 ConditioningZeroOut : conditioning | CONDITIONING |
| 846 | 127 CLIPTextEncode : CONDITIONING | 55 NEG : anything15 | CONDITIONING |
| 848 | 127 CLIPTextEncode : CONDITIONING | 49 NEG : anything12 | CONDITIONING |
| 919 | 74 t2v, i2v : value | 130 Set_LENGTH : INT | INT |
| 973 | 131 Get_LENGTH : INT | 138 Gate : value | INT |
| 975 | 138 Gate : INT | 83 VHS_SelectEveryNthImage : skip_first_images | INT |
| 1022 | 7 KSampler (Efficient) : IMAGE | 139 PreviewImage : images | IMAGE |

> Os fios de *Anything Everywhere* (cg-use-everywhere) não aparecem como links: são difusões invisíveis registradas em `extra.ue_links`, por isso o arquivo tem só 37 links visíveis.
