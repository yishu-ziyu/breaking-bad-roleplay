from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # LLM provider keys — at least one is required (see validator below).
    # Both default to "" so a single-provider deployment only needs to set
    # the key for the provider it actually uses. The previous "both required"
    # behaviour blocked legitimate single-provider setups.
    minimax_api_key: str = ""
    stepfun_api_key: str = ""
    cli_proxy_base_url: str = "http://127.0.0.1:8317"
    cli_proxy_api_key: str = ""
    cli_proxy_default_model: str = "gemini-pro-agent"
    # DATABASE_URL has no fallback — the app cannot run without a Postgres
    # connection (db/session.py builds the engine at import time), so it
    # stays mandatory.
    database_url: str
    app_env: str = "development"
    allowed_origins: str = ""
    log_level: str = "INFO"

    @model_validator(mode="after")
    def _require_at_least_one_api_key(self) -> "Settings":
        if not (self.minimax_api_key or self.stepfun_api_key or self.cli_proxy_api_key):
            raise ValueError(
                "At least one of MINIMAX_API_KEY, STEPFUN_API_KEY, or CLI_PROXY_API_KEY must be "
                "set — the app cannot call any LLM provider without an API key."
            )
        return self


settings = Settings()
