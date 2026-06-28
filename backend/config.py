from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    minimax_api_key: str
    stepfun_api_key: str
    database_url: str
    app_env: str = "development"
    allowed_origins: str = ""
    log_level: str = "INFO"


settings = Settings()
