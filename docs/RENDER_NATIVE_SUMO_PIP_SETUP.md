# Render native SUMO wheel setup

See [`../RENDER_NATIVE_SUMO_PIP_SETUP.md`](../RENDER_NATIVE_SUMO_PIP_SETUP.md) for the exact settings and verification commands. This replaces older Render deployment notes that instruct `apt-get install sumo`.

The existing native Python service installs `eclipse-sumo==1.28.0` through pip. Do not use Docker or apt-get. Keep the current service and preserve the original Alembic + Uvicorn start command.
