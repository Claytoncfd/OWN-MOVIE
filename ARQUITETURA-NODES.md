# OWN MOVIE — Arquitetura baseada em NODES do ComfyUI

> Substitui, onde houver conflito, as seções de bridge/patcher de `OWN_MOVIE_PLATAFORMA.md` (3, 4, 9, 10).

## Princípio
**O ComfyUI é o motor.** Cada etapa é um node em `custom_nodes/OWN_MOVIE/`. A página Projetos só dispara workflows e mostra o que está em disco. O bridge `:8000` foi removido.

```
PROJETOS (página / scripts/run-project.py)     COMFYUI (nodes OWN_MOVIE)                                  DISCO  output/OWN_MOVIE/projects/<nome>/
[Gerar cenas]     → 01_PLANO  Dividir roteiro → Agente Planner → Agente Emoção → Salvar projeto       → scenes.json
[Renderizar]      → 02_VOZ ×N Carregar cena → OmniVoice (cache)                                        → audio/cNNN_<hash>.wav
                  → 02_CENA ×N Carregar cena → OmniVoice → Áudio→segundos → Wan 2.2 → Último frame
                               → Clipe da cena (vídeo+áudio)                                           → clips/cNNN.mp4 · frames/cNNN_last.png
[Montar filme]    → 03_FINAL  Montar filme final                                                       → final.mp4
leitura de estado: GET /own_movie/project/<nome>   (rota do próprio ComfyUI)
```
A fase de voz de **todas** as cenas roda antes do vídeo, como no `batch-render.py` (a GPU fica livre para o Wan).

## Nodes (11 + compat)
| Node | Faz |
|---|---|
| `OwnMovieScriptSplitter` | texto único/fragmentado → cenas |
| `OwnMovieProjectSave` | grava `scenes.json` |
| `OwnMovieSceneLoad` | 1 cena → prompts (estilo + negativo), seed, modo t2v/i2v, último frame anterior |
| `OwnMovieRouterConfig` | OmniRoute: URL e modelo por papel |
| `OwnMovieAgentPlanner` / `OwnMovieAgentEmotion` | prompt visual / pausas e ênfases (validada: não pode mudar as palavras) |
| `OwnMovieOmniVoice` | `omnivoice-infer` (flags do antigo bridge), backend `python` ou `http`; cache por texto+voz+idioma; `--ref_audio` se `voice` for um arquivo |
| `OwnMovieAudioTiming` | duração do áudio → segundos e frames (FPS×s+1) |
| `OwnMovieLastFrameSave` | último frame da cena → `frames/` (encadeamento i2v) |
| `OwnMovieSceneMux` | frames + áudio → `clips/cNNN.mp4`; `hold_last_frame` nunca corta a fala |
| `OwnMovieFinalConcat` | junta os clipes em `final.mp4`; erro lista cenas ausentes |
| `OwnMovieExcerpt` | compatibilidade com o node antigo (não usado nos workflows novos) |

Rotas no ComfyUI: `GET /own_movie/projects`, `GET /own_movie/project/<nome>`, `GET /own_movie/health`, `POST /own_movie/scene` (editar narração/prompt invalida só o que ficou velho).

## Workflows
`python3 scripts/build-workflows.py` gera `workflows/0*.api.json` (e a cópia em `src/data/workflows/` que o front importa) a partir de `workflows/WAN2.2.api.json` (não modificado). No `02_CENA` foram removidos `VHS_VideoCombine`, `SelectEveryNth`, `SaveImage`, `Gate`, `PreviewImage`, `LoadImage` e `OwnMovieExcerpt`; foram ligados `SceneLoad` (prompts, seed, modo, imagem), `AudioTiming` (segundos) e `SceneMux`.

## Instalar
```bash
bash scripts/install-nodes.sh          # copia para opensource/comfyui/custom_nodes/OWN_MOVIE (backup do __init__.py antigo)
export OMNIVOICE_BIN=/home/cfd/.venvs/omnivoice/bin/omnivoice-infer
export OMNIROUTE_API_KEY=...           # opcional; senão lê ~/.hermes/config.yaml como o batch-render
# reinicie o ComfyUI (--enable-cors-header) e abra Configurações → Diagnosticar
python3 scripts/run-project.py meu_projeto --text roteiro.txt     # sem navegador, retoma sozinho
```

## Testes
`npm run test:nodes` (Python, 36 testes, ffmpeg real) · `npm test` (Vitest, 16 testes) · `npx tsc --noEmit` (0 erros).

## Não verificado (precisa do seu ComfyUI/GPU)
- Execução dentro de um ComfyUI real e com `torch` de verdade (os wrappers de tensor foram testados com um tensor de teste).
- **Ligações i2v inferidas:** no export API original `74:70.image` e `74:72.start_image` ficam sem fio (no canvas, o "Anything Everywhere" 75 os alimenta). O template liga `85 → ambos`. Teste uma cena com "Encadear último frame" antes de confiar.
- `ImpactSwitch` lazy com a imagem de preenchimento 64×64 no modo t2v.
- Tags de emoção (`[laughter]`, `[sigh]`) suportadas pelo seu OmniVoice.
- Backend `python` do OmniVoice (usa a mesma API do `batch-tts.py`, mas exige `omnivoice` no Python do ComfyUI e disputa VRAM com o Wan; por isso `keep_loaded=False`).
