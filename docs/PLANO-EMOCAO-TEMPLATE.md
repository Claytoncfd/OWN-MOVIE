# Plano — Cenas com emoção, do texto ao vídeo (início: amanhã)

## Objetivo
Na página Projetos: texto → cenas → **agentes de IA emocionam cada trecho**
(pontuação/sintaxe com marcadores: pausas `...`, ênfases, `[laughter]` etc.).
Trecho pronto entra num **NODE dentro do ComfyUI** (agentes atuando nele),
conecta nos **NÓS do OmniVoice**, passa por **NÓS de customização** e só
então gera os vídeos.

## Etapas
1. **Agente Emoção** (skill Hermes + prompt OmniRoute): reescreve cada trecho
   com sintaxe emocional sem mudar o sentido; saída dupla: `narration`
   (p/ TTS) + `prompt` visual (p/ vídeo).
2. **Node receptor no ComfyUI**: estender o `OwnMovieExcerpt`
   (`custom_nodes/OWN_MOVIE/`) com entrada de metadados de emoção
   (tom, ritmo, pausas) + log por cena.
3. **Ponte OmniVoice**: avaliar nós TTS do ComfyUI (áudio direto no grafo)
   vs bridge CLI atual (que já funciona); ficar com o mais estável.
4. **Template base**: achar o template pronto MAIS PRÓXIMO (narração → vídeo)
   e adaptar em vez de construir do zero.
5. **Customização → vídeo**: nós de ajuste (enquadramento, ritmo por emoção)
   antes do KSampler; revalidar export (POST + interrupt) e 1 render de prova.

## Estado atual (base pronta)
- `workflows/WAN2.2.api.json` validado (66 nós), modelos em `models/OWN_MOVIE/`.
- Nó 200 `OwnMovieExcerpt` recebe o trecho por cena (app + lote).
- TTS real via bridge CLI; planner via OmniRoute; batch 334 com resume.
