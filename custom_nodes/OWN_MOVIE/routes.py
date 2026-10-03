"""Rotas HTTP dentro do próprio ComfyUI (substituem o 'bridge :8000'). Somente leitura."""
from __future__ import annotations

from . import health
from .common import SUBFOLDER, output_root, project_status, update_scene


def register() -> bool:
    try:
        from aiohttp import web  # type: ignore
        from server import PromptServer  # type: ignore
    except Exception:
        return False  # fora do ComfyUI (ex.: testes)

    routes = PromptServer.instance.routes

    @routes.get("/own_movie/projects")
    async def list_projects(_request):
        base = output_root() / SUBFOLDER
        names = sorted(p.parent.name for p in base.glob("*/scenes.json")) if base.exists() else []
        return web.json_response({"projects": names})

    @routes.get("/own_movie/project/{name}")
    async def get_project(request):
        try:
            return web.json_response(project_status(request.match_info["name"]))
        except FileNotFoundError as e:
            return web.json_response({"error": str(e)}, status=404)
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)

    @routes.get("/own_movie/health")
    async def get_health(_request):
        return web.json_response(health.check())

    @routes.post("/own_movie/scene")
    async def post_scene(request):
        try:
            body = await request.json()
            sc = update_scene(body["project"], body["id"], body.get("fields", {}))
            return web.json_response({"ok": True, "scene": sc})
        except (KeyError, ValueError, FileNotFoundError) as e:
            return web.json_response({"error": str(e)}, status=400)

    return True
