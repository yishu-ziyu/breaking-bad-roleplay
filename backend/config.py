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
    # Empty default = derive from whichever platform key exists (see the
    # model validator below: MiniMax preferred, StepFun fallback). A explicit
    # DIRECTOR_MODEL_ROUTE env value always wins.
    director_model_route: str = ""
    # Dossier analysis is a useful secondary LLM pass, but it must be
    # deferrable on runtimes with a hard request deadline (for example Vercel
    # Hobby functions). Dialogue messages are still persisted either way.
    enable_dossier_updates: bool = True
    # DATABASE_URL has no fallback — the app cannot run without a Postgres
    # connection (db/session.py builds the engine at import time), so it
    # stays mandatory.
    database_url: str
    app_env: str = "development"
    allowed_origins: str = ""
    log_level: str = "INFO"

    # Platform free-tier (server-enforced). Keys never leave the server.
    # Costs: chat direct=1, crew=2, story beat=5, tts=1.
    free_credits_guest: int = 8
    # Logged-in early-access welfare pool (per Supabase user / UTC day).
    free_credits_user: int = 80
    # Site-wide daily budget for platform keys (sum of all free-tier spends).
    platform_daily_credit_budget: int = 5000
    # Burst shield: max billable platform ops per IP per rolling hour.
    platform_rate_limit_per_hour: int = 40
    # Salt for hashing client IPs in quota identity (not a secret key material).
    quota_ip_salt: str = "abq-quota-v1"

    # Redis URL for distributed quota store (multi-instance support).
    # Falls back to in-process memory store when not set or unavailable.
    redis_url: str = ""

    # Supabase Auth (optional). Required to grant logged-in free_credits_user.
    # Use the same project URL + publishable/anon key as the frontend.
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_publishable_key: str = ""

    # P1 AI performance sidecar. Kernel always commits first.
    # legacy = template lines (no Node). pi = Node ai-runtime / pi-agent.
    ai_runtime: str = "legacy"
    ai_runtime_url: str = "http://127.0.0.1:8010"
    ai_runtime_timeout_ms: int = 20000

    @model_validator(mode="after")
    def _require_at_least_one_api_key(self) -> "Settings":
        if not (self.minimax_api_key or self.stepfun_api_key or self.cli_proxy_api_key):
            raise ValueError(
                "At least one of MINIMAX_API_KEY, STEPFUN_API_KEY, or CLI_PROXY_API_KEY must be "
                "set — the app cannot call any LLM provider without an API key."
            )
        # Derive the default director route from whichever platform key exists
        # (MiniMax preferred — QA 2026-08-27: StepFun key was exhausted and
        # every call paid a 10s 402 retry before falling back). An explicit
        # DIRECTOR_MODEL_ROUTE env value is kept untouched.
        if not self.director_model_route:
            self.director_model_route = (
                "minimax/MiniMax-M3" if self.minimax_api_key else "stepfun/step-3.7-flash"
            )
        return self


settings = Settings()
