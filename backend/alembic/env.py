from logging.config import fileConfig
from alembic import context
from sqlalchemy import engine_from_config, pool, text
from app.core.config import settings
from app.db import Base
import app.models  # noqa: F401 - registers all model tables with Base.metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
target_metadata = Base.metadata

# Startup migrations may be invoked by more than one Render/Cloud Run instance
# during a rollout. A session-level PostgreSQL advisory lock serializes upgrades
# so two instances cannot both attempt the same DDL at the same time.
POSTGRES_MIGRATION_LOCK_ID = 741_902_613_2026


def run_migrations_offline() -> None:
    url = settings.database_url
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=url.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        {"sqlalchemy.url": settings.database_url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    try:
        with connectable.connect() as connection:
            is_postgresql = connection.dialect.name == "postgresql"
            if is_postgresql:
                connection.execute(
                    text("SELECT pg_advisory_lock(:lock_id)"),
                    {"lock_id": POSTGRES_MIGRATION_LOCK_ID},
                )
                # End SQLAlchemy's implicit transaction while retaining the
                # session-level lock, then let Alembic own the DDL transaction.
                connection.commit()
            try:
                context.configure(
                    connection=connection,
                    target_metadata=target_metadata,
                    compare_type=True,
                    render_as_batch=settings.database_url.startswith("sqlite"),
                )
                with context.begin_transaction():
                    context.run_migrations()
            finally:
                if is_postgresql:
                    connection.execute(
                        text("SELECT pg_advisory_unlock(:lock_id)"),
                        {"lock_id": POSTGRES_MIGRATION_LOCK_ID},
                    )
                    connection.commit()
    finally:
        connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
