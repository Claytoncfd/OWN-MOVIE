# Hermes Agent ↔ OWN MOVIE (verificado em 2026-10-02)

Papel: Planner — roteiro → cenas → prompts visuais (via OmniRoute local).
­
Configuração aplicada no `hermes` (em `~/.hermes/config.yaml`, fora do git):

```bash
# interpretador com as deps do hermes:
PY=/home/cfd/.venvs/comfyui/bin/python
$PY opensource/hermes-agent/hermes config set model.provider custom
$PY opensource/hermes-agent/hermes config set model.base_url http://127.0.0.1:20128/v1
$PY opensource/hermes-agent/hermes config set model.default nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
$PY opensource/hermes-agent/hermes config set model.api_key <chave-ownmovie-local>
```

Teste real executado:

```bash
$PY opensource/hermes-agent/hermes --cli -z "Responda com exatamente: OK"
# → OK
```

Notas:
- `provider: custom` = qualquer endpoint OpenAI-compatível (aqui, o OmniRoute).
- Modelo `auto` foi evitado: o combo automático estava caindo em provedores
  instáveis (pollinations 400). O modelo nvidia acima respondeu de verdade.
- A chave `sk-...` fica só no `~/.hermes/config.yaml` (nunca no repositório).
  Na UI do OWN MOVIE, a mesma chave vai em Configurações → OmniRoute → Chave.
- Vision / Project / File continuam como papéis do Hermes (skills), não serviços.
