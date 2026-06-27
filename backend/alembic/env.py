import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Add backend directory to sys.path to allow imports from app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import config and models
from app.config import settings
from app.db import Base
from app.models import Appointment, CallSummary

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for autogenerate support
target_metadata = Base.metadata

def get_db_url():
    # Fallback to os.getenv in case settings isn't fully loaded
    url = os.getenv("DATABASE_URL") or settings.DATABASE_URL
    # Alembic requires postgresql:// instead of postgres:// in newer SQLAlchemy versions
    if url and url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_db_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # Create database configuration section dynamically
    alembic_config = config.get_section(config.config_ini_section, {})
    alembic_config["sqlalchemy.url"] = get_db_url()

    connectable = engine_from_config(
        alembic_config,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
