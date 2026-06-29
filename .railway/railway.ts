import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres");
  const breakingBadRoleplay = service("breaking-bad-roleplay", {
    source: github("yishu-ziyu/breaking-bad-roleplay"),
    replicas: 1,
    build: "cd backend && python3 -m pip install -r requirements.txt",
    start: "python3 start.py",
    env: {
      APP_ENV: preserve(),
      DATABASE_URL: preserve(),
      MINIMAX_API_KEY: preserve(),
      STEPFUN_API_KEY: preserve(),
    },
  });

  return project("breaking-bad-roleplay", {
    resources: [Postgres, breakingBadRoleplay],
  });
});
